import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/lib/crypto/secretbox";
import type { DbHandle } from "@/lib/db/client";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as packetsRepo from "@/lib/db/repositories/packets";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import type { Organization, Plan } from "@/lib/db/types";
import { ServiceError } from "@/lib/services/errors";
import { buildPacket, renderPdf, submitPacket, uploadAttachment, writeNarrative } from "@/lib/services/packets";
import { PlanLimitError } from "@/lib/services/plan-limits";
import { syncDisputes } from "@/lib/services/sync";
import { DAY_MS, insertOrg, PDF_BYTES, startTestDb, stopTestDb } from "../db/helpers";
import { fakeDispute, fakeStripe, stubGenerate, TEST_KEY, useEncryptionKey, type FakeDisputeInput, type FakeStripe } from "./helpers";

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

const address = { line1: "12 Fern Lane", line2: null, city: "Portland", state: "OR", postal_code: "97201", country: "US" };

async function setup(plan: Plan, disputes: FakeDisputeInput[]): Promise<{ org: Organization; fake: FakeStripe }> {
  const org = await insertOrg(handle, { plan, name: "Larkspur Goods" });
  await organizationsRepo.setStripeKey(org.id, encryptSecret(org.id, TEST_KEY), "test");
  const fake = fakeStripe(disputes.map(fakeDispute));
  await syncDisputes(org.id, {}, fake.deps);
  return { org: (await organizationsRepo.getById(org.id))!, fake };
}

async function localId(orgId: string, stripeDisputeId: string): Promise<string> {
  return (await disputesRepo.getByStripeId(orgId, stripeDisputeId))!.id;
}

function pnr(id: string, chargeId: string, extra: Partial<FakeDisputeInput> = {}): FakeDisputeInput {
  return {
    id,
    chargeId,
    reason: "product_not_received",
    customerName: "Jordan Ellis",
    shipping: { name: "Jordan Ellis", address, carrier: null, tracking_number: null, phone: null },
    ...extra,
  };
}

describe("buildPacket", () => {
  it("assembles from Stripe and the merchant's records, scores completeness and lists what is missing", async () => {
    const { org } = await setup("pro", [pnr("dp_b1", "ch_b1")]);
    const id = await localId(org.id, "dp_b1");
    await shipmentsRepo.upsertByCharge(org.id, "ch_b1", {
      carrier: "UPS",
      trackingNumber: "1Z999AA10123456784",
      shippedAt: new Date(Date.now() - 5 * DAY_MS),
    });

    const { packet, assembled } = await buildPacket(org.id, id);
    expect(packet.playbook).toBe("product_not_received");
    expect(packet.fields.shipping_carrier).toMatchObject({ value: "UPS", source: "shipment", origin: "shipment" });
    expect(packet.fields.customer_email_address).toMatchObject({ value: "jordan.ellis@example.com", source: "stripe" });
    expect(packet.completeness).toBe(70);
    expect(packet.missing).toEqual(["shipping_documentation", "customer_communication", "billing_address", "receipt"]);
    expect(packet.status).toBe("ready");
    expect(assembled.facts.trackingNumbers).toContain("1Z999AA10123456784");

    await messageLogsRepo.add(org.id, {
      customerEmail: "Jordan.Ellis@example.com",
      occurredAt: new Date(Date.now() - 4 * DAY_MS),
      direction: "inbound",
      body: "Got the parcel, thanks!",
    });
    const rebuilt = await buildPacket(org.id, id);
    expect(rebuilt.packet.fields.customer_communication?.source).toBe("message_log");
    expect(rebuilt.packet.completeness).toBe(78);
  });

  it("keeps merchant overrides across rebuilds until cleared", async () => {
    const { org } = await setup("pro", [pnr("dp_b2", "ch_b2")]);
    const id = await localId(org.id, "dp_b2");
    const first = await buildPacket(org.id, id, { manual: { billing_address: "12 Fern Lane, Portland, OR 97201, US" } });
    expect(first.packet.fields.billing_address).toMatchObject({ source: "merchant", override: true });

    const again = await buildPacket(org.id, id);
    expect(again.packet.fields.billing_address?.value).toBe("12 Fern Lane, Portland, OR 97201, US");

    const cleared = await buildPacket(org.id, id, { manual: { billing_address: "" } });
    expect(cleared.packet.fields.billing_address).toBeUndefined();
    expect(cleared.packet.missing).toContain("billing_address");

    await expect(buildPacket(org.id, id, { manual: { not_a_field: "x" } as never })).rejects.toBeInstanceOf(ServiceError);
  });

  it("Free covers the first 3 non-demo disputes opened each month; demo disputes never count", async () => {
    const base = Math.floor(Date.now() / 1000) - 3 * 3600;
    const { org } = await setup("free", [
      pnr("dp_f1", "ch_f1", { created: base }),
      pnr("dp_f2", "ch_f2", { created: base + 60 }),
      pnr("dp_f3", "ch_f3", { created: base + 120 }),
      pnr("dp_f4", "ch_f4", { created: base + 180 }),
      pnr("dp_fdemo", "ch_fdemo", { created: base + 240, metadata: { disputely_demo: "1" } }),
    ]);
    await expect(buildPacket(org.id, await localId(org.id, "dp_f3"))).resolves.toBeTruthy();
    await expect(buildPacket(org.id, await localId(org.id, "dp_f4"))).rejects.toBeInstanceOf(PlanLimitError);
    await expect(buildPacket(org.id, await localId(org.id, "dp_fdemo"))).resolves.toBeTruthy();
    expect(await disputesRepo.countBillableThisMonth(org.id)).toBe(4);
  });
});

