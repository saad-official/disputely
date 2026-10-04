import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/lib/crypto/secretbox";
import type { DbHandle } from "@/lib/db/client";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as libraryRepo from "@/lib/db/repositories/library";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as packetsRepo from "@/lib/db/repositories/packets";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import type { Organization } from "@/lib/db/types";
import { DEMO_LIBRARY, DEMO_ORDERS } from "@/lib/domain/demo";
import { clearDemo, createDemoDisputes, DEMO_PAYMENT_METHODS } from "@/lib/services/demo";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { fakeDispute, fakeStripe, stripeError, TEST_KEY, useEncryptionKey, type FakeStripe } from "./helpers";

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

async function orgWithKey(key = TEST_KEY): Promise<Organization> {
  const org = await insertOrg(handle, { name: "Larkspur Goods" });
  return (await organizationsRepo.setStripeKey(org.id, encryptSecret(org.id, key), "test"))!;
}

const REASON_FOR = { won: "fraudulent", inquiry: "general", lost: "product_not_received" } as const;

/** Stripe opens a dispute on each demo charge as soon as the PaymentIntent confirms. */
function stripeThatDisputes(fake: FakeStripe, tag: string): void {
  fake.onPaymentIntent = (params, n) => {
    const chargeId = `ch_${tag}${n}`;
    const order = DEMO_ORDERS.find((o) => o.orderRef === params.metadata?.order_ref)!;
    fake.disputes.push(
      fakeDispute({
        id: `dp_${tag}${n}`,
        chargeId,
        amount: params.amount,
        reason: REASON_FOR[order.scenario],
        status: order.scenario === "inquiry" ? "warning_needs_response" : "needs_response",
        metadata: params.metadata as Record<string, string>,
        email: params.receipt_email ?? null,
        shipping: {
          name: params.shipping!.name,
          address: params.shipping!.address as never,
          carrier: null,
          tracking_number: null,
          phone: null,
        },
        description: params.description ?? null,
      }),
    );
    return chargeId;
  };
}

describe("createDemoDisputes", () => {
  it("creates three real test disputes with Stripe's dispute PaymentMethods, seeds records and builds packets", async () => {
    const org = await orgWithKey();
    const fake = fakeStripe();
    stripeThatDisputes(fake, "a");

    const result = await createDemoDisputes(org.id, fake.deps);
    expect(result).toMatchObject({ created: true, disputes: 3, pending: [], errors: [] });

    expect(fake.calls.paymentIntents.map((p) => p.payment_method)).toEqual([
      DEMO_PAYMENT_METHODS.won,
      DEMO_PAYMENT_METHODS.inquiry,
      DEMO_PAYMENT_METHODS.lost,
    ]);
    for (const p of fake.calls.paymentIntents) {
      expect(p).toMatchObject({ confirm: true, metadata: { disputely_demo: "1" } });
      expect(p.receipt_email).toMatch(/@example\.com$/);
      expect(p).not.toHaveProperty("payment_method_data");
    }

    const demo = await disputesRepo.listDemo(org.id);
    expect(demo).toHaveLength(3);
    expect(demo.every((d) => d.charge.demo === true && d.customer.ipAddress)).toBe(true);
    expect((await libraryRepo.list(org.id)).length).toBe(DEMO_LIBRARY.length);
    expect(await shipmentsRepo.findByCharge(org.id, "ch_a1")).toMatchObject({ carrier: "UPS" });
    expect((await messageLogsRepo.listRecent(org.id)).length).toBeGreaterThan(0);

    const packets = await packetsRepo.listSummaries(org.id, demo.map((d) => d.id));
    expect(packets.size).toBe(3);
    const fraud = demo.find((d) => d.reason === "fraudulent")!;
    const fraudPacket = await packetsRepo.getByDispute(org.id, fraud.id);
    expect(fraudPacket?.fields.billing_address).toMatchObject({ override: true });
    expect(fraudPacket?.fields.customer_purchase_ip?.value).toBe("203.0.113.42");
    expect(fraudPacket?.completeness).toBeGreaterThanOrEqual(70);

    // Idempotent: a second run creates nothing.
    const again = await createDemoDisputes(org.id, fake.deps);
    expect(again).toMatchObject({ created: false, disputes: 3 });
    expect(fake.calls.paymentIntents).toHaveLength(3);
  });

  it("falls back to the raw test card only when a PaymentMethod token is refused", async () => {
    const org = await orgWithKey();
    const fake = fakeStripe();
    stripeThatDisputes(fake, "b");
    const create = fake.client.paymentIntents.create as unknown as ReturnType<typeof vi.fn>;
    const original = create.getMockImplementation()!;
    create.mockImplementationOnce(() =>
      Promise.reject(stripeError("StripeInvalidRequestError", "No such PaymentMethod: 'pm_card_createDispute'", { code: "resource_missing" })),
    );
    const result = await createDemoDisputes(org.id, fake.deps);
    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(4);
    const fallback = create.mock.calls[1][0];
    expect(fallback.payment_method).toBeUndefined();
    expect(fallback.payment_method_data).toMatchObject({ type: "card", card: { number: "4000000000000259" } });
    create.mockImplementation(original);
  });

  it("requires a connected test-mode key", async () => {
    const plain = await insertOrg(handle);
    await expect(createDemoDisputes(plain.id, fakeStripe().deps)).rejects.toThrow(/Connect a Stripe test-mode key/);
    const live = await orgWithKey("rk_live_FixtureLive01");
    await expect(createDemoDisputes(live.id, fakeStripe().deps)).rejects.toThrow(/test mode/);
  });

  it("clearDemo removes the local demo rows and keeps everything else", async () => {
    const org = await orgWithKey();
    const fake = fakeStripe([fakeDispute({ id: "dp_real", chargeId: "ch_real", reason: "fraudulent" })]);
    stripeThatDisputes(fake, "c");
    await createDemoDisputes(org.id, fake.deps);
    expect((await disputesRepo.listAll(org.id)).total).toBe(4);

    const cleared = await clearDemo(org.id);
    expect(cleared).toMatchObject({ disputes: 3, shipments: 3, libraryItems: DEMO_LIBRARY.length });
    expect(cleared.messages).toBeGreaterThan(0);
    const left = await disputesRepo.listAll(org.id);
    expect(left.items.map((d) => d.stripeDisputeId)).toEqual(["dp_real"]);
    expect(await libraryRepo.list(org.id)).toHaveLength(0);
  });
});
