/**
 * Recorded-style fixture: assembled fields for a Larkspur Goods
 * product_not_received packet, the files uploaded to Stripe, and the exact
 * `evidence` hash we expect to send to POST /v1/disputes/:id.
 */
import type { AssembledField } from "@/lib/domain/types";
import type { EvidenceAttachment, EvidencePayload } from "@/lib/stripe/evidence";

export const PNR_FIELDS: AssembledField[] = [
  { key: "billing_address", value: "48 Quarry Road, Asheville, NC 28801, US", source: "stripe_charge" },
  {
    key: "customer_communication",
    value: "[2026-09-08 12:05 UTC] Larkspur Goods (email):\nYour order LG-10391 has shipped.",
    source: "message_log",
  },
  { key: "customer_email_address", value: "morgan.reyes@example.com", source: "stripe_customer" },
  { key: "customer_name", value: "Morgan Reyes", source: "stripe_customer" },
  { key: "product_description", value: "2 x Stoneware Mug Set - $64.00\n1 x Beeswax Wrap Trio - $22.50", source: "stripe_checkout" },
  {
    key: "refund_policy",
    value: "Larkspur Returns & Refunds\n\nUnused items can be returned within 30 days of delivery.",
    source: "library",
    sourceLabel: "Larkspur Returns & Refunds",
  },
  { key: "shipping_address", value: "48 Quarry Road, Asheville, NC 28801, US", source: "stripe_charge" },
  { key: "shipping_carrier", value: "USPS", source: "shipment" },
  { key: "shipping_date", value: "2026-09-08", source: "shipment" },
  {
    key: "shipping_documentation",
    value: "USPS shipment 9400111899223197428490, shipped 2026-09-08, delivered 2026-09-11.",
    source: "shipment",
    fileId: "att_pod",
  },
  { key: "shipping_tracking_number", value: "9400111899223197428490", source: "shipment" },
];

export const PNR_NARRATIVE =
  "What was purchased\nMorgan Reyes ordered a Stoneware Mug Set and a Beeswax Wrap Trio for $86.50.\n\nDelivery / access\nUSPS shipped the order on 2026-09-08 with tracking 9400111899223197428490.";

export const PNR_ATTACHMENTS: EvidenceAttachment[] = [
  { field: "shipping_documentation", stripeFileId: "file_1PodLarkspur0001" },
];

export const PNR_EXPECTED_PAYLOAD: EvidencePayload = {
  billing_address: "48 Quarry Road, Asheville, NC 28801, US",
  customer_email_address: "morgan.reyes@example.com",
  customer_name: "Morgan Reyes",
  product_description: "2 x Stoneware Mug Set - $64.00\n1 x Beeswax Wrap Trio - $22.50",
  shipping_address: "48 Quarry Road, Asheville, NC 28801, US",
  shipping_carrier: "USPS",
  shipping_date: "2026-09-08",
  shipping_tracking_number: "9400111899223197428490",
  shipping_documentation: "file_1PodLarkspur0001",
  uncategorized_text: [
    PNR_NARRATIVE,
    "",
    "CUSTOMER COMMUNICATION",
    "[2026-09-08 12:05 UTC] Larkspur Goods (email):\nYour order LG-10391 has shipped.",
    "",
    "REFUND POLICY",
    "Larkspur Returns & Refunds\n\nUnused items can be returned within 30 days of delivery.",
  ].join("\n"),
};
