import type { EvidenceFieldKey } from "./types";

/**
 * Per-field metadata for Stripe dispute evidence (stripe-node v23,
 * DisputeUpdateParams.Evidence).
 *
 * `kind: "file"` fields take a Stripe File id (purpose dispute_evidence) in the
 * API. Disputely still assembles readable text for them (policy text, message
 * transcript) so the packet PDF and the narrative can use it; the payload
 * builder only sends a file id for them.
 */
export type EvidenceFieldKind = "text" | "file";

export interface EvidenceFieldMeta {
  label: string;
  kind: EvidenceFieldKind;
  /** What it proves, for the "missing" list. */
  why: string;
  /** What the merchant should do to fill it. */
  howToFix: string;
}

export const EVIDENCE_FIELD_META: Record<EvidenceFieldKey, EvidenceFieldMeta> = {
  access_activity_log: {
    label: "Access activity log",
    kind: "text",
    why: "Shows the customer used or downloaded what they paid for.",
    howToFix: "Paste login or download logs with timestamps and IP addresses.",
  },
  billing_address: {
    label: "Billing address",
    kind: "text",
    why: "Matches the cardholder's address on file with the bank.",
    howToFix: "Collect the billing address at checkout, or enter it by hand.",
  },
  cancellation_policy: {
    label: "Cancellation policy",
    kind: "file",
    why: "Shows the cancellation terms the customer agreed to.",
    howToFix: "Add your cancellation policy to the policy library.",
  },
  cancellation_policy_disclosure: {
    label: "Cancellation policy disclosure",
    kind: "text",
    why: "Explains where and when the customer saw the cancellation policy.",
    howToFix: "Add a disclosure statement (e.g. 'shown as a required checkbox at checkout') to the library.",
  },
  cancellation_rebuttal: {
    label: "Cancellation rebuttal",
    kind: "text",
    why: "Explains why the subscription was not cancelled under your policy.",
    howToFix: "Write a short explanation of why no valid cancellation request was received.",
  },
  customer_communication: {
    label: "Customer communication",
    kind: "file",
    why: "Messages showing the customer received, used or was satisfied with the order.",
    howToFix: "Paste or upload the email or chat thread with this customer.",
  },
  customer_email_address: {
    label: "Customer email",
    kind: "text",
    why: "Ties the purchase to the cardholder.",
    howToFix: "Enter the customer's email address.",
  },
  customer_name: {
    label: "Customer name",
    kind: "text",
    why: "Ties the purchase to the cardholder.",
    howToFix: "Enter the customer's name.",
  },
  customer_purchase_ip: {
    label: "Purchase IP address",
    kind: "text",
    why: "Links the purchase to the customer's usual location or device.",
    howToFix: "Enter the IP address recorded at checkout.",
  },
  customer_signature: {
    label: "Customer signature",
    kind: "file",
    why: "A signed agreement or delivery signature from the customer.",
    howToFix: "Upload the signed document.",
  },
  duplicate_charge_documentation: {
    label: "Duplicate charge documentation",
    kind: "file",
    why: "Shows the two charges were for different orders.",
    howToFix: "Upload the receipt or invoice for the other charge.",
  },
  duplicate_charge_explanation: {
    label: "Duplicate charge explanation",
    kind: "text",
    why: "Explains how this charge differs from the one it looks like.",
    howToFix: "Explain the difference between the two charges (dates, items, order numbers).",
  },
  duplicate_charge_id: {
    label: "Other charge id",
    kind: "text",
    why: "Identifies the earlier charge the customer believes is a duplicate.",
    howToFix: "Enter the Stripe charge id (ch_...) of the other charge.",
  },
  product_description: {
    label: "Product description",
    kind: "text",
    why: "Tells the bank what was sold.",
    howToFix: "Add a product description to the library or describe the order.",
  },
  receipt: {
    label: "Receipt",
    kind: "file",
    why: "Proof the customer was notified of the charge.",
    howToFix: "Upload the receipt or order confirmation email.",
  },
  refund_policy: {
    label: "Refund policy",
    kind: "file",
    why: "Shows the refund terms the customer agreed to.",
    howToFix: "Add your refund policy to the policy library.",
  },
  refund_policy_disclosure: {
    label: "Refund policy disclosure",
    kind: "text",
    why: "Explains where and when the customer saw the refund policy.",
    howToFix: "Add a disclosure statement (e.g. 'linked above the Pay button at checkout') to the library.",
  },
  refund_refusal_explanation: {
    label: "Refund refusal explanation",
    kind: "text",
    why: "Explains why the customer is not owed a refund under your policy.",
    howToFix: "Write a short explanation, referencing your refund policy.",
  },
  service_date: {
    label: "Service date",
    kind: "text",
    why: "When the customer received or started using the service.",
    howToFix: "Enter the date the service was delivered or access began.",
  },
  service_documentation: {
    label: "Service documentation",
    kind: "file",
    why: "Proof the service was provided.",
    howToFix: "Upload a contract, work order or access record.",
  },
  shipping_address: {
    label: "Shipping address",
    kind: "text",
    why: "Shows where the order was sent.",
    howToFix: "Enter the address the order shipped to.",
  },
  shipping_carrier: {
    label: "Shipping carrier",
    kind: "text",
    why: "Lets the bank verify delivery with the carrier.",
    howToFix: "Add a shipment record for this charge with its carrier.",
  },
  shipping_date: {
    label: "Shipping date",
    kind: "text",
    why: "When the order left your warehouse.",
    howToFix: "Add a shipment record for this charge with the ship date.",
  },
  shipping_documentation: {
    label: "Shipping documentation",
    kind: "file",
    why: "Proof of delivery to the customer's address.",
    howToFix: "Upload the carrier's proof of delivery or shipping label.",
  },
  shipping_tracking_number: {
    label: "Tracking number",
    kind: "text",
    why: "Lets the bank confirm delivery.",
    howToFix: "Add a shipment record for this charge with the tracking number.",
  },
  uncategorized_file: {
    label: "Additional file",
    kind: "file",
    why: "Any other supporting document.",
    howToFix: "Upload any other supporting document.",
  },
  uncategorized_text: {
    label: "Additional information (narrative)",
    kind: "text",
    why: "The summary the bank reads first.",
    howToFix: "Generate the narrative.",
  },
};

export function fieldKind(key: EvidenceFieldKey): EvidenceFieldKind {
  return EVIDENCE_FIELD_META[key].kind;
}

export function fieldLabel(key: EvidenceFieldKey): string {
  return EVIDENCE_FIELD_META[key].label;
}
