import { describe, expect, it } from "vitest";
import { assemblePacket, completenessScore, formatTranscript, TRANSCRIPT_MAX_CHARS } from "@/lib/domain/assemble";
import { getPlaybook } from "@/lib/domain/playbooks";
import type { AssembledField, EvidenceFieldKey, MessageLog } from "@/lib/domain/types";
import { baseDispute, DISPUTES, makeInput, MERCHANT } from "../fixtures/disputes";

function field(fields: AssembledField[], key: EvidenceFieldKey): AssembledField | undefined {
  return fields.find((f) => f.key === key);
}

describe("assemblePacket: fraudulent", () => {
  const result = assemblePacket(makeInput("fraudulent"));

  it("fills customer fields from Stripe", () => {
    expect(field(result.fields, "customer_name")).toMatchObject({ value: "Jordan Ellis", source: "stripe_customer" });
    expect(field(result.fields, "customer_email_address")).toMatchObject({
      value: "jordan.ellis@example.com",
      source: "stripe_customer",
    });
    expect(field(result.fields, "billing_address")).toMatchObject({
      value: "12 Fern Lane, Apt 3, Portland, OR 97201, US",
      source: "stripe_charge",
    });
    expect(field(result.fields, "customer_purchase_ip")).toMatchObject({ value: "203.0.113.42" });
    expect(field(result.fields, "shipping_address")?.value).toBe("12 Fern Lane, Apt 3, Portland, OR 97201, US");
  });

  it("fills shipping from the shipment record for this charge only", () => {
    expect(field(result.fields, "shipping_carrier")).toMatchObject({ value: "UPS", source: "shipment" });
    expect(field(result.fields, "shipping_tracking_number")).toMatchObject({ value: "1Z999AA10123456784", source: "shipment" });
    expect(field(result.fields, "shipping_date")).toMatchObject({ value: "2026-09-12", source: "shipment" });
    expect(field(result.fields, "shipping_documentation")?.value).toContain("delivered 2026-09-15");
    expect(result.fields.map((f) => f.value).join(" ")).not.toContain("771234567890");
  });

  it("builds a dated transcript for this customer only, newest last", () => {
    const comm = field(result.fields, "customer_communication");
    expect(comm?.source).toBe("message_log");
    const value = comm!.value;
    expect(value.indexOf("has shipped")).toBeLessThan(value.indexOf("Got the blanket"));
    expect(value).toContain("[2026-09-12 15:05 UTC] Larkspur Goods (email)");
    expect(value).toContain("[2026-09-16 09:12 UTC] Customer (email)");
    expect(value).not.toContain("gift cards");
  });

  it("describes the product from line items and the library", () => {
    const desc = field(result.fields, "product_description");
    expect(desc?.source).toBe("stripe_checkout");
    expect(desc?.value).toContain("1 x Linen Throw Blanket - $129.00");
    expect(desc?.value).toContain("Stonewashed European linen throw");
  });

  it("scores completeness with required 70 / recommended 30", () => {
    // all 5 required, 7 of 9 recommended (no access log, no service date)
    expect(result.completeness).toBe(Math.round(70 + (30 * 7) / 9));
    expect(result.missing.map((m) => m.key)).toEqual(["access_activity_log", "service_date"]);
    expect(result.missing.every((m) => !m.required && m.why && m.howToFix)).toBe(true);
  });

  it("extracts facts", () => {
    const f = result.facts;
    expect(f.merchantName).toBe(MERCHANT);
    expect(f.amounts).toEqual(expect.arrayContaining(["$129.00", "129.00"]));
    expect(f.amountCents).toContain(12900);
    expect(f.dates).toEqual(expect.arrayContaining(["2026-09-10", "2026-09-12", "2026-09-15", "2026-09-16", "2026-09-25"]));
    expect(f.names).toContain("Jordan Ellis");
    expect(f.emails).toContain("jordan.ellis@example.com");
    expect(f.trackingNumbers).toEqual(["1Z999AA10123456784"]);
    expect(f.carriers).toEqual(["UPS"]);
    expect(f.productNames).toContain("Linen Throw Blanket");
    expect(f.ids).toEqual(expect.arrayContaining(["ch_3LarkFraud0001", "dp_1LarkTest0001"]));
    expect(f.ips).toContain("203.0.113.42");
    expect(f.addresses).toContain("12 Fern Lane, Apt 3, Portland, OR 97201, US");
    expect(f.messageExcerpts).toHaveLength(2);
    expect(f.dates).toEqual([...f.dates].sort());
  });

  it("is deterministic", () => {
    expect(assemblePacket(makeInput("fraudulent"))).toEqual(result);
  });
});

