import type { DisputeReason, LibraryItem, MessageLog, NormalisedDispute, PostalAddress, Shipment } from "./types";

/**
 * Pure fixtures for the demo store "Larkspur Goods" (spec 3.7). Everything is
 * fictional: example.com emails, RFC 5737 documentation IPs, invented
 * addresses and tracking numbers. The seeding code creates one Stripe test
 * charge per order with the order's dispute test card, then calls
 * `materializeDemo` with the charge ids it got back.
 *
 * Stripe dispute test cards (docs.stripe.com/testing#disputes):
 * - 4000000000000259: disputed as fraudulent
 * - 4000000000002685: disputed as product not received
 * - 4000000000001976: inquiry (status warning_needs_response)
 * Submitting `uncategorized_text` = "winning_evidence" closes a test dispute
 * as won; "losing_evidence" closes it as lost (an inquiry closes without
 * escalation).
 */

export const DEMO_STORE_NAME = "Larkspur Goods";

export type DemoScenario = "won" | "inquiry" | "lost";

export interface DemoOrder {
  orderRef: string;
  scenario: DemoScenario;
  /** Stripe test card number that triggers the dispute. */
  testCard: string;
  /** The reason Stripe assigns; null when Stripe decides (inquiries). */
  expectedReason: DisputeReason | null;
  /** Evidence text that forces the outcome in test mode. */
  evidenceTrigger: "winning_evidence" | "losing_evidence";
  expectedOutcome: "won" | "lost" | "warning_closed";
  productLine: string | null;
  description: string;
  currency: "usd";
  lineItems: Array<{ description: string; quantity: number; amountCents: number }>;
  customer: { name: string; email: string; ip: string; address: PostalAddress };
}

function total(items: DemoOrder["lineItems"]): number {
  return items.reduce((n, li) => n + li.amountCents, 0);
}

export const DEMO_ORDERS: DemoOrder[] = [
  {
    orderRef: "LG-10482",
    scenario: "won",
    testCard: "4000000000000259",
    expectedReason: "fraudulent",
    evidenceTrigger: "winning_evidence",
    expectedOutcome: "won",
    productLine: "home-textiles",
    description: "Larkspur Goods order LG-10482",
    currency: "usd",
    lineItems: [{ description: "Linen Throw Blanket", quantity: 1, amountCents: 12900 }],
    customer: {
      name: "Jordan Ellis",
      email: "jordan.ellis@example.com",
      ip: "203.0.113.42",
      address: { line1: "12 Fern Lane", line2: "Apt 3", city: "Portland", state: "OR", postalCode: "97201", country: "US" },
    },
  },
  {
    orderRef: "LG-10507",
    scenario: "inquiry",
    testCard: "4000000000001976",
    expectedReason: null,
    evidenceTrigger: "winning_evidence",
    expectedOutcome: "warning_closed",
    productLine: "kitchen",
    description: "Larkspur Goods order LG-10507",
    currency: "usd",
    lineItems: [
      { description: "Stoneware Mug Set", quantity: 2, amountCents: 6400 },
      { description: "Beeswax Wrap Trio", quantity: 1, amountCents: 2250 },
    ],
    customer: {
      name: "Morgan Reyes",
      email: "morgan.reyes@example.com",
      ip: "198.51.100.23",
      address: { line1: "48 Quarry Road", city: "Asheville", state: "NC", postalCode: "28801", country: "US" },
    },
  },
  {
    orderRef: "LG-10533",
    scenario: "lost",
    testCard: "4000000000002685",
    expectedReason: "product_not_received",
    evidenceTrigger: "losing_evidence",
    expectedOutcome: "lost",
    productLine: "home-textiles",
    description: "Larkspur Goods order LG-10533",
    currency: "usd",
    lineItems: [{ description: "Waffle Bath Towel Set", quantity: 1, amountCents: 7800 }],
    customer: {
      name: "Casey Lindqvist",
      email: "casey.lindqvist@example.com",
      ip: "192.0.2.77",
      address: { line1: "7 Harbor View Court", city: "Duluth", state: "MN", postalCode: "55802", country: "US" },
    },
  },
];

export function demoOrderAmount(order: DemoOrder): number {
  return total(order.lineItems);
}

const updated = "2026-06-01T00:00:00Z";

