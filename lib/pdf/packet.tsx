import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type React from "react";
import { EVIDENCE_FIELD_META } from "@/lib/domain/fields";
import { formatLongDate, formatMoney, isoDay } from "@/lib/domain/format";
import { isSectionHeading, type NarrativeVerification } from "@/lib/domain/guardrails";
import type { Playbook } from "@/lib/domain/playbooks";
import type { AssembledField, DisputeReason, EvidenceFieldKey, FieldSource } from "@/lib/domain/types";

/**
 * The evidence packet PDF (spec 3.5): cover, evidence table, narrative with
 * verified facts, attachments index, and full text of long fields.
 * Built-in Helvetica/Courier only (no remote fonts), so text is reduced to
 * the WinAnsi character set those fonts can draw.
 */

export interface PacketAttachment {
  fileName: string;
  field?: EvidenceFieldKey | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  stripeFileId?: string | null;
}

export interface PacketPdfInput {
  org: { name: string };
  dispute: {
    id: string;
    reason: DisputeReason;
    amountCents: number;
    currency: string;
    dueBy?: string | null;
    createdAt?: string | null;
    chargeId?: string | null;
    customerName?: string | null;
  };
  playbook: Playbook;
  fields: AssembledField[];
  narrative: string;
  verification?: NarrativeVerification | null;
  attachmentsList: PacketAttachment[];
  completeness?: number | null;
  generatedAt: Date | string;
}

/** Field values longer than this are shortened in the table and printed in full in the appendix. */
export const TABLE_VALUE_CHARS = 500;

const COLORS = { slate: "#1B2430", linen: "#F8F6F1", oxide: "#B4452E", steel: "#4A6FA5", olive: "#6B7F3A", grey: "#6B7280" };

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: COLORS.slate, lineHeight: 1.4 },
  coverBand: { backgroundColor: COLORS.linen, padding: 18, marginBottom: 18, borderLeftWidth: 4, borderLeftColor: COLORS.oxide },
  eyebrow: { fontSize: 8, letterSpacing: 1.2, color: COLORS.grey, marginBottom: 4 },
  store: { fontSize: 22, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 6 },
  subtitle: { fontSize: 11, color: COLORS.grey },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  cell: { width: "50%", paddingVertical: 6, paddingRight: 12 },
  label: { fontSize: 7.5, color: COLORS.grey, letterSpacing: 0.8, marginBottom: 2 },
  value: { fontSize: 11 },
  mono: { fontFamily: "Courier" },
  deadline: { fontFamily: "Courier-Bold", fontSize: 14, color: COLORS.oxide },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 8 },
  para: { marginBottom: 6 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderColor: COLORS.slate, paddingBottom: 3, marginBottom: 2 },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: COLORS.grey, letterSpacing: 0.6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#D6D3CC", paddingVertical: 4 },
  cField: { width: "24%", paddingRight: 6, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  cValue: { width: "58%", paddingRight: 6, fontSize: 8.5 },
  cSource: { width: "18%", fontSize: 8, color: COLORS.grey },
  narrative: { backgroundColor: COLORS.linen, padding: 12, marginBottom: 10 },
  heading: { fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 2 },
  fact: { fontSize: 8.5, marginBottom: 2 },
  removed: { fontSize: 8.5, color: COLORS.oxide, marginBottom: 2 },
  appendixText: { fontFamily: "Courier", fontSize: 7.5, lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 24, left: 44, fontSize: 7.5, color: COLORS.grey },
});

const SOURCE_LABEL: Record<FieldSource, string> = {
  stripe_charge: "Stripe charge",
  stripe_customer: "Stripe customer",
  stripe_checkout: "Stripe Checkout",
  library: "Policy library",
  shipment: "Shipment record",
  message_log: "Message log",
  manual: "Entered by merchant",
  model: "Generated",
};

/** Keep what the built-in (WinAnsi) fonts can draw; replace the rest. */
export function pdfSafe(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u2039/g, "<")
    .replace(/\u203A/g, ">")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\n\t\u0020-\u007E\u00A0-\u00FF\u2022\u20AC]/gu, "?");
}