describe("assemblePacket: product_not_received", () => {
  const result = assemblePacket(makeInput("product_not_received"));

  it("uses the USPS shipment and lists missing proof", () => {
    expect(field(result.fields, "shipping_tracking_number")?.value).toBe("9400111899223197428490");
    expect(field(result.fields, "shipping_carrier")?.value).toBe("USPS");
    expect(field(result.fields, "shipping_documentation")).toBeUndefined();
    expect(field(result.fields, "customer_communication")).toBeUndefined();
    // required all present (70) + 1 of 4 recommended (billing address)
    expect(result.completeness).toBe(78);
    expect(result.missing.map((m) => m.key)).toEqual(["shipping_documentation", "customer_communication", "receipt"]);
  });

  it("lists every line item with amounts", () => {
    const desc = field(result.fields, "product_description")!.value;
    expect(desc).toContain("2 x Stoneware Mug Set - $64.00");
    expect(desc).toContain("1 x Beeswax Wrap Trio - $22.50");
    expect(result.facts.amountCents).toEqual(expect.arrayContaining([8650, 6400, 2250]));
  });

  it("keeps the shipping policy as a reference", () => {
    expect(result.references.map((r) => r.title)).toContain("Larkspur Shipping Policy");
    expect(result.facts.policyTitles).toContain("Larkspur Shipping Policy");
  });

  it("counts an uploaded proof of delivery", () => {
    const withFile = assemblePacket(
      makeInput("product_not_received", {
        attachments: [{ field: "shipping_documentation", fileId: "att_1", fileName: "usps-pod.pdf" }],
      }),
    );
    expect(field(withFile.fields, "shipping_documentation")).toMatchObject({ value: "usps-pod.pdf", fileId: "att_1" });
    expect(withFile.completeness).toBe(Math.round(70 + 30 * (2 / 4)));
  });

  it("falls back to tracking on the Stripe charge when no shipment exists", () => {
    const r = assemblePacket(
      makeInput("product_not_received", {
        shipments: [],
        dispute: {
          ...DISPUTES.product_not_received,
          shipping: { ...DISPUTES.product_not_received.shipping!, carrier: "DHL", trackingNumber: "JD014600006281230000" },
        },
      }),
    );
    expect(field(r.fields, "shipping_tracking_number")).toMatchObject({ value: "JD014600006281230000", source: "stripe_charge" });
    expect(field(r.fields, "shipping_carrier")?.value).toBe("DHL");
    expect(field(r.fields, "shipping_date")).toBeUndefined();
  });
});

describe("assemblePacket: product_unacceptable", () => {
  const result = assemblePacket(makeInput("product_unacceptable"));

  it("prefers the product-line refund policy and uses the default disclosure", () => {
    const policy = field(result.fields, "refund_policy");
    expect(policy).toMatchObject({ source: "library", sourceLabel: "Home Textiles Return Policy" });
    expect(policy?.value).toContain("cannot be returned for hygiene reasons");
    expect(field(result.fields, "refund_policy_disclosure")?.value).toContain("linked directly above the Pay button");
    expect(result.facts.policyTitles).toContain("Home Textiles Return Policy");
    expect(result.facts.policyTitles).not.toContain("Larkspur Returns & Refunds");
  });

  it("is complete on required fields", () => {
    expect(result.missing.filter((m) => m.required)).toEqual([]);
    expect(result.missing.map((m) => m.key)).toEqual(["refund_refusal_explanation"]);
  });
});

