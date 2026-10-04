import { describe, expect, it } from "vitest";
import { assemblePacket } from "@/lib/domain/assemble";
import {
  DEMO_LIBRARY,
  DEMO_MESSAGE_LOGS,
  DEMO_ORDERS,
  DEMO_SHIPMENTS,
  DEMO_STORE_NAME,
  demoDisputeFor,
  demoOrderAmount,
  materializeDemo,
} from "@/lib/domain/demo";
import { verifyNarrative } from "@/lib/domain/guardrails";
import { LibraryItemSchema, NormalisedDisputeSchema } from "@/lib/domain/types";

const CHARGED_AT = new Date("2026-10-04T10:00:00Z");
const CHARGE_IDS = Object.fromEntries(DEMO_ORDERS.map((o, i) => [o.orderRef, `ch_3DemoCharge000${i}`]));

describe("demo fixtures", () => {
  it("has one order per scenario on Stripe's dispute test cards", () => {
    expect(DEMO_ORDERS.map((o) => o.scenario).sort()).toEqual(["inquiry", "lost", "won"]);
    const byScenario = Object.fromEntries(DEMO_ORDERS.map((o) => [o.scenario, o]));
    expect(byScenario.won).toMatchObject({ testCard: "4000000000000259", evidenceTrigger: "winning_evidence", expectedReason: "fraudulent" });
    expect(byScenario.lost).toMatchObject({ testCard: "4000000000002685", evidenceTrigger: "losing_evidence", expectedReason: "product_not_received" });
    expect(byScenario.inquiry).toMatchObject({ testCard: "4000000000001976" });
  });

  it("is obviously fictional", () => {
    for (const o of DEMO_ORDERS) {
      expect(o.customer.email).toMatch(/@example\.com$/);
      expect(o.customer.ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
    }
    for (const item of DEMO_LIBRARY) {
      expect(LibraryItemSchema.parse(item)).toBeTruthy();
      if (item.url) expect(item.url).toMatch(/^https:\/\/larkspur\.example\.com\//);
    }
    expect(DEMO_STORE_NAME).toBe("Larkspur Goods");
  });

  it("links every shipment and message to an order", () => {
    const refs = new Set(DEMO_ORDERS.map((o) => o.orderRef));
    for (const s of DEMO_SHIPMENTS) expect(refs.has(s.orderRef)).toBe(true);
    for (const m of DEMO_MESSAGE_LOGS) expect(refs.has(m.orderRef)).toBe(true);
    expect(new Set(DEMO_SHIPMENTS.map((s) => s.trackingNumber)).size).toBe(DEMO_SHIPMENTS.length);
  });

  it("materialises shipments and messages after the charge time", () => {
    const { shipments, messageLogs } = materializeDemo({ chargedAt: CHARGED_AT, chargeIdByOrderRef: CHARGE_IDS });
    expect(shipments).toHaveLength(3);
    expect(messageLogs).toHaveLength(DEMO_MESSAGE_LOGS.length);
    for (const s of shipments) expect(Date.parse(s.shippedAt!)).toBeGreaterThan(CHARGED_AT.getTime());
    for (const m of messageLogs) expect(Date.parse(m.occurredAt)).toBeGreaterThan(CHARGED_AT.getTime());
    expect(shipments.find((s) => s.trackingNumber === "9400111899223197428513")?.deliveredAt).toBeNull();
  });

  it("skips orders that have no charge yet", () => {
    const { shipments, messageLogs } = materializeDemo({ chargedAt: CHARGED_AT, chargeIdByOrderRef: { "LG-10482": "ch_x" } });
    expect(shipments.map((s) => s.chargeId)).toEqual(["ch_x"]);
    expect(new Set(messageLogs.map((m) => m.customerEmail))).toEqual(new Set(["jordan.ellis@example.com"]));
  });

  it.each(DEMO_ORDERS.map((o) => [o.scenario, o] as const))("%s order assembles into a usable packet", (_s, order) => {
    const { shipments, messageLogs } = materializeDemo({ chargedAt: CHARGED_AT, chargeIdByOrderRef: CHARGE_IDS });
    const dispute = demoDisputeFor(order, {
      disputeId: `dp_demo_${order.orderRef}`,
      chargeId: CHARGE_IDS[order.orderRef],
      chargedAt: CHARGED_AT,
      disputedAt: new Date(CHARGED_AT.getTime() + 3_600_000),
      dueBy: new Date(CHARGED_AT.getTime() + 14 * 86_400_000),
    });
    expect(NormalisedDisputeSchema.parse(dispute)).toBeTruthy();
    const result = assemblePacket({
      dispute,
      merchantName: DEMO_STORE_NAME,
      libraryItems: DEMO_LIBRARY,
      shipments,
      messageLogs,
    });
    expect(result.completeness).toBeGreaterThanOrEqual(70);
    expect(result.missing.filter((m) => m.required)).toEqual([]);
    expect(result.facts.amountCents).toContain(demoOrderAmount(order));
    // A narrative quoting the order's own facts passes the guardrails.
    const shipment = DEMO_SHIPMENTS.find((s) => s.orderRef === order.orderRef)!;
    const narrative = `${order.customer.name} ordered from ${DEMO_STORE_NAME}. ${shipment.carrier} tracking ${shipment.trackingNumber} was sent to ${order.customer.email}.`;
    expect(verifyNarrative(narrative, result.facts).removed).toEqual([]);
  });
});
