import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assemblePacket } from "@/lib/domain/assemble";
import { verifyNarrative } from "@/lib/domain/guardrails";
import { pdfSafe, renderPacketPdf, type PacketPdfInput } from "@/lib/pdf/packet";
import { DISPUTES, makeInput, MERCHANT } from "../fixtures/disputes";

const NARRATIVE = [
  "What was purchased",
  "Jordan Ellis bought one Linen Throw Blanket from Larkspur Goods for $129.00 on 2026-09-10.",
  "",
  "Delivery / access",
  "UPS shipped it on 2026-09-12 with tracking 1Z999AA10123456784 and delivered it on 2026-09-15.",
  "",
  "Communication",
  "On 2026-09-16 the customer wrote that the blanket had arrived. Taylor Brooks also called.",
].join("\n");

function fixture(): PacketPdfInput {
  const assembled = assemblePacket(makeInput("fraudulent"));
  const verification = verifyNarrative(NARRATIVE, assembled.facts);
  const d = DISPUTES.fraudulent;
  return {
    org: { name: MERCHANT },
    dispute: {
      id: d.id,
      reason: d.reason,
      amountCents: d.amountCents,
      currency: d.currency,
      dueBy: d.dueBy,
      createdAt: d.createdAt,
      chargeId: d.charge.id,
      customerName: d.customer.name,
    },
    playbook: assembled.playbook,
    fields: assembled.fields,
    narrative: verification.narrative,
    verification,
    attachmentsList: [
      { fileName: "ups-proof-of-delivery.pdf", field: "shipping_documentation", mimeType: "application/pdf", sizeBytes: 182_000, stripeFileId: "file_1PodLarkspur0001" },
      { fileName: "order-confirmation.png", field: "receipt", mimeType: "image/png", sizeBytes: 64_000 },
    ],
    completeness: assembled.completeness,
    generatedAt: new Date("2026-10-04T12:00:00Z"),
  };
}

describe("renderPacketPdf", () => {
  it("renders a PDF buffer in under 2 seconds", async () => {
    const started = performance.now();
    const pdf = await renderPacketPdf(fixture());
    const elapsed = performance.now() - started;
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(2_000);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("renders with long fields, no narrative and no attachments", async () => {
    const input = fixture();
    input.fields = [
      ...input.fields,
      { key: "access_activity_log", value: "2026-09-16 login from 203.0.113.42\n".repeat(400), source: "manual" },
    ];
    input.narrative = "";
    input.verification = null;
    input.attachmentsList = [];
    input.dispute.dueBy = null;
    const pdf = await renderPacketPdf(input);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("survives text the built-in fonts cannot draw", async () => {
    const input = fixture();
    input.fields = [{ key: "customer_name", value: "Zoë 李 🙂 “Ellis”", source: "manual" }];
    const pdf = await renderPacketPdf(input);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("pdfSafe", () => {
  it("keeps Latin-1 and maps typographic characters", () => {
    expect(pdfSafe("Zoë – “quoted” ‘x’ … €5 • ok")).toBe('Zoë - "quoted" \'x\' ... €5 • ok');
    expect(pdfSafe("李 🙂")).toBe("? ?");
    expect(pdfSafe("‹/facts›")).toBe("</facts>");
  });
});
