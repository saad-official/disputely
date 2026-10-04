import "server-only";
import type Stripe from "stripe";
import { logAgentEvent } from "@/lib/ai/log";
import { getDb } from "@/lib/db/client";
import { findOrgForStripe } from "@/lib/db/repositories/billing";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { Organization, Plan } from "@/lib/db/types";
import { optionalEnv, requireEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";

/**
 * Stripe Checkout, Customer Portal and subscription → plan sync (spec 3.5).
 * Sandbox / test mode only. organizations.plan and stripe_* are written only
 * by `syncSubscriptionToOrg` (from the webhook), through
 * `organizations.setPlan`.
 */

/** Pro is priced in dollars; Checkout refuses a price in another currency. */
export const PRO_CURRENCY = "usd";

/** True when the keys Checkout needs are present. The billing page disables its buttons otherwise. */
export function isBillingConfigured(): boolean {
  return Boolean(optionalEnv("STRIPE_SECRET_KEY") && optionalEnv("STRIPE_PRICE_PRO_MONTHLY"));
}

/** The Customer Portal only needs the secret key and a linked customer. */
export function isPortalConfigured(): boolean {
  return Boolean(optionalEnv("STRIPE_SECRET_KEY"));
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export async function createCheckoutSession(input: {
  org: Pick<Organization, "id" | "stripeCustomerId">;
  userEmail: string | null;
  appUrl: string;
}): Promise<string> {
  const { org, userEmail, appUrl } = input;
  const priceId = requireEnv("STRIPE_PRICE_PRO_MONTHLY");
  const price = await stripe().prices.retrieve(priceId);
  if (price.currency !== PRO_CURRENCY) {
    throw new Error(`STRIPE_PRICE_PRO_MONTHLY is priced in ${price.currency.toUpperCase()}; Pro must be in USD.`);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(org.stripeCustomerId
      ? { customer: org.stripeCustomerId }
      : userEmail
        ? { customer_email: userEmail }
        : {}),
    client_reference_id: org.id,
    metadata: { org_id: org.id },
    // Copied onto the subscription so later customer.subscription.* events can find the org.
    subscription_data: { metadata: { org_id: org.id } },
    allow_promotion_codes: false,
    success_url: joinUrl(appUrl, "/billing?checkout=success"),
    cancel_url: joinUrl(appUrl, "/billing?checkout=cancelled"),
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return session.url;
}

export async function createPortalSession(input: { customerId: string; appUrl: string }): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer: input.customerId,
    return_url: joinUrl(input.appUrl, "/billing"),
  });
  return session.url;
}

/** Pro while the subscription is active or trialing (past_due keeps Pro during Stripe's retry window). */
export function planForStatus(status: Stripe.Subscription.Status): Plan {
  return status === "active" || status === "trialing" || status === "past_due" ? "pro" : "free";
}

export type SyncResult =
  | { kind: "synced"; orgId: string; plan: Plan; changed: boolean }
  | { kind: "ignored"; reason: string };

/**
 * Writes a subscription's state onto its organization: plan ('pro' for
 * active, trialing or past_due, otherwise 'free'), stripe_customer_id and
 * stripe_subscription_id. Idempotent: it overwrites with the subscription's
 * state, so duplicate or retried deliveries are harmless. Unknown orgs are
 * ignored. A non-active update for an older subscription never downgrades an
 * org that has moved to a newer one.
 */
export async function syncSubscriptionToOrg(
  subscription: Stripe.Subscription,
  options: { orgIdHint?: string | null; actor?: "webhook" | "system" } = {},
): Promise<SyncResult> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const org = await findOrgForStripe({
    orgId: options.orgIdHint ?? subscription.metadata?.org_id ?? null,
    subscriptionId: subscription.id,
    customerId,
  });
  if (!org) return { kind: "ignored", reason: `no organization for subscription ${subscription.id}` };

  const plan = planForStatus(subscription.status);
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== subscription.id && plan === "free") {
    return { kind: "ignored", reason: `subscription ${subscription.id} is not the org's current one` };
  }

  const changed =
    org.plan !== plan || org.stripeCustomerId !== customerId || org.stripeSubscriptionId !== subscription.id;
  if (changed) {
    await organizationsRepo.setPlan(org.id, {
      plan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
    });
    await logAgentEvent(await getDb(), {
      orgId: org.id,
      actor: options.actor ?? "webhook",
      type: "billing.plan_synced",
      entityType: "organization",
      entityId: org.id,
      input: { subscriptionId: subscription.id, status: subscription.status },
      output: { from: org.plan, to: plan },
    });
  }
  return { kind: "synced", orgId: org.id, plan, changed };
}
