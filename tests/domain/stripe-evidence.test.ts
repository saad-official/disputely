import { describe, expect, it } from "vitest";
import type { AssembledField } from "@/lib/domain/types";
import {
  buildEvidencePayload,
  COMBINED_LIMIT,
  FILE_FIELDS,
  LIMITS,
  payloadSize,
  TEXT_FIELD_LIMIT,
  TEXT_FIELDS,
} from "@/lib/stripe/evidence";
import { PNR_ATTACHMENTS, PNR_EXPECTED_PAYLOAD, PNR_FIELDS, PNR_NARRATIVE } from "../fixtures/evidence";

describe("buildEvidencePayload", () => {
  it("matches the recorded payload exactly", () => {
    expect(buildEvidencePayload(PNR_FIELDS, PNR_NARRATIVE, PNR_ATTACHMENTS)).toStrictEqual(PNR_EXPECTED_PAYLOAD);
  });

  it("sends only Stripe file ids for file fields, never their text", () => {
    const payload = buildEvidencePayload(PNR_FIELDS, PNR_NARRATIVE, PNR_ATTACHMENTS, { inlineFileFieldText: false });
    expect(payload.customer_communication).toBeUndefined();
    expect(payload.refund_policy).toBeUndefined();
    expect(payload.shipping_documentation).toBe("file_1PodLarkspur0001");
    expect(payload.uncategorized_text).toBe(PNR_NARRATIVE);
  });

  it("does not inline a file field that has an uploaded file", () => {
    const payload = buildEvidencePayload(PNR_FIELDS, PNR_NARRATIVE, PNR_ATTACHMENTS);
    expect(payload.uncategorized_text).not.toContain("USPS shipment 9400111899223197428490, shipped");
  });

  it("ignores attachments on text fields, unknown fields and malformed file ids", () => {
    const payload = buildEvidencePayload(PNR_FIELDS, "", [
      { field: "customer_name", stripeFileId: "file_abc" },
      { field: "nonsense" as never, stripeFileId: "file_abc" },
      { field: "receipt", stripeFileId: "att_local_123" },
      { field: "receipt", stripeFileId: "file_second" },
      { field: "uncategorized_file", stripeFileId: " file_1Packet " },
    ]);
    expect(payload.customer_name).toBe("Morgan Reyes");
    expect(payload.receipt).toBe("file_second");
    expect(payload.uncategorized_file).toBe("file_1Packet");
    expect(Object.keys(payload)).not.toContain("nonsense");
  });

  it("never includes unknown keys or empty values", () => {
    const fields = [
      ...PNR_FIELDS,
      { key: "enhanced_evidence", value: "x", source: "manual" },
      { key: "made_up", value: "x", source: "manual" },
      { key: "access_activity_log", value: "   ", source: "manual" },
    ] as unknown as AssembledField[];
    const payload = buildEvidencePayload(fields, null, []);
    const allowed = new Set<string>([...TEXT_FIELDS, ...FILE_FIELDS]);
    for (const key of Object.keys(payload)) expect(allowed.has(key), key).toBe(true);
    expect(payload).not.toHaveProperty("access_activity_log");
    expect(payload).not.toHaveProperty("enhanced_evidence");
    expect(Object.values(payload).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });

  it("returns an empty object when there is nothing to send", () => {
    expect(buildEvidencePayload([], "  ", [])).toEqual({});
  });

  it("truncates text fields to Stripe's 20,000 characters", () => {
    const long = "a".repeat(25_000);
    const payload = buildEvidencePayload(
      [
        { key: "access_activity_log", value: long, source: "manual" },
        { key: "product_description", value: long, source: "manual" },
      ],
      long,
      [],
    );
    expect(payload.access_activity_log).toHaveLength(TEXT_FIELD_LIMIT);
    expect(payload.access_activity_log!.endsWith("[truncated]")).toBe(true);
    expect(payload.product_description).toHaveLength(TEXT_FIELD_LIMIT);
    expect(payload.uncategorized_text).toHaveLength(TEXT_FIELD_LIMIT);
  });

  it("keeps the narrative whole and truncates inlined text to fit uncategorized_text", () => {
    const transcript = "m".repeat(30_000);
    const payload = buildEvidencePayload(
      [{ key: "customer_communication", value: transcript, source: "message_log" }],
      PNR_NARRATIVE,
      [],
    );
    expect(payload.uncategorized_text!.startsWith(PNR_NARRATIVE)).toBe(true);
    expect(payload.uncategorized_text!.length).toBeLessThanOrEqual(LIMITS.uncategorized_text);
    expect(payload.uncategorized_text).toContain("CUSTOMER COMMUNICATION");
  });

  it("uses a manual uncategorized_text when there is no narrative, else appends it as a note", () => {
    const manual: AssembledField = { key: "uncategorized_text", value: "Customer is a repeat buyer.", source: "manual" };
    expect(buildEvidencePayload([manual], "", []).uncategorized_text).toBe("Customer is a repeat buyer.");
    expect(buildEvidencePayload([manual], "Narrative.", []).uncategorized_text).toBe(
      "Narrative.\n\nMERCHANT NOTE\nCustomer is a repeat buyer.",
    );
  });

  it("sends the exact test trigger in test mode", () => {
    const payload = buildEvidencePayload(PNR_FIELDS, PNR_NARRATIVE, PNR_ATTACHMENTS, { testOutcome: "winning_evidence" });
    expect(payload.uncategorized_text).toBe("winning_evidence");
    expect(payload.customer_name).toBe("Morgan Reyes");
  });

  it(`keeps the whole payload under ${COMBINED_LIMIT} characters`, () => {
    const fields: AssembledField[] = TEXT_FIELDS.filter((k) => k !== "uncategorized_text").map((key) => ({
      key,
      value: "z".repeat(19_000),
      source: "manual",
    }));
    const payload = buildEvidencePayload(fields, "n".repeat(2_000), []);
    expect(payloadSize(payload)).toBeLessThanOrEqual(COMBINED_LIMIT);
    expect(payload.uncategorized_text).toBe("n".repeat(2_000));
  });

  it("classifies Stripe's file fields", () => {
    expect([...FILE_FIELDS].sort()).toEqual(
      [
        "cancellation_policy",
        "customer_communication",
        "customer_signature",
        "duplicate_charge_documentation",
        "receipt",
        "refund_policy",
        "service_documentation",
        "shipping_documentation",
        "uncategorized_file",
      ].sort(),
    );
    expect(TEXT_FIELDS).toHaveLength(18);
  });
});
