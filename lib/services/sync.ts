import "server-only";
import type Stripe from "stripe";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import type { NormalizedDispute } from "@/lib/db/repositories/disputes";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import { isDisputeStatus } from "@/lib/db/schema";
import type { Actor, Dispute, DisputeCharge, DisputeCustomer, DisputeShipping, PostalAddress } from "@/lib/db/types";
import { NotFoundError } from "./errors";
import { audit, errorText, type MerchantStripe, type ServiceDeps } from "./shared";
import { getMerchantStripe, stripeFailure } from "./stripe-connection";

/**
 * Dispute sync (spec 3.2): lists disputes with the merchant's key, pulls the
 * related charge, payment intent, customer and Checkout session, flattens
 * them into the `disputes` jsonb shapes and upserts. `syncOneDispute`
 * re-reads one dispute from Stripe, so a webhook delivered out of order can
 * never regress local data: the row always reflects Stripe's current state.
 *
 * Metadata conventions read from the charge or its PaymentIntent:
 * `order_ref` / `order_id` (order reference), `customer_ip` / `ip_address`
 * (purchase IP), `product_line` (Pro templates), `disputely_demo` (demo rows).
 */

export const DEFAULT_SYNC_LIMIT = 50;
const MAX_SYNC_LIMIT = 100;

export type SyncResult = { synced: number; created: number; closed: number; failed: number };

export type DisputeExtras = {
  customer?: Stripe.Customer | Stripe.DeletedCustomer | null;
  session?: Stripe.Checkout.Session | null;
  lineItems?: Stripe.LineItem[];
};

