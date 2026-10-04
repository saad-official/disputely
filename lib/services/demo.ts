import "server-only";
import type Stripe from "stripe";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as libraryRepo from "@/lib/db/repositories/library";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import type { Organization } from "@/lib/db/types";
import {
  DEMO_LIBRARY,
  DEMO_ORDERS,
  DEMO_STORE_NAME,
  demoOrderAmount,
  materializeDemo,
  type DemoOrder,
  type DemoScenario,
} from "@/lib/domain/demo";
import { formatAddress } from "@/lib/domain/format";
import { NotFoundError, ServiceError } from "./errors";
import { buildPacket } from "./packets";
import { audit, errorText, nowFrom, sleepFrom, stripeErrorType, type MerchantStripe, type ServiceDeps } from "./shared";
import { connectedKeyMode, getMerchantStripe, stripeFailure } from "./stripe-connection";
import { syncDisputes } from "./sync";

/**
 * "Create demo disputes" (spec 3.7). With a connected TEST-mode key, creates
 * three PaymentIntents for the fictional store Larkspur Goods, confirmed with
 * Stripe's dispute test payment methods, so Stripe itself opens three real
 * test disputes (fraudulent, an inquiry, product not received). Then it
 * syncs, seeds the demo policy library, shipments and message logs, and
 * builds a packet for each. Every row is obviously fictional (example.com
 * emails, documentation IPs, metadata disputely_demo=1).
 *
 * Idempotent: when demo disputes already exist locally nothing is created.
 * `clearDemo` deletes the local demo rows; Stripe's test objects stay.
 */

/** Stripe's dispute test PaymentMethods (docs.stripe.com/testing#disputes). */
export const DEMO_PAYMENT_METHODS: Record<DemoScenario, string> = {
  won: "pm_card_createDispute",
  inquiry: "pm_card_createDisputeInquiry",
  lost: "pm_card_createDisputeProductNotReceived",
};

export const DEMO_POLL_ATTEMPTS = 10;
export const DEMO_POLL_INTERVAL_MS = 2_000;

export type CreateDemoResult = {
  created: boolean;
  /** Demo disputes stored locally after the run. */
  disputes: number;
  /** Orders whose dispute Stripe had not opened before the wait ran out (they arrive with the next sync). */
  pending: string[];
  errors: string[];
};

function tokenRejected(error: unknown): boolean {
  if (stripeErrorType(error) !== "StripeInvalidRequestError") return false;
  const e = error as { code?: unknown; param?: unknown; message?: unknown };
  return e.code === "resource_missing" || e.param === "payment_method" || /payment_method|pm_card/i.test(String(e.message ?? ""));
}

function intentParams(order: DemoOrder): Stripe.PaymentIntentCreateParams {
  const a = order.customer.address;
  return {
    amount: demoOrderAmount(order),
    currency: order.currency,
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: order.description,
    receipt_email: order.customer.email,
    shipping: {
      name: order.customer.name,
      address: {
        line1: a.line1 ?? "",
        line2: a.line2 ?? undefined,
        city: a.city ?? undefined,
        state: a.state ?? undefined,
        postal_code: a.postalCode ?? undefined,
        country: a.country ?? undefined,
      },
    },
    metadata: {
      disputely_demo: "1",
      order_ref: order.orderRef,
      store: DEMO_STORE_NAME,
      customer_ip: order.customer.ip,
      ...(order.productLine ? { product_line: order.productLine } : {}),
    },
  };
}

/** Confirms one demo PaymentIntent; falls back to the raw test card number only if the PaymentMethod token is refused. */
async function createIntent(client: MerchantStripe, order: DemoOrder, now: Date): Promise<string> {
  const base = intentParams(order);
  let intent: Stripe.PaymentIntent;
  try {
    intent = await client.paymentIntents.create({ ...base, payment_method: DEMO_PAYMENT_METHODS[order.scenario] });
  } catch (error) {
    if (!tokenRejected(error)) throw error;
    const card = { number: order.testCard, exp_month: 12, exp_year: now.getUTCFullYear() + 2, cvc: "123" };
    intent = await client.paymentIntents.create({
      ...base,
      // Raw card numbers are test-mode only and need Stripe's "raw card data" setting; tokens are tried first.
      payment_method_data: { type: "card", card } as unknown as Stripe.PaymentIntentCreateParams.PaymentMethodData,
    });
  }
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  if (!chargeId) throw new Error(`PaymentIntent ${intent.id} has no charge (status ${intent.status}).`);
  return chargeId;
}

/** Polls Stripe until a dispute exists for every charge (or the attempts run out). Returns the charges still waiting. */
async function waitForDisputes(client: MerchantStripe, chargeIds: string[], deps?: ServiceDeps): Promise<string[]> {
  const sleep = sleepFrom(deps);
  let waiting = [...chargeIds];
  for (let attempt = 0; attempt < DEMO_POLL_ATTEMPTS && waiting.length > 0; attempt++) {
    if (attempt > 0) await sleep(DEMO_POLL_INTERVAL_MS);
    const page = await client.disputes.list({ limit: 25 });
    const seen = new Set(page.data.map((d) => (typeof d.charge === "string" ? d.charge : d.charge.id)));
    waiting = waiting.filter((id) => !seen.has(id));
  }
  return waiting;
}

async function loadOrg(orgId: string): Promise<Organization> {
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  return org;
}

