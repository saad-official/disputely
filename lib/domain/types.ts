import { z } from "zod";

/**
 * Domain types for Disputely (spec 3.3-3.6).
 *
 * Conventions
 * - Calendar dates are "YYYY-MM-DD" strings (IsoDate); instants are ISO
 *   datetime strings so fixtures stay JSON-serialisable.
 * - Money is integer minor units ("cents") plus a lower-case ISO currency.
 * - JSON shapes are camelCase to match the `disputes.*` jsonb columns written
 *   by the sync normaliser (lib/db/schema.ts).
 * - Model-output schemas never use `.optional()`: Groq structured outputs run
 *   in strict JSON-schema mode, which requires every property to be present.
 */
export type IsoDate = string;
export type IsoDateTime = string;

/* ------------------------------------------------------------------ */
/* Reasons and statuses                                                */
/* ------------------------------------------------------------------ */

export const DISPUTE_REASONS = [
  "fraudulent",
  "product_not_received",
  "product_unacceptable",
  "subscription_canceled",
  "duplicate",
  "credit_not_processed",
  "unrecognized",
  "general",
  "other",
] as const;
export const DisputeReasonSchema = z.enum(DISPUTE_REASONS);
export type DisputeReason = z.infer<typeof DisputeReasonSchema>;

/** Stripe's reason string; anything without a playbook becomes `other`. */
export function toDisputeReason(reason: string | null | undefined): DisputeReason {
  return (DISPUTE_REASONS as readonly string[]).includes(reason ?? "") ? (reason as DisputeReason) : "other";
}

export const DISPUTE_STATUSES = [
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "won",
  "lost",
  "charge_refunded",
  "prevented",
] as const;
export const DisputeStatusSchema = z.enum(DISPUTE_STATUSES);
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;

/** Statuses where the merchant can still submit evidence. */
export const NEEDS_RESPONSE_STATUSES: readonly DisputeStatus[] = ["warning_needs_response", "needs_response"];

export function needsResponse(status: DisputeStatus): boolean {
  return NEEDS_RESPONSE_STATUSES.includes(status);
}

/* ------------------------------------------------------------------ */
/* Stripe evidence fields                                              */
/* ------------------------------------------------------------------ */

/** Keys of `Stripe.DisputeUpdateParams.Evidence` (excluding `enhanced_evidence`). */
export const EVIDENCE_FIELD_KEYS = [
  "access_activity_log",
  "billing_address",
  "cancellation_policy",
  "cancellation_policy_disclosure",
  "cancellation_rebuttal",
  "customer_communication",
  "customer_email_address",
  "customer_name",
  "customer_purchase_ip",
  "customer_signature",
  "duplicate_charge_documentation",
  "duplicate_charge_explanation",
  "duplicate_charge_id",
  "product_description",
  "receipt",
  "refund_policy",
  "refund_policy_disclosure",
  "refund_refusal_explanation",
  "service_date",
  "service_documentation",
  "shipping_address",
  "shipping_carrier",
  "shipping_date",
  "shipping_documentation",
  "shipping_tracking_number",
  "uncategorized_file",
  "uncategorized_text",
] as const;
export const EvidenceFieldKeySchema = z.enum(EVIDENCE_FIELD_KEYS);
export type EvidenceFieldKey = z.infer<typeof EvidenceFieldKeySchema>;

export function isEvidenceFieldKey(value: unknown): value is EvidenceFieldKey {
  return typeof value === "string" && (EVIDENCE_FIELD_KEYS as readonly string[]).includes(value);
}

export const FIELD_SOURCES = [
  "stripe_charge",
  "stripe_customer",
  "stripe_checkout",
  "library",
  "shipment",
  "message_log",
  "manual",
  "model",
] as const;
export const FieldSourceSchema = z.enum(FIELD_SOURCES);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

/**
 * The packets.fields jsonb column uses a coarser source vocabulary
 * (lib/db/schema.ts FIELD_SOURCES). Map before persisting.
 */
export type StorageFieldSource = "stripe" | "library" | "message_log" | "shipment" | "attachment" | "merchant" | "model";

export function toStorageSource(source: FieldSource, hasFile = false): StorageFieldSource {
  if (hasFile) return "attachment";
  switch (source) {
    case "stripe_charge":
    case "stripe_customer":
    case "stripe_checkout":
      return "stripe";
    case "manual":
      return "merchant";
    default:
      return source;
  }
}

export const AssembledFieldSchema = z.object({
  key: EvidenceFieldKeySchema,
  value: z.string(),
  source: FieldSourceSchema,
  /** Local attachment id (or Stripe file id) backing a file-type field. */
  fileId: z.string().optional(),
  /** Human detail for the source, e.g. the library item title. */
  sourceLabel: z.string().optional(),
});
export type AssembledField = z.infer<typeof AssembledFieldSchema>;

/* ------------------------------------------------------------------ */
/* Assembler inputs                                                    */
/* ------------------------------------------------------------------ */

