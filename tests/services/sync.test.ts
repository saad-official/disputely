import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/lib/crypto/secretbox";
import type { DbHandle } from "@/lib/db/client";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { Organization } from "@/lib/db/types";
import { normalizeStripeDispute, syncDisputes, syncOneDispute } from "@/lib/services/sync";
import { handleDisputeEvent } from "@/lib/services/webhooks";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { fakeDispute, fakeStripe, TEST_KEY, useEncryptionKey } from "./helpers";

let handle: DbHandle;
let restoreKey: () => void;

beforeAll(async () => {
  restoreKey = useEncryptionKey();
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
  restoreKey();
});

async function connectedOrg(): Promise<Organization> {
  const org = await insertOrg(handle);
  return (await organizationsRepo.setStripeKey(org.id, encryptSecret(org.id, TEST_KEY), "test key"))!;
}

const address = { line1: "12 Fern Lane", line2: "Apt 3", city: "Portland", state: "OR", postal_code: "97201", country: "US" };

describe("normalizeStripeDispute", () => {
  it("flattens the charge, metadata and evidence details into the stored shapes", () => {
    const d = fakeDispute({
      id: "dp_norm",
      chargeId: "ch_norm",
      paymentIntentId: "pi_norm",
      reason: "product_not_received",
      customerName: "Jordan Ellis",
      billingAddress: address,
      shipping: { name: "Jordan Ellis", address, carrier: "UPS", tracking_number: "1Z999AA10123456784", phone: null },
      metadata: { order_ref: "LG-10482", customer_ip: "203.0.113.42", product_line: "home-textiles", disputely_demo: "1" },
      dueInDays: 7,
    });
    const n = normalizeStripeDispute(d, {
      lineItems: [{ description: "Linen Throw Blanket", quantity: 1, amount_total: 12_900 }] as never,
    });
    expect(n.stripeDisputeId).toBe("dp_norm");
    expect(n.chargeId).toBe("ch_norm");
    expect(n.paymentIntentId).toBe("pi_norm");
    expect(n.customer).toMatchObject({
      name: "Jordan Ellis",
      email: "jordan.ellis@example.com",
      ipAddress: "203.0.113.42",
      billingAddress: { line1: "12 Fern Lane", postalCode: "97201", country: "US" },
    });
    expect(n.charge).toMatchObject({
      orderRef: "LG-10482",
      demo: true,
      card: { brand: "visa", last4: "0259", cvcCheck: "pass" },
      lineItems: [{ description: "Linen Throw Blanket", quantity: 1, amountCents: 12_900 }],
    });
    expect(n.shipping).toMatchObject({ carrier: "UPS", trackingNumber: "1Z999AA10123456784" });
    expect(n.dueBy?.getTime()).toBe((d.evidence_details.due_by ?? 0) * 1000);
    expect(n.evidenceDetails?.dueBy).toBe(n.dueBy?.toISOString());
    expect(n.productLine).toBe("home-textiles");
  });

  it("never marks a live-mode dispute as demo and treats due_by 0 as no deadline", () => {
    const d = fakeDispute({ id: "dp_live", chargeId: "ch_live", livemode: true, metadata: { disputely_demo: "1" } });
    (d.evidence_details as { due_by: number | null }).due_by = 0;
    const n = normalizeStripeDispute(d);
    expect(n.charge?.demo).toBe(false);
    expect(n.dueBy).toBeNull();
  });
});

describe("syncDisputes", () => {
  it("upserts every dispute, counts new and newly closed ones, and is idempotent", async () => {
    const org = await connectedOrg();
    const fake = fakeStripe([
      fakeDispute({ id: "dp_open", chargeId: "ch_open", reason: "fraudulent" }),
      fakeDispute({ id: "dp_won", chargeId: "ch_won", status: "won", reason: "bank_cannot_process" }),
    ]);

    const first = await syncDisputes(org.id, {}, fake.deps);
    expect(first).toEqual({ synced: 2, created: 2, closed: 1, failed: 0 });
    expect(fake.calls.list[0]).toMatchObject({ limit: 50, expand: ["data.charge", "data.payment_intent"] });

    const won = await disputesRepo.getByStripeId(org.id, "dp_won");
    expect(won?.closedAt).toBeInstanceOf(Date);
    expect(won?.reason).toBe("other");
    expect(won?.stripeReason).toBe("bank_cannot_process");
    const open = await disputesRepo.getByStripeId(org.id, "dp_open");
    expect(open?.closedAt).toBeNull();
    expect(open?.customer.email).toBe("jordan.ellis@example.com");

    const again = await syncDisputes(org.id, {}, fake.deps);
    expect(again).toEqual({ synced: 2, created: 0, closed: 0, failed: 0 });
    expect((await disputesRepo.getByStripeId(org.id, "dp_won"))?.closedAt?.getTime()).toBe(won?.closedAt?.getTime());

    // The open one is lost: the next sync stamps closed_at once.
    Object.assign(fake.disputes[0], { status: "lost" });
    const third = await syncDisputes(org.id, {}, fake.deps);
    expect(third.closed).toBe(1);
    expect((await disputesRepo.getByStripeId(org.id, "dp_open"))?.status).toBe("lost");
  });

  it("refuses without a connected key", async () => {
    const org = await insertOrg(handle);
    await expect(syncDisputes(org.id, {}, fakeStripe().deps)).rejects.toThrow(/Connect your Stripe account/);
  });
});

describe("syncOneDispute and dispute webhooks", () => {
  it("re-reads from Stripe so stale events cannot regress the row", async () => {
    const org = await connectedOrg();
    const fake = fakeStripe([fakeDispute({ id: "dp_hook", chargeId: "ch_hook" })]);
    await syncDisputes(org.id, {}, fake.deps);
    Object.assign(fake.disputes[0], { status: "won" });

    const outcome = await handleDisputeEvent("charge.dispute.updated", { id: "dp_hook" }, fake.deps);
    expect(outcome).toContain("won");
    expect(fake.calls.retrieve).toContain("dp_hook");
    expect((await disputesRepo.getByStripeId(org.id, "dp_hook"))?.status).toBe("won");

    const direct = await syncOneDispute(org.id, "dp_hook", {}, fake.deps);
    expect(direct.created).toBe(false);
  });

  it("ignores disputes no organization has synced", async () => {
    const outcome = await handleDisputeEvent("charge.dispute.created", { id: "dp_unknown_xyz" }, fakeStripe().deps);
    expect(outcome).toMatch(/^ignored/);
  });
});