async function seedLibrary(orgId: string): Promise<number> {
  const existing = await libraryRepo.list(orgId);
  const have = new Set(existing.map((i) => `${i.kind}\u0000${i.title.trim()}`));
  let created = 0;
  for (const item of DEMO_LIBRARY) {
    if (have.has(`${item.kind}\u0000${item.title}`)) continue;
    // System seeding: bypasses the Pro gate on saving library items.
    await libraryRepo.create(orgId, {
      kind: item.kind,
      title: item.title,
      text: item.text,
      url: item.url ?? null,
      productLine: item.productLine ?? null,
    });
    created++;
  }
  return created;
}

export async function createDemoDisputes(orgId: string, deps?: ServiceDeps): Promise<CreateDemoResult> {
  const org = await loadOrg(orgId);
  const mode = connectedKeyMode(org);
  if (mode === null) throw new ServiceError("stripe_not_connected", "Connect a Stripe test-mode key in Settings first.");
  if (mode !== "test") {
    throw new ServiceError("invalid_input", "Demo disputes are created in Stripe test mode. Connect a test-mode key (rk_test_...).");
  }

  const existing = await disputesRepo.listDemo(orgId);
  if (existing.length > 0) return { created: false, disputes: existing.length, pending: [], errors: [] };

  const client = getMerchantStripe(org, deps);
  const chargedAt = nowFrom(deps);
  const chargeIdByOrderRef: Record<string, string> = {};
  const errors: string[] = [];
  for (const order of DEMO_ORDERS) {
    try {
      chargeIdByOrderRef[order.orderRef] = await createIntent(client, order, chargedAt);
    } catch (error) {
      errors.push(`${order.orderRef}: ${stripeErrorType(error) ? stripeFailure(error, "create the test payment").message : errorText(error)}`);
    }
  }
  const chargeIds = Object.values(chargeIdByOrderRef);
  if (chargeIds.length === 0) {
    await audit({ orgId, actor: "user", type: "demo.failed", entityType: "organization", entityId: orgId, output: { errors } });
    throw new ServiceError("stripe_error", `Stripe did not create the demo payments. ${errors[0] ?? ""}`.trim());
  }

  let waiting: string[] = [];
  try {
    waiting = await waitForDisputes(client, chargeIds, deps);
  } catch (error) {
    throw stripeFailure(error, "list disputes");
  }
  await syncDisputes(orgId, { limit: 25, actor: "system" }, deps);

  const libraryCreated = await seedLibrary(orgId);
  const { shipments, messageLogs } = materializeDemo({ chargedAt, chargeIdByOrderRef });
  for (const s of shipments) {
    await shipmentsRepo.upsertByCharge(orgId, s.chargeId, {
      carrier: s.carrier ?? null,
      trackingNumber: s.trackingNumber ?? null,
      shippedAt: s.shippedAt ? new Date(s.shippedAt) : null,
      deliveredAt: s.deliveredAt ? new Date(s.deliveredAt) : null,
      proofUrl: s.proofUrl ?? null,
    });
  }
  await messageLogsRepo.bulkInsert(
    orgId,
    messageLogs.map((m) => ({
      customerEmail: m.customerEmail,
      channel: m.channel,
      occurredAt: new Date(m.occurredAt),
      direction: m.direction,
      body: m.body,
    })),
  );

  // The demo merchant's own order system has the billing address; Stripe's test
  // PaymentMethods carry none, so it is entered as a merchant value.
  const demoDisputes = await disputesRepo.listDemo(orgId);
  for (const dispute of demoDisputes) {
    const order = DEMO_ORDERS.find((o) => o.orderRef === dispute.charge.orderRef);
    const manual: Record<string, string> = {};
    if (order && !dispute.customer.billingAddress) manual.billing_address = formatAddress(order.customer.address) ?? "";
    if (order && !dispute.customer.ipAddress) manual.customer_purchase_ip = order.customer.ip;
    try {
      await buildPacket(orgId, dispute.id, { manual, actor: "system" });
    } catch (error) {
      errors.push(`${dispute.stripeDisputeId}: ${errorText(error)}`);
    }
  }

  const pending = DEMO_ORDERS.filter((o) => waiting.includes(chargeIdByOrderRef[o.orderRef] ?? "")).map((o) => o.orderRef);
  await audit({
    orgId,
    actor: "user",
    type: "demo.created",
    entityType: "organization",
    entityId: orgId,
    output: { charges: chargeIds.length, disputes: demoDisputes.length, pending, libraryCreated, errors: errors.slice(0, 5) },
  });
  return { created: true, disputes: demoDisputes.length, pending, errors };
}

export type ClearDemoResult = { disputes: number; shipments: number; messages: number; libraryItems: number };

/** Deletes the local demo rows (disputes with their packets, shipments, messages, demo library items). */
export async function clearDemo(orgId: string): Promise<ClearDemoResult> {
  await loadOrg(orgId);
  const demo = await disputesRepo.listDemo(orgId);
  const shipments = await shipmentsRepo.removeForCharges(orgId, demo.map((d) => d.chargeId));
  const disputes = await disputesRepo.deleteDemo(orgId);
  const messages = await messageLogsRepo.removeForCustomers(orgId, DEMO_ORDERS.map((o) => o.customer.email));
  const libraryItems = await libraryRepo.removeMatching(orgId, DEMO_LIBRARY);
  const result = { disputes, shipments, messages, libraryItems };
  await audit({ orgId, actor: "user", type: "demo.cleared", entityType: "organization", entityId: orgId, output: result });
  return result;
}
