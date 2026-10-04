import type Stripe from "stripe";
import { optionalEnv } from "@/lib/env";
import { syncSubscriptionToOrg } from "@/lib/stripe/billing";
import { stripe } from "@/lib/stripe/client";
import { handleDisputeEvent, isDisputeEventType } from "@/lib/services/webhooks";

/**
 * Stripe webhook (spec 3.2, 3.5). Endpoint: /api/webhooks/stripe.
 * Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Subscribe to:
 * checkout.session.completed, customer.subscription.created,
 * customer.subscription.updated, customer.subscription.deleted (platform
 * billing) and charge.dispute.created|updated|closed (disputes on the same
 * sandbox account; routed by dispute id, see lib/services/webhooks.ts).
 *
 * Idempotent: every event re-reads the subscription from Stripe and
 * overwrites the org's plan with its current state, so retries, duplicates and
 * out-of-order deliveries converge on the same result. Events for unknown orgs
 * are acknowledged and ignored. Unexpected failures return 500 so Stripe
 * retries later.
 */

async function currentSubscription(ref: string | Stripe.Subscription): Promise<Stripe.Subscription> {
  const id = typeof ref === "string" ? ref : ref.id;
  try {
    return await stripe().subscriptions.retrieve(id);
  } catch (error) {
    // A deleted test-mode customer can make the retrieve fail; fall back to the event payload.
    if (typeof ref !== "string") return ref;
    throw error;
  }
}

async function handleEvent(event: Stripe.Event): Promise<string> {
  if (isDisputeEventType(event.type)) {
    const dispute = event.data.object as Stripe.Dispute;
    return handleDisputeEvent(event.type, { id: dispute.id });
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) return "not a subscription checkout";
      const subscription = await currentSubscription(session.subscription);
      const result = await syncSubscriptionToOrg(subscription, {
        orgIdHint: session.client_reference_id ?? session.metadata?.org_id ?? null,
      });
      return describe(result);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = await currentSubscription(event.data.object);
      return describe(await syncSubscriptionToOrg(subscription));
    }
    default:
      return "unhandled event type";
  }
}

function describe(result: Awaited<ReturnType<typeof syncSubscriptionToOrg>>): string {
  return result.kind === "synced"
    ? `org ${result.orgId} → ${result.plan}${result.changed ? "" : " (no change)"}`
    : `ignored: ${result.reason}`;
}

export async function POST(request: Request) {
  const secret = optionalEnv("STRIPE_WEBHOOK_SECRET");
  if (!secret || !optionalEnv("STRIPE_SECRET_KEY")) {
    console.error("[stripe] webhook received but STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not set");
    return Response.json({ error: "not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });

  // The signature covers the exact bytes Stripe sent: read the raw body, never parsed JSON.
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    console.info("[stripe] signature verification failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await handleEvent(event);
    console.info(`[stripe] ${event.type} ${event.id}: ${outcome}`);
    return Response.json({ received: true });
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} failed`, error instanceof Error ? error.message : error);
    return Response.json({ error: "handler failed" }, { status: 500 });
  }
}