function address(a: Stripe.Address | null | undefined): PostalAddress | null {
  if (!a) return null;
  const out: PostalAddress = {
    line1: a.line1 ?? null,
    line2: a.line2 ?? null,
    city: a.city ?? null,
    state: a.state ?? null,
    postalCode: a.postal_code ?? null,
    country: a.country ?? null,
  };
  return Object.values(out).some((v) => v && String(v).trim()) ? out : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOf<T extends { id: string }>(ref: string | T | null | undefined): T | null {
  return ref && typeof ref === "object" ? ref : null;
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function metadataOf(charge: Stripe.Charge | null, intent: Stripe.PaymentIntent | null): Record<string, string> {
  return { ...(intent?.metadata ?? {}), ...(charge?.metadata ?? {}) };
}

function isLiveCustomer(c: DisputeExtras["customer"]): c is Stripe.Customer {
  return Boolean(c && !("deleted" in c && c.deleted));
}

/**
 * Flattens a Stripe dispute (with `charge` and `payment_intent` expanded)
 * plus the customer and Checkout session into the shape `upsertFromStripe`
 * stores. Throws on a dispute without a charge or with an unknown status.
 */
export function normalizeStripeDispute(dispute: Stripe.Dispute, extras: DisputeExtras = {}): NormalizedDispute & {
  productLine: string | null;
} {
  const charge = objectOf<Stripe.Charge>(dispute.charge);
  const intent = objectOf<Stripe.PaymentIntent>(dispute.payment_intent);
  const chargeId = idOf(dispute.charge);
  if (!chargeId) throw new Error(`Dispute ${dispute.id} has no charge.`);
  if (!isDisputeStatus(dispute.status)) throw new Error(`Dispute ${dispute.id} has an unknown status: ${dispute.status}`);

  const metadata = metadataOf(charge, intent);
  const billing = charge?.billing_details ?? null;
  const stripeCustomer = isLiveCustomer(extras.customer) ? extras.customer : null;
  const session = extras.session ?? null;
  const details = session?.customer_details ?? null;

  const customer: DisputeCustomer = {
    stripeCustomerId: idOf(charge?.customer ?? intent?.customer ?? null),
    name: str(stripeCustomer?.name) ?? str(billing?.name) ?? str(details?.name) ?? str(charge?.shipping?.name) ?? null,
    email:
      str(stripeCustomer?.email) ??
      str(billing?.email) ??
      str(details?.email) ??
      str(charge?.receipt_email) ??
      str(intent?.receipt_email) ??
      null,
    phone: str(stripeCustomer?.phone) ?? str(billing?.phone) ?? str(details?.phone) ?? null,
    billingAddress: address(billing?.address) ?? address(details?.address) ?? address(stripeCustomer?.address) ?? null,
    ipAddress: str(metadata.customer_ip) ?? str(metadata.ip_address) ?? null,
  };

  const card = charge?.payment_method_details?.card ?? null;
  const lineItems = (extras.lineItems ?? [])
    .filter((li) => str(li.description))
    .map((li) => ({ description: li.description!.trim(), quantity: li.quantity ?? null, amountCents: li.amount_total }));
  const chargeInfo: DisputeCharge = {
    createdAt: charge ? new Date(charge.created * 1000).toISOString() : null,
    description: str(charge?.description) ?? str(intent?.description) ?? null,
    statementDescriptor: str(charge?.calculated_statement_descriptor) ?? str(charge?.statement_descriptor) ?? null,
    receiptUrl: str(charge?.receipt_url),
    receiptNumber: str(charge?.receipt_number),
    invoiceId: null,
    checkoutSessionId: session?.id ?? null,
    card: card
      ? {
          brand: card.brand ?? null,
          last4: card.last4 ?? null,
          expMonth: card.exp_month ?? null,
          expYear: card.exp_year ?? null,
          cvcCheck: card.checks?.cvc_check ?? null,
          addressLine1Check: card.checks?.address_line1_check ?? null,
          addressPostalCodeCheck: card.checks?.address_postal_code_check ?? null,
          threeDSecure: card.three_d_secure?.result ?? null,
        }
      : null,
    lineItems,
    amountRefundedCents: charge?.amount_refunded ?? null,
    orderRef: str(metadata.order_ref) ?? str(metadata.order_id) ?? null,
    demo: metadata.disputely_demo === "1" && !dispute.livemode,
  };

  const chargeShipping = charge?.shipping ?? intent?.shipping ?? null;
  const sessionShipping = session?.collected_information?.shipping_details ?? null;
  const shipping: DisputeShipping | null =
    chargeShipping || sessionShipping
      ? {
          name: str(chargeShipping?.name) ?? str(sessionShipping?.name) ?? null,
          phone: str(chargeShipping?.phone) ?? null,
          address: address(chargeShipping?.address) ?? address(sessionShipping?.address) ?? null,
          carrier: str(chargeShipping?.carrier) ?? null,
          trackingNumber: str(chargeShipping?.tracking_number) ?? null,
        }
      : null;

  const due = dispute.evidence_details?.due_by;
  return {
    stripeDisputeId: dispute.id,
    chargeId,
    paymentIntentId: idOf(dispute.payment_intent),
    amountCents: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason,
    status: dispute.status,
    // Stripe reports due_by 0/null when the bank allows no response.
    dueBy: due && due > 0 ? new Date(due * 1000) : null,
    openedAt: new Date(dispute.created * 1000),
    customer,
    charge: chargeInfo,
    shipping,
    evidenceDetails: {
      dueBy: due && due > 0 ? new Date(due * 1000).toISOString() : null,
      hasEvidence: dispute.evidence_details?.has_evidence ?? false,
      pastDue: dispute.evidence_details?.past_due ?? false,
      submissionCount: dispute.evidence_details?.submission_count ?? 0,
      enhancedEligibilityTypes: [...(dispute.enhanced_eligibility_types ?? [])],
    },
    isChargeRefundable: dispute.is_charge_refundable,
    livemode: dispute.livemode,
    productLine: str(metadata.product_line),
  };
}

/** Customer and Checkout session for a dispute; failures (missing permission, deleted customer) are tolerated. */
async function fetchExtras(client: MerchantStripe, dispute: Stripe.Dispute): Promise<DisputeExtras> {
  const charge = objectOf<Stripe.Charge>(dispute.charge);
  const extras: DisputeExtras = {};
  const customerId = idOf(charge?.customer ?? objectOf<Stripe.PaymentIntent>(dispute.payment_intent)?.customer ?? null);
  if (customerId) {
    try {
      extras.customer = await client.customers.retrieve(customerId);
    } catch {
      extras.customer = null;
    }
  }
  const paymentIntentId = idOf(dispute.payment_intent);
  if (paymentIntentId) {
    try {
      const sessions = await client.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      const session = sessions.data[0] ?? null;
      extras.session = session;
      if (session) {
        const items = await client.checkout.sessions.listLineItems(session.id, { limit: 20 });
        extras.lineItems = items.data;
      }
    } catch {
      // No Checkout Sessions permission, or not a Checkout payment: the charge alone is enough.
    }
  }
  return extras;
}

const EXPAND = ["data.charge", "data.payment_intent"];

type UpsertOutcome = { dispute: Dispute; created: boolean; closed: boolean };

async function upsertOne(orgId: string, client: MerchantStripe, stripeDispute: Stripe.Dispute): Promise<UpsertOutcome> {
  const extras = await fetchExtras(client, stripeDispute);
  const { productLine, ...normalized } = normalizeStripeDispute(stripeDispute, extras);
  const before = await disputesRepo.getByStripeId(orgId, normalized.stripeDisputeId);
  const upserted = await disputesRepo.upsertFromStripe(orgId, normalized);
  const created = upserted.created;
  let dispute = upserted.dispute;
  if (created && productLine && !dispute.productLine) {
    dispute = (await disputesRepo.setProductLine(orgId, dispute.id, productLine)) ?? dispute;
  }
  // closed_at is stamped once, the first time a final status is seen.
  const closed = Boolean(dispute.closedAt && !before?.closedAt);
  return { dispute, created, closed };
}

async function loadOrg(orgId: string) {
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  return org;
}

/** Lists the newest disputes with the merchant's key and upserts each. */
export async function syncDisputes(
  orgId: string,
  options: { limit?: number; actor?: Actor } = {},
  deps?: ServiceDeps,
): Promise<SyncResult> {
  const org = await loadOrg(orgId);
  const client = getMerchantStripe(org, deps);
  const limit = Math.min(MAX_SYNC_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_SYNC_LIMIT)));

  let page: Stripe.ApiList<Stripe.Dispute>;
  try {
    page = await client.disputes.list({ limit, expand: EXPAND });
  } catch (error) {
    throw stripeFailure(error, "list disputes");
  }

  const result: SyncResult = { synced: 0, created: 0, closed: 0, failed: 0 };
  const errors: string[] = [];
  for (const stripeDispute of page.data) {
    try {
      const outcome = await upsertOne(orgId, client, stripeDispute);
      result.synced++;
      if (outcome.created) result.created++;
      if (outcome.closed) result.closed++;
    } catch (error) {
      result.failed++;
      errors.push(`${stripeDispute.id}: ${errorText(error)}`);
    }
  }
  await audit({
    orgId,
    actor: options.actor ?? "user",
    type: "dispute.synced",
    entityType: "organization",
    entityId: orgId,
    input: { limit },
    output: { ...result, errors: errors.slice(0, 5) },
  });
  return result;
}

/**
 * Re-reads one dispute from Stripe and upserts it (webhooks, after submit).
 * Returns the stored dispute.
 */
export async function syncOneDispute(
  orgId: string,
  stripeDisputeId: string,
  options: { actor?: Actor } = {},
  deps?: ServiceDeps,
): Promise<UpsertOutcome> {
  const org = await loadOrg(orgId);
  const client = getMerchantStripe(org, deps);
  let stripeDispute: Stripe.Dispute;
  try {
    stripeDispute = await client.disputes.retrieve(stripeDisputeId, { expand: ["charge", "payment_intent"] });
  } catch (error) {
    throw stripeFailure(error, "read the dispute");
  }
  const outcome = await upsertOne(orgId, client, stripeDispute);
  await audit({
    orgId,
    actor: options.actor ?? "system",
    type: outcome.closed ? "dispute.closed" : "dispute.refreshed",
    entityType: "dispute",
    entityId: outcome.dispute.id,
    output: { stripeDisputeId, status: outcome.dispute.status, created: outcome.created },
  });
  return outcome;
}