function sizeLabel(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function shortValue(value: string): string {
  return value.length > TABLE_VALUE_CHARS ? `${value.slice(0, TABLE_VALUE_CHARS).trimEnd()}... (full text in appendix)` : value;
}

/** One section per Page so every page (including wrapped ones) gets the footer. */
function Section({ date, children }: { date: string; children: React.ReactNode }) {
  return (
    <Page size="LETTER" style={s.page}>
      {children}
      {/* A static absolute Text: react-pdf 4.9 drops absolute Views and render-prop Texts here. */}
      <Text style={s.footer} fixed>
        {pdfSafe(`Generated by Disputely · ${date}`)}
      </Text>
    </Page>
  );
}

export function PacketDocument(props: PacketPdfInput) {
  const { org, dispute, playbook, fields, verification, attachmentsList } = props;
  const generated = isoDay(typeof props.generatedAt === "string" ? props.generatedAt : props.generatedAt.toISOString()) ?? "";
  const dueDay = isoDay(dispute.dueBy ?? null);
  const narrativeLines = pdfSafe(props.narrative.trim()).split("\n");
  const longFields = fields.filter((f) => f.value.length > TABLE_VALUE_CHARS);
  const verified = verification?.verified ?? [];
  const removed = (verification?.removed ?? []).filter((r) => r.kind !== "length");

  return (
    <Document title={pdfSafe(`Dispute evidence ${dispute.id}`)} author={pdfSafe(org.name)} creator="Disputely" producer="Disputely">
      <Section date={generated}>
        <View style={s.coverBand}>
          <Text style={s.eyebrow}>DISPUTE EVIDENCE PACKET</Text>
          <Text style={s.store}>{pdfSafe(org.name)}</Text>
          <Text style={s.subtitle}>{pdfSafe(`${playbook.title} dispute · ${formatMoney(dispute.amountCents, dispute.currency)}`)}</Text>
        </View>
        <View style={s.grid}>
          <View style={s.cell}>
            <Text style={s.label}>DISPUTE ID</Text>
            <Text style={[s.value, s.mono]}>{pdfSafe(dispute.id)}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.label}>AMOUNT</Text>
            <Text style={[s.value, s.mono]}>{formatMoney(dispute.amountCents, dispute.currency)}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.label}>REASON</Text>
            <Text style={s.value}>{pdfSafe(`${playbook.title} (${dispute.reason})`)}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.label}>EVIDENCE DUE</Text>
            <Text style={s.deadline}>{dueDay ? formatLongDate(dueDay) : "No response window"}</Text>
          </View>
          {dispute.chargeId ? (
            <View style={s.cell}>
              <Text style={s.label}>CHARGE</Text>
              <Text style={[s.value, s.mono]}>{pdfSafe(dispute.chargeId)}</Text>
            </View>
          ) : null}
          {dispute.customerName ? (
            <View style={s.cell}>
              <Text style={s.label}>CUSTOMER</Text>
              <Text style={s.value}>{pdfSafe(dispute.customerName)}</Text>
            </View>
          ) : null}
          {typeof props.completeness === "number" ? (
            <View style={s.cell}>
              <Text style={s.label}>COMPLETENESS</Text>
              <Text style={[s.value, s.mono]}>{`${props.completeness}%`}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.h2}>About this dispute type</Text>
        <Text style={s.para}>{pdfSafe(playbook.summary)}</Text>

      </Section>

      <Section date={generated}>
        <Text style={s.h2}>Evidence</Text>
        <View style={s.tableHead}>
          <Text style={[s.th, s.cField]}>FIELD</Text>
          <Text style={[s.th, s.cValue]}>VALUE</Text>
          <Text style={[s.th, s.cSource]}>SOURCE</Text>
        </View>
        {fields.length === 0 ? <Text style={s.para}>No evidence fields assembled.</Text> : null}
        {fields.map((f) => (
          <View key={f.key} style={s.tr} wrap={false}>
            <Text style={s.cField}>{EVIDENCE_FIELD_META[f.key].label}</Text>
            <Text style={s.cValue}>{pdfSafe(shortValue(f.value))}</Text>
            <Text style={s.cSource}>{pdfSafe(f.sourceLabel ? `${SOURCE_LABEL[f.source]}: ${f.sourceLabel}` : SOURCE_LABEL[f.source])}</Text>
          </View>
        ))}
      </Section>

      <Section date={generated}>
        <Text style={s.h2}>Statement</Text>
        <View style={s.narrative}>
          {props.narrative.trim() ? (
            narrativeLines.map((line, i) =>
              line.trim() === "" ? (
                <Text key={i}> </Text>
              ) : (
                <Text key={i} style={isSectionHeading(line) ? s.heading : undefined}>
                  {line}
                </Text>
              ),
            )
          ) : (
            <Text>No statement written yet.</Text>
          )}
        </View>
        {verified.length > 0 ? (
          <View wrap={false}>
            <Text style={s.label}>FACTS VERIFIED AGAINST THE EVIDENCE</Text>
            {verified.map((v, i) => (
              <Text key={`${v.kind}-${i}`} style={s.fact}>
                {pdfSafe(`• ${v.text} (${v.kind})`)}
              </Text>
            ))}
          </View>
        ) : null}
        {removed.length > 0 ? (
          <View>
            <Text style={[s.label, { marginTop: 8 }]}>REMOVED BY GUARDRAILS (NOT IN THE EVIDENCE)</Text>
            {removed.map((r, i) => (
              <Text key={i} style={s.removed}>
                {pdfSafe(`• ${r.text} [${r.kind}${r.claim ? `: ${r.claim}` : ""}]`)}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={s.h2}>Attachments</Text>
        {attachmentsList.length === 0 ? <Text style={s.para}>No files attached.</Text> : null}
        {attachmentsList.map((a, i) => (
          <Text key={`${a.fileName}-${i}`} style={s.fact}>
            {pdfSafe(
              [
                `${i + 1}. ${a.fileName}`,
                a.field ? EVIDENCE_FIELD_META[a.field].label : "",
                a.mimeType ?? "",
                sizeLabel(a.sizeBytes),
                a.stripeFileId ?? "",
              ]
                .filter(Boolean)
                .join(" · "),
            )}
          </Text>
        ))}

      </Section>

      {longFields.length > 0 ? (
        <Section date={generated}>
          {/* Direct children of the Page: react-pdf mis-measures page-spanning Text nested in Views. */}
          <Text style={s.h2}>Appendix: full text</Text>
          {longFields.flatMap((f) => [
            <Text key={`${f.key}-label`} style={s.label} minPresenceAhead={40}>
              {EVIDENCE_FIELD_META[f.key].label.toUpperCase()}
            </Text>,
            <Text key={`${f.key}-text`} style={[s.appendixText, { marginBottom: 10 }]}>
              {pdfSafe(f.value)}
            </Text>,
          ])}
        </Section>
      ) : null}
    </Document>
  );
}

export async function renderPacketPdf(input: PacketPdfInput): Promise<Buffer> {
  return renderToBuffer(<PacketDocument {...input} />);
}
