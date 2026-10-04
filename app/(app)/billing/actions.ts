"use server";

import { redirect } from "next/navigation";
import type { FormActionState } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { createCheckoutSession, createPortalSession, isBillingConfigured, isPortalConfigured } from "@/lib/stripe/billing";

/*
 * Billing actions only create Stripe-hosted sessions and redirect to them.
 * The plan itself changes when Stripe's webhook calls syncSubscriptionToOrg.
 * redirect() throws to work, so the URL is computed inside try and the
 * redirect happens after it.
 */

const STRIPE_FAILED = "Stripe could not start that session. Check the Stripe keys and the USD price id, then try again.";

function logStripeError(label: string, error: unknown) {
  console.error(`[billing] ${label} failed`, error instanceof Error ? error.message : error);
}

export async function startCheckout(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, org, role } = await requireOrgContext();
  if (formData.get("plan") !== "pro") return { ok: false, error: "Unknown plan." };
  if (role !== "owner") return { ok: false, error: "Only the workspace owner can change the plan." };
  if (!isBillingConfigured()) return { ok: false, error: "Billing is not set up on this deployment." };
  if (org.plan === "pro") return { ok: false, error: "You're already on Pro. Use Manage subscription instead." };

  let url: string;
  try {
    url = await createCheckoutSession({ org, userEmail: user.email ?? null, appUrl: publicEnv.appUrl });
  } catch (error) {
    logStripeError("checkout", error);
    return { ok: false, error: STRIPE_FAILED };
  }
  redirect(url);
}

export async function openPortal(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org, role } = await requireOrgContext();
  if (formData.get("intent") !== "manage") return { ok: false, error: "Unknown request." };
  if (role !== "owner") return { ok: false, error: "Only the workspace owner can manage the subscription." };
  if (!isPortalConfigured()) return { ok: false, error: "Billing is not set up on this deployment." };
  if (!org.stripeCustomerId) return { ok: false, error: "There is no Stripe customer for this workspace yet." };

  let url: string;
  try {
    url = await createPortalSession({ customerId: org.stripeCustomerId, appUrl: publicEnv.appUrl });
  } catch (error) {
    logStripeError("portal", error);
    return { ok: false, error: STRIPE_FAILED };
  }
  redirect(url);
}