export const DEMO_LIBRARY: LibraryItem[] = [
  {
    id: "demo-refund-policy",
    kind: "refund_policy",
    title: "Larkspur Returns & Refunds",
    text: "Unused items can be returned within 30 days of delivery for a full refund to the original card. Return shipping is paid by the customer unless the item arrived damaged. Refunds are issued within 5 business days of the return arriving at our studio.",
    url: "https://larkspur.example.com/refunds",
    productLine: null,
    updatedAt: updated,
  },
  {
    id: "demo-refund-policy-textiles",
    kind: "refund_policy",
    title: "Home Textiles Return Policy",
    text: "Textiles that have been washed or used cannot be returned for hygiene reasons. Unwashed textiles in their original packaging can be returned within 14 days of delivery.",
    url: "https://larkspur.example.com/refunds/textiles",
    productLine: "home-textiles",
    updatedAt: updated,
  },
  {
    id: "demo-shipping-policy",
    kind: "shipping_policy",
    title: "Larkspur Shipping Policy",
    text: "Orders ship within 2 business days from our studio with tracking by UPS or USPS. A shipping confirmation email with the tracking number is sent when the parcel leaves.",
    url: "https://larkspur.example.com/shipping",
    productLine: null,
    updatedAt: updated,
  },
  {
    id: "demo-terms",
    kind: "terms",
    title: "Larkspur Terms of Sale",
    text: "By placing an order you agree to our refund and shipping policies, which are linked on every product page and at checkout.",
    url: "https://larkspur.example.com/terms",
    productLine: null,
    updatedAt: updated,
  },
  {
    id: "demo-disclosure-refund",
    kind: "disclosure",
    title: "Refund policy shown at checkout",
    text: "The refund policy is linked directly above the Pay button at checkout, and the customer must tick 'I agree to the returns policy' before paying.",
    productLine: null,
    appliesTo: "refund_policy",
    updatedAt: updated,
  },
  {
    id: "demo-disclosure-shipping",
    kind: "disclosure",
    title: "Shipping policy shown at checkout",
    text: "Delivery times and carriers are listed on the checkout page next to the shipping options.",
    productLine: null,
    appliesTo: "shipping_policy",
    updatedAt: updated,
  },
  {
    id: "demo-product-blanket",
    kind: "product_description",
    title: "Linen Throw Blanket",
    text: "Stonewashed European linen throw, 130 x 180 cm, oatmeal colour. Shipped folded in a recycled cotton bag.",
    productLine: "home-textiles",
    updatedAt: updated,
  },
  {
    id: "demo-product-towels",
    kind: "product_description",
    title: "Waffle Bath Towel Set",
    text: "Two waffle-weave cotton bath towels, 70 x 140 cm, in sage.",
    productLine: "home-textiles",
    updatedAt: updated,
  },
  {
    id: "demo-product-mugs",
    kind: "product_description",
    title: "Stoneware Mug Set",
    text: "Pair of hand-glazed stoneware mugs, 350 ml each, dishwasher safe.",
    productLine: "kitchen",
    updatedAt: updated,
  },
  {
    id: "demo-product-wraps",
    kind: "product_description",
    title: "Beeswax Wrap Trio",
    text: "Three reusable beeswax food wraps in small, medium and large.",
    productLine: "kitchen",
    updatedAt: updated,
  },
];

/** Shipments keyed by order; times are minutes after the charge. */
export interface DemoShipmentTemplate {
  orderRef: string;
  carrier: string;
  trackingNumber: string;
  shippedAfterMinutes: number;
  /** null: not delivered yet (the product_not_received order). */
  deliveredAfterMinutes: number | null;
  proofUrl: string | null;
}

export const DEMO_SHIPMENTS: DemoShipmentTemplate[] = [
  {
    orderRef: "LG-10482",
    carrier: "UPS",
    trackingNumber: "1Z999AA10123456784",
    shippedAfterMinutes: 20,
    deliveredAfterMinutes: 50,
    proofUrl: "https://track.example.com/ups/1Z999AA10123456784",
  },
  {
    orderRef: "LG-10507",
    carrier: "USPS",
    trackingNumber: "9400111899223197428490",
    shippedAfterMinutes: 25,
    deliveredAfterMinutes: 55,
    proofUrl: "https://track.example.com/usps/9400111899223197428490",
  },
  {
    orderRef: "LG-10533",
    carrier: "USPS",
    trackingNumber: "9400111899223197428513",
    shippedAfterMinutes: 30,
    deliveredAfterMinutes: null,
    proofUrl: null,
  },
];