describe("assemblePacket: credit_not_processed", () => {
  it("falls back to the org default refund policy and flags the missing explanation", () => {
    const result = assemblePacket(makeInput("credit_not_processed"));
    expect(field(result.fields, "refund_policy")?.sourceLabel).toBe("Larkspur Returns & Refunds");
    expect(result.missing.find((m) => m.key === "refund_refusal_explanation")).toMatchObject({ required: true });
    expect(result.completeness).toBe(Math.round((70 * 5) / 6 + 30));
    // facts pick up amounts and periods from the policy text
    expect(result.facts.policyTitles).toContain("Larkspur Returns & Refunds");
  });
});

describe("assemblePacket: subscription_canceled", () => {
  it("uses the candle-club cancellation policy and inferred disclosure", () => {
    const result = assemblePacket(makeInput("subscription_canceled"));
    expect(field(result.fields, "cancellation_policy")?.sourceLabel).toBe("Candle Club Cancellation Terms");
    expect(field(result.fields, "cancellation_policy_disclosure")?.value).toContain("shown in full on the sign-up page");
    expect(field(result.fields, "product_description")?.value).toContain("one 220 g soy candle");
    expect(field(result.fields, "billing_address")).toBeUndefined();
    expect(result.missing[0]).toMatchObject({ key: "cancellation_rebuttal", required: true });
    expect(result.completeness).toBe(Math.round((70 * 5) / 6));
  });

  it("reaches 70 with the merchant's rebuttal", () => {
    const result = assemblePacket(
      makeInput("subscription_canceled", {
        manual: { cancellation_rebuttal: "No cancellation request was received before the 2026-09-01 renewal." },
      }),
    );
    expect(field(result.fields, "cancellation_rebuttal")).toMatchObject({ source: "manual" });
    expect(result.completeness).toBe(70);
    expect(result.facts.dates).toContain("2026-09-01");
  });
});

describe("assemblePacket: duplicate", () => {
  it("takes the duplicate charge id and explanation from manual input", () => {
    const result = assemblePacket(
      makeInput("duplicate", {
        manual: {
          duplicate_charge_id: " ch_3LarkDup0004a ",
          duplicate_charge_explanation: "Charge ch_3LarkDup0004a paid for order LG-10477 on 2026-09-02, a different order.",
        },
      }),
    );
    expect(field(result.fields, "duplicate_charge_id")).toMatchObject({ value: "ch_3LarkDup0004a", source: "manual" });
    expect(result.missing.filter((m) => m.required)).toEqual([]);
    expect(result.facts.ids).toContain("ch_3LarkDup0004a");
    expect(result.facts.dates).toContain("2026-09-02");
  });

  it("lists both inputs as required when absent", () => {
    const result = assemblePacket(makeInput("duplicate"));
    expect(result.missing.filter((m) => m.required).map((m) => m.key)).toEqual([
      "duplicate_charge_id",
      "duplicate_charge_explanation",
    ]);
  });
});

describe("assemblePacket: unrecognized and general", () => {
  it.each(["unrecognized", "general"] as const)("%s requires communication and has it", (reason) => {
    const result = assemblePacket(makeInput(reason));
    expect(getPlaybook(reason).required).toContain("customer_communication");
    expect(field(result.fields, "customer_communication")).toBeDefined();
    expect(result.missing.filter((m) => m.required)).toEqual([]);
  });

  it("other uses the general playbook", () => {
    const result = assemblePacket(makeInput("general", { dispute: baseDispute({ reason: "other" }) }));
    expect(result.playbook.reason).toBe("general");
  });
});