export const PostalAddressSchema = z.object({
  line1: z.string().nullish(),
  line2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  country: z.string().nullish(),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

export const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().int().positive().nullish(),
  /** Line total in minor units. */
  amountCents: z.number().int().nullish(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

/** A dispute after sync, normalised from Stripe dispute + charge + customer + Checkout. */
export const NormalisedDisputeSchema = z.object({
  /** Stripe `dp_...` / `du_...` id. */
  id: z.string(),
  reason: DisputeReasonSchema,
  status: DisputeStatusSchema.optional(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  createdAt: z.string(),
  /** evidence_details.due_by as ISO datetime; null when the bank allows no response. */
  dueBy: z.string().nullish(),
  /** Product line used to pick library templates (Pro). */
  productLine: z.string().nullish(),
  customer: z.object({
    name: z.string().nullish(),
    email: z.string().nullish(),
    ip: z.string().nullish(),
  }),
  charge: z.object({
    id: z.string(),
    createdAt: z.string().nullish(),
    description: z.string().nullish(),
    receiptUrl: z.string().nullish(),
    billingDetails: z
      .object({
        name: z.string().nullish(),
        email: z.string().nullish(),
        address: PostalAddressSchema.nullish(),
      })
      .nullish(),
  }),
  shipping: z
    .object({
      name: z.string().nullish(),
      address: PostalAddressSchema.nullish(),
      carrier: z.string().nullish(),
      trackingNumber: z.string().nullish(),
    })
    .nullish(),
  checkout: z
    .object({
      lineItems: z.array(LineItemSchema),
      shippingAddress: PostalAddressSchema.nullish(),
    })
    .nullish(),
});
export type NormalisedDispute = z.infer<typeof NormalisedDisputeSchema>;

export const LIBRARY_KINDS = [
  "refund_policy",
  "cancellation_policy",
  "terms",
  "product_description",
  "shipping_policy",
  "disclosure",
  "other",
] as const;
export const LibraryKindSchema = z.enum(LIBRARY_KINDS);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LibraryItemSchema = z.object({
  id: z.string(),
  kind: LibraryKindSchema,
  title: z.string(),
  text: z.string(),
  url: z.string().nullish(),
  /** null / undefined = org default for every product line. */
  productLine: z.string().nullish(),
  /**
   * For kind "disclosure": which policy it discloses. When absent the
   * assembler infers it from the title/text ("refund", "cancel", "shipping").
   */
  appliesTo: z.enum(["refund_policy", "cancellation_policy", "shipping_policy", "terms"]).nullish(),
  updatedAt: z.string().nullish(),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const ShipmentSchema = z.object({
  id: z.string().optional(),
  chargeId: z.string(),
  carrier: z.string().nullish(),
  trackingNumber: z.string().nullish(),
  shippedAt: z.string().nullish(),
  deliveredAt: z.string().nullish(),
  proofUrl: z.string().nullish(),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const MessageLogSchema = z.object({
  id: z.string().optional(),
  /** Local dispute id or Stripe dispute id; either links the message to the dispute. */
  disputeId: z.string().nullish(),
  customerEmail: z.string(),
  channel: z.enum(["email", "chat", "phone", "sms", "other"]),
  occurredAt: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
});
export type MessageLog = z.infer<typeof MessageLogSchema>;

/* ------------------------------------------------------------------ */
/* Facts (the only things the narrative may assert)                    */
/* ------------------------------------------------------------------ */

export const FactsSchema = z.object({
  merchantName: z.string().nullable(),
  currency: z.string(),
  /** Display strings: "$129.00" and "129.00" for every amount. */
  amounts: z.array(z.string()),
  /** The same amounts in minor units (what guardrails compare). */
  amountCents: z.array(z.number().int()),
  /** ISO days, sorted. */
  dates: z.array(z.string()),
  names: z.array(z.string()),
  emails: z.array(z.string()),
  addresses: z.array(z.string()),
  trackingNumbers: z.array(z.string()),
  carriers: z.array(z.string()),
  productNames: z.array(z.string()),
  policyTitles: z.array(z.string()),
  /** Stripe ids (charge, duplicate charge) and receipt numbers. */
  ids: z.array(z.string()),
  ips: z.array(z.string()),
  /** Short dated excerpts of the customer communication, oldest first. */
  messageExcerpts: z.array(z.string()),
});
export type Facts = z.infer<typeof FactsSchema>;

export function emptyFacts(currency = "usd"): Facts {
  return {
    merchantName: null,
    currency,
    amounts: [],
    amountCents: [],
    dates: [],
    names: [],
    emails: [],
    addresses: [],
    trackingNumbers: [],
    carriers: [],
    productNames: [],
    policyTitles: [],
    ids: [],
    ips: [],
    messageExcerpts: [],
  };
}

/* ------------------------------------------------------------------ */
/* Narrative (model output)                                            */
/* ------------------------------------------------------------------ */

export const NarrativeOutputSchema = z.object({
  narrative: z.string(),
  /** Facts the model says it used, copied from <facts>. */
  factsUsed: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type NarrativeOutput = z.infer<typeof NarrativeOutputSchema>;