export interface DemoMessageTemplate {
  orderRef: string;
  channel: MessageLog["channel"];
  direction: MessageLog["direction"];
  afterMinutes: number;
  body: string;
}

export const DEMO_MESSAGE_LOGS: DemoMessageTemplate[] = [
  {
    orderRef: "LG-10482",
    channel: "email",
    direction: "outbound",
    afterMinutes: 21,
    body: "Hi Jordan, your Larkspur Goods order LG-10482 is on its way with UPS, tracking 1Z999AA10123456784.",
  },
  {
    orderRef: "LG-10482",
    channel: "email",
    direction: "inbound",
    afterMinutes: 58,
    body: "The blanket arrived and it's lovely, thank you!",
  },
  {
    orderRef: "LG-10507",
    channel: "chat",
    direction: "inbound",
    afterMinutes: 10,
    body: "Can I add a gift note to order LG-10507?",
  },
  {
    orderRef: "LG-10507",
    channel: "chat",
    direction: "outbound",
    afterMinutes: 12,
    body: "Of course, we've added the gift note before packing.",
  },
  {
    orderRef: "LG-10533",
    channel: "email",
    direction: "outbound",
    afterMinutes: 31,
    body: "Hi Casey, your order LG-10533 has shipped with USPS, tracking 9400111899223197428513.",
  },
  {
    orderRef: "LG-10533",
    channel: "email",
    direction: "inbound",
    afterMinutes: 45,
    body: "Tracking hasn't updated yet. When should I expect the towels?",
  },
];

function plusMinutes(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

function orderByRef(orderRef: string): DemoOrder {
  const order = DEMO_ORDERS.find((o) => o.orderRef === orderRef);
  if (!order) throw new Error(`Unknown demo order ${orderRef}`);
  return order;
}

/**
 * Concrete shipments and message logs once the Stripe test charges exist.
 * Orders without a charge id are skipped.
 */
export function materializeDemo(args: {
  chargedAt: Date;
  chargeIdByOrderRef: Record<string, string>;
}): { shipments: Shipment[]; messageLogs: MessageLog[] } {
  const { chargedAt, chargeIdByOrderRef } = args;
  const shipments: Shipment[] = DEMO_SHIPMENTS.filter((s) => chargeIdByOrderRef[s.orderRef]).map((s) => ({
    chargeId: chargeIdByOrderRef[s.orderRef],
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    shippedAt: plusMinutes(chargedAt, s.shippedAfterMinutes),
    deliveredAt: s.deliveredAfterMinutes === null ? null : plusMinutes(chargedAt, s.deliveredAfterMinutes),
    proofUrl: s.proofUrl,
  }));
  const messageLogs: MessageLog[] = DEMO_MESSAGE_LOGS.filter((m) => chargeIdByOrderRef[m.orderRef]).map((m) => ({
    customerEmail: orderByRef(m.orderRef).customer.email,
    channel: m.channel,
    direction: m.direction,
    occurredAt: plusMinutes(chargedAt, m.afterMinutes),
    body: m.body,
  }));
  return { shipments, messageLogs };
}

/** A normalised dispute for a demo order (what sync would produce), for previews and tests. */
export function demoDisputeFor(
  order: DemoOrder,
  ids: { disputeId: string; chargeId: string; chargedAt: Date; disputedAt: Date; dueBy: Date },
): NormalisedDispute {
  return {
    id: ids.disputeId,
    reason: order.expectedReason ?? "general",
    status: order.scenario === "inquiry" ? "warning_needs_response" : "needs_response",
    amountCents: demoOrderAmount(order),
    currency: order.currency,
    createdAt: ids.disputedAt.toISOString(),
    dueBy: ids.dueBy.toISOString(),
    productLine: order.productLine,
    customer: { name: order.customer.name, email: order.customer.email, ip: order.customer.ip },
    charge: {
      id: ids.chargeId,
      createdAt: ids.chargedAt.toISOString(),
      description: order.description,
      receiptUrl: null,
      billingDetails: { name: order.customer.name, email: order.customer.email, address: order.customer.address },
    },
    shipping: { name: order.customer.name, address: order.customer.address },
    checkout: { lineItems: order.lineItems, shippingAddress: order.customer.address },
  };
}