describe("assemblePacket: manual overrides and edge cases", () => {
  it("manual values override synced values; blank manual values are ignored", () => {
    const result = assemblePacket(
      makeInput("fraudulent", { manual: { customer_name: "Jordan A. Ellis", shipping_carrier: "   " } }),
    );
    expect(field(result.fields, "customer_name")).toMatchObject({ value: "Jordan A. Ellis", source: "manual" });
    expect(field(result.fields, "shipping_carrier")).toMatchObject({ value: "UPS", source: "shipment" });
    expect(result.facts.names).toEqual(expect.arrayContaining(["Jordan A. Ellis", "Jordan Ellis"]));
  });

  it("falls back to billing details when the customer has no name or email", () => {
    const d = baseDispute({ reason: "fraudulent", customer: { name: null, email: null, ip: null } });
    const result = assemblePacket(makeInput("fraudulent", { dispute: d }));
    expect(field(result.fields, "customer_name")).toMatchObject({ value: "Jordan Ellis", source: "stripe_charge" });
    expect(field(result.fields, "customer_purchase_ip")).toBeUndefined();
    expect(result.missing[0]).toMatchObject({ key: "customer_purchase_ip", required: true });
  });

  it("uses the charge description when there are no line items", () => {
    const d = baseDispute({ reason: "general", checkout: null, productLine: null });
    const result = assemblePacket(makeInput("general", { dispute: d }));
    expect(field(result.fields, "product_description")).toMatchObject({ value: "Order LG-10482", source: "stripe_charge" });
  });

  it("returns 0 when nothing is known", () => {
    const d = baseDispute({
      reason: "product_not_received",
      customer: { name: null, email: null },
      charge: { id: "ch_x", description: null, billingDetails: null },
      shipping: null,
      checkout: null,
      productLine: null,
    });
    const result = assemblePacket({ dispute: d, libraryItems: [], shipments: [], messageLogs: [] });
    expect(result.completeness).toBe(0);
    expect(result.fields).toEqual([]);
    expect(result.missing).toHaveLength(getPlaybook("product_not_received").required.length + 4);
  });

  it("never emits empty values or duplicate keys", () => {
    for (const reason of Object.keys(DISPUTES) as Array<keyof typeof DISPUTES>) {
      const result = assemblePacket(makeInput(reason));
      const keys = result.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(result.fields.every((f) => f.value.trim().length > 0)).toBe(true);
      expect(result.completeness).toBeGreaterThanOrEqual(0);
      expect(result.completeness).toBeLessThanOrEqual(100);
    }
  });
});

describe("completenessScore", () => {
  it("weights required 70 and recommended 30", () => {
    const present = new Set<EvidenceFieldKey>(["customer_name"]);
    expect(completenessScore(["customer_name", "customer_email_address"], ["receipt"], present)).toBe(35);
    present.add("receipt");
    expect(completenessScore(["customer_name", "customer_email_address"], ["receipt"], present)).toBe(65);
  });

  it("treats an empty group as satisfied", () => {
    expect(completenessScore([], [], new Set())).toBe(100);
    expect(completenessScore(["customer_name"], [], new Set(["customer_name"]))).toBe(100);
  });
});

describe("formatTranscript", () => {
  it("caps at 20,000 chars by dropping the oldest messages", () => {
    const logs: MessageLog[] = Array.from({ length: 400 }, (_, i) => ({
      customerEmail: "a@example.com",
      channel: "chat",
      occurredAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
      direction: i % 2 ? "outbound" : "inbound",
      body: `Message number ${i} `.padEnd(100, "x"),
    }));
    const text = formatTranscript(logs, "Shop");
    expect(text.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
    expect(text.startsWith("[")).toBe(true);
    expect(text).toMatch(/^\[\d+ earlier messages omitted\]/);
    expect(text.trimEnd().endsWith("x")).toBe(true);
    expect(text).toContain("Message number 399");
    expect(text).not.toContain("Message number 0 ");
  });
});
