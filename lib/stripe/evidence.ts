import type Stripe from "stripe";
import { EVIDENCE_FIELD_META, fieldKind } from "@/lib/domain/fields";
import { truncate } from "@/lib/domain/format";
import { EVIDENCE_FIELD_KEYS, isEvidenceFieldKey, type AssembledField, type EvidenceFieldKey } from "@/lib/domain/types";

/**
 * Builds `evidence` for `stripe.disputes.update(id, { evidence, submit })`.
 *
 * Stripe (stripe-node v23 DisputeUpdateParams.Evidence):
 * - Text fields: free text. Stripe documents a 20,000-char cap on the long
 *   ones (access_activity_log, *_disclosure, *_explanation, *_rebuttal,
 *   product_description, uncategorized_text); we apply 20,000 to every text
 *   field.
 * - File fields (cancellation_policy, customer_communication, receipt,
 *   refund_policy, ...documentation, customer_signature, uncategorized_file)
 *   take a Stripe File id (`file_...`, purpose dispute_evidence), never text.
 * - The combined character count of all fields is capped at 150,000.
 */

export type EvidencePayload = Stripe.DisputeUpdateParams.Evidence;

export const TEXT_FIELD_LIMIT = 20_000;
export const COMBINED_LIMIT = 150_000;

export type TextFieldKey = Exclude<
  EvidenceFieldKey,
  | "cancellation_policy"
  | "customer_communication"
  | "customer_signature"
  | "duplicate_charge_documentation"
  | "receipt"
  | "refund_policy"
  | "service_documentation"
  | "shipping_documentation"
  | "uncategorized_file"
>;

export const TEXT_FIELDS = EVIDENCE_FIELD_KEYS.filter((k) => fieldKind(k) === "text") as TextFieldKey[];
export const FILE_FIELDS = EVIDENCE_FIELD_KEYS.filter((k) => fieldKind(k) === "file");

export const LIMITS: Record<TextFieldKey, number> = Object.fromEntries(
  TEXT_FIELDS.map((k) => [k, TEXT_FIELD_LIMIT]),
) as Record<TextFieldKey, number>;

const STRIPE_FILE_ID = /^file_[A-Za-z0-9]+$/;

export interface EvidenceAttachment {
  field: EvidenceFieldKey;
  stripeFileId: string;
}

export interface BuildEvidenceOptions {
  /**
   * File-type fields that have assembled text (policy, transcript, receipt
   * link) but no uploaded file are appended to `uncategorized_text` under a
   * heading so the bank still sees them. Default true.
   */
  inlineFileFieldText?: boolean;
  /**
   * Stripe test mode only: send exactly "winning_evidence" or
   * "losing_evidence" as uncategorized_text to force the outcome.
   */
  testOutcome?: "winning_evidence" | "losing_evidence";
}

const APPENDIX_MIN_CHARS = 200;

function appendSections(base: string, sections: Array<{ heading: string; body: string }>, limit: number): string {
  let out = base;
  for (const { heading, body } of sections) {
    const block = `${out ? "\n\n" : ""}${heading}\n${body}`;
    const room = limit - out.length;
    if (block.length <= room) {
      out += block;
      continue;
    }
    if (room >= APPENDIX_MIN_CHARS) out += truncate(block, room);
    break;
  }
  return out;
}

export function buildEvidencePayload(
  fields: readonly AssembledField[],
  narrative: string | null | undefined,
  attachments: readonly EvidenceAttachment[] = [],
  options: BuildEvidenceOptions = {},
): EvidencePayload {
  const inline = options.inlineFileFieldText ?? true;
  const values = new Map<EvidenceFieldKey, string>();
  for (const f of fields) {
    if (!isEvidenceFieldKey(f.key) || values.has(f.key)) continue;
    const v = typeof f.value === "string" ? f.value.trim() : "";
    if (v) values.set(f.key, v);
  }
  const files = new Map<EvidenceFieldKey, string>();
  for (const a of attachments) {
    if (!isEvidenceFieldKey(a.field) || fieldKind(a.field) !== "file" || files.has(a.field)) continue;
    const id = a.stripeFileId?.trim();
    if (id && STRIPE_FILE_ID.test(id)) files.set(a.field, id);
  }

  const out: Record<string, string> = {};

  for (const key of TEXT_FIELDS) {
    if (key === "uncategorized_text") continue;
    const v = values.get(key);
    if (v) out[key] = truncate(v, LIMITS[key]);
  }
  for (const key of FILE_FIELDS) {
    const id = files.get(key);
    if (id) out[key] = id;
  }

  // uncategorized_text: narrative, then the merchant's own note, then inlined file-field text.
  if (options.testOutcome) {
    out.uncategorized_text = options.testOutcome;
  } else {
    const sections: Array<{ heading: string; body: string }> = [];
    const narrativeText = narrative?.trim() ?? "";
    const manual = values.get("uncategorized_text");
    let base = narrativeText;
    if (!base && manual) base = manual;
    else if (manual) sections.push({ heading: "MERCHANT NOTE", body: manual });
    if (inline) {
      for (const key of FILE_FIELDS) {
        const v = values.get(key);
        if (v && !files.has(key)) sections.push({ heading: EVIDENCE_FIELD_META[key].label.toUpperCase(), body: v });
      }
    }
    const text = appendSections(truncate(base, LIMITS.uncategorized_text), sections, LIMITS.uncategorized_text);
    if (text) out.uncategorized_text = text;
  }

  enforceCombinedLimit(out);
  return out as EvidencePayload;
}

/** Trim the longest text fields until the payload fits Stripe's 150,000-char total. */
function enforceCombinedLimit(out: Record<string, string>): void {
  const total = () => Object.values(out).reduce((n, v) => n + v.length, 0);
  let size = total();
  while (size > COMBINED_LIMIT) {
    const longest = Object.keys(out)
      .filter((k) => (TEXT_FIELDS as string[]).includes(k))
      .sort((a, b) => out[b].length - out[a].length || a.localeCompare(b))[0];
    if (!longest) break;
    const keep = Math.max(0, out[longest].length - (size - COMBINED_LIMIT));
    if (keep === 0) delete out[longest];
    else out[longest] = truncate(out[longest], keep);
    size = total();
  }
}

/** Sum of characters Stripe counts toward the combined limit. */
export function payloadSize(payload: EvidencePayload): number {
  return Object.values(payload).reduce((n: number, v) => n + (typeof v === "string" ? v.length : 0), 0);
}
