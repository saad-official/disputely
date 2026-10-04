import { fieldKind } from "@/lib/domain/fields";
import type { EvidenceFieldKey } from "@/lib/domain/types";

/**
 * Where to go to fix each missing evidence field (spec 3.5: the missing
 * list deep-links to the fix). Links into the same packet page use
 * `?edit=` (manual entry) or `?attach=` (upload) plus an anchor.
 */

export type FixLink = { label: string; href: string };

export type FixContext = {
  disputeId: string;
  chargeId: string;
  customerEmail: string | null;
  /** Saving library items is Pro. */
  canUseLibrary: boolean;
};

const LIBRARY_KIND: Partial<Record<EvidenceFieldKey, string>> = {
  refund_policy: "refund_policy",
  cancellation_policy: "cancellation_policy",
  refund_policy_disclosure: "disclosure",
  cancellation_policy_disclosure: "disclosure",
  product_description: "product_description",
};

const SHIPMENT_FIELDS = new Set<EvidenceFieldKey>(["shipping_carrier", "shipping_tracking_number", "shipping_date"]);

export function fixLinks(key: EvidenceFieldKey, ctx: FixContext): FixLink[] {
  const self = `/disputes/${ctx.disputeId}`;
  const edit: FixLink = { label: "Enter it here", href: `${self}?edit=${key}#evidence` };
  const attach: FixLink = { label: "Upload a file", href: `${self}?attach=${key}#attachments` };
  const shipments: FixLink = {
    label: "Add a shipment record",
    href: `/library?tab=shipments&charge=${encodeURIComponent(ctx.chargeId)}&dispute=${ctx.disputeId}#records`,
  };

  if (SHIPMENT_FIELDS.has(key)) return [shipments, edit];
  if (key === "shipping_documentation") {
    return [attach, { label: "Add a proof-of-delivery link", href: shipments.href }];
  }
  if (key === "customer_communication") {
    const email = ctx.customerEmail ? `&email=${encodeURIComponent(ctx.customerEmail)}` : "";
    return [
      { label: "Paste the conversation", href: `/library?tab=messages&dispute=${ctx.disputeId}${email}#records` },
      { label: "Upload it as a file", href: `${self}?attach=customer_communication#attachments` },
    ];
  }
  const kind = LIBRARY_KIND[key];
  if (kind) {
    return ctx.canUseLibrary
      ? [{ label: "Add it to the library", href: `/library?new=${kind}#policies` }, edit]
      : [edit, { label: "Save it in the library (Pro)", href: "/billing" }];
  }
  if (fieldKind(key) === "file") return [attach, edit];
  return [edit];
}