describe("writeNarrative", () => {
  it("stores the guardrail-checked statement and what was removed", async () => {
    const { org } = await setup("pro", [pnr("dp_n1", "ch_n1")]);
    const id = await localId(org.id, "dp_n1");
    const narrative = [
      "What was purchased",
      "The customer placed an order for $129.00.",
      "The order total was $129.00 and was paid by card.",
      "The order was sent to the address given at checkout.",
      "The customer confirmed receipt by email on 2026-01-01.",
    ].join("\n");
    const result = await writeNarrative(org.id, id, { generate: stubGenerate(narrative) });

    const packet = await packetsRepo.getById(org.id, result.packet.id);
    expect(packet?.narrative).toContain("$129.00");
    expect(packet?.narrative).not.toContain("2026-01-01");
    expect(packet?.narrativeMeta?.model).toBe("stub-model");
    expect(packet?.narrativeMeta?.promptVersion).toBe("narrative/v1");
    expect(packet?.narrativeMeta?.removed?.some((r) => r.kind === "date" && r.text.includes("2026-01-01"))).toBe(true);
    expect(packet?.narrativeMeta?.verified?.some((v) => v.kind === "amount")).toBe(true);
    expect(result.removedCount).toBe(1);
  });
});

describe("attachments, PDF and submit", () => {
  it("uploads a file to Stripe as dispute evidence and the field counts as present", async () => {
    const { org, fake } = await setup("pro", [pnr("dp_a1", "ch_a1")]);
    const id = await localId(org.id, "dp_a1");
    await buildPacket(org.id, id);
    const result = await uploadAttachment(
      org.id,
      id,
      { fileName: "proof.pdf", mimeType: "application/pdf", bytes: PDF_BYTES },
      "shipping_documentation",
      fake.deps,
    );
    expect(result.stripeFileId).toBe("file_test1");
    expect(result.warning).toBeNull();
    expect(fake.calls.files[0]).toMatchObject({ purpose: "dispute_evidence", file: { name: "proof.pdf", type: "application/pdf" } });
    const packet = await packetsRepo.getByDispute(org.id, id);
    expect(packet?.missing).not.toContain("shipping_documentation");
    expect(packet?.fields.shipping_documentation).toMatchObject({ source: "attachment", sourceId: "file_test1" });

    await expect(
      uploadAttachment(org.id, id, { fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }, "customer_name", fake.deps),
    ).rejects.toThrow(/Choose which evidence field/);
    await expect(
      uploadAttachment(org.id, id, { fileName: "fake.pdf", mimeType: "application/pdf", bytes: Buffer.from("hello") }, "receipt", fake.deps),
    ).rejects.toMatchObject({ code: "unsupported_file" });
  });

  it("renders the PDF once and serves the stored copy until the content changes", async () => {
    const { org } = await setup("pro", [pnr("dp_p1", "ch_p1")]);
    const id = await localId(org.id, "dp_p1");
    await buildPacket(org.id, id);
    const first = await renderPdf(org.id, id);
    expect(first.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(first.fileName).toBe("disputely-dp_p1.pdf");
    expect((await packetsRepo.getByDispute(org.id, id))?.hasPdf).toBe(true);
    const second = await renderPdf(org.id, id);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    await buildPacket(org.id, id);
    expect((await packetsRepo.getByDispute(org.id, id))?.hasPdf).toBe(false);
  }, 60_000);

  it("Free cannot submit a real dispute through the API", async () => {
    const { org, fake } = await setup("free", [pnr("dp_s0", "ch_s0")]);
    const id = await localId(org.id, "dp_s0");
    await buildPacket(org.id, id);
    await expect(submitPacket(org.id, id, { confirm: true }, fake.deps)).rejects.toMatchObject({
      name: "PlanLimitError",
      code: "one_click_submit",
    });
    expect(fake.calls.update).toHaveLength(0);
  });

  it("Pro submits with submit: true, freezes the exact payload and re-syncs the outcome", async () => {
    const { org, fake } = await setup("pro", [pnr("dp_s1", "ch_s1", { metadata: { disputely_demo: "1" } })]);
    const id = await localId(org.id, "dp_s1");
    await buildPacket(org.id, id);
    await uploadAttachment(org.id, id, { fileName: "pod.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }, "shipping_documentation", fake.deps);

    await expect(submitPacket(org.id, id, { confirm: false }, fake.deps)).rejects.toThrow(/Confirm/);

    const result = await submitPacket(org.id, id, { confirm: true, testOutcome: "winning_evidence" }, fake.deps);
    expect(fake.calls.update).toHaveLength(1);
    const { id: stripeId, params } = fake.calls.update[0];
    expect(stripeId).toBe("dp_s1");
    expect(params.submit).toBe(true);
    expect(params.evidence?.uncategorized_text).toBe("winning_evidence");
    expect(params.evidence?.shipping_documentation).toBe("file_test1");
    expect(params.evidence?.customer_name).toBe("Jordan Ellis");
    // File fields never carry text.
    expect(params.evidence?.customer_communication).toBeUndefined();

    expect(result.packet.status).toBe("submitted");
    expect(result.packet.submittedSnapshot).toEqual(params.evidence);
    expect(result.packet.stripeResponse).toMatchObject({ id: "dp_s1", status: "won" });
    expect(result.dispute.status).toBe("won");
    expect(fake.calls.retrieve).toContain("dp_s1");

    await expect(submitPacket(org.id, id, { confirm: true }, fake.deps)).rejects.toMatchObject({ code: "conflict" });
    await expect(buildPacket(org.id, id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("without a simulated outcome the narrative leads and un-uploaded file fields are inlined", async () => {
    const { org, fake } = await setup("pro", [pnr("dp_s2", "ch_s2")]);
    const id = await localId(org.id, "dp_s2");
    await messageLogsRepo.add(org.id, {
      customerEmail: "jordan.ellis@example.com",
      occurredAt: new Date(Date.now() - DAY_MS),
      direction: "inbound",
      body: "Where is my parcel?",
    });
    await writeNarrative(org.id, id, { generate: stubGenerate("What was purchased\nThe customer placed an order for $129.00.") });
    await submitPacket(org.id, id, { confirm: true }, fake.deps);
    const text = fake.calls.update[0].params.evidence?.uncategorized_text ?? "";
    expect(text.startsWith("What was purchased")).toBe(true);
    expect(text).toContain("CUSTOMER COMMUNICATION");
    expect(text).toContain("Where is my parcel?");
  });

  it("refuses simulated outcomes on live-mode disputes", async () => {
    const { org, fake } = await setup("pro", [pnr("dp_s3", "ch_s3", { livemode: true })]);
    const id = await localId(org.id, "dp_s3");
    await buildPacket(org.id, id);
    await expect(submitPacket(org.id, id, { confirm: true, testOutcome: "winning_evidence" }, fake.deps)).rejects.toThrow(
      /test mode/,
    );
  });

  it("Free may submit demo (test-mode) disputes so the demo runs end to end", async () => {
    const { org, fake } = await setup("free", [pnr("dp_s4", "ch_s4", { metadata: { disputely_demo: "1" } })]);
    const id = await localId(org.id, "dp_s4");
    await buildPacket(org.id, id);
    const result = await submitPacket(org.id, id, { confirm: true, testOutcome: "losing_evidence" }, fake.deps);
    expect(result.dispute.status).toBe("lost");
  });
});
