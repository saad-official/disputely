/**
 * Synthetic disputes for the fictional store "Larkspur Goods".
 * Every name, email (example.com), IP (RFC 5737 documentation ranges),
 * address and tracking number is invented.
 */
import type { AssembleInput } from "@/lib/domain/assemble";
import type { DisputeReason, LibraryItem, MessageLog, NormalisedDispute, Shipment } from "@/lib/domain/types";

export const MERCHANT = "Larkspur Goods";

export const LIBRARY: LibraryItem[] = [
  {
    id: "lib-refund-default",
    kind: "refund_policy",
    title: "Larkspur Returns & Refunds",
    text: "Unused items can be returned within 30 days of delivery for a full refund. Return shipping is paid by the customer unless the item arrived damaged. Refunds are issued to the original card within 5 business days of the return arriving.",
    url: "https://larkspur.example.com/refunds",
    productLine: null,
    updatedAt: "2026-06-01T00:00:00Z",
  },
  {
    id: "lib-refund-textiles",
    kind: "refund_policy",
    title: "Home Textiles Return Policy",
    text: "Textiles that have been washed or used cannot be returned for hygiene reasons. Unwashed textiles in original packaging can be returned within 14 days of delivery.",
    url: "https://larkspur.example.com/refunds/textiles",
    productLine: "home-textiles",
    updatedAt: "2026-07-01T00:00:00Z",
  },
  {
    id: "lib-cancel",
    kind: "cancellation_policy",
    title: "Candle Club Cancellation Terms",
    text: "Candle Club renews monthly on the day you joined. Cancel any time from your account page before the renewal date; cancellations take effect at the end of the current billing month.",
    url: "https://larkspur.example.com/candle-club/terms",
    productLine: "candle-club",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-shipping",
    kind: "shipping_policy",
    title: "Larkspur Shipping Policy",
    text: "Orders ship within 2 business days with tracking by UPS or USPS.",
    url: "https://larkspur.example.com/shipping",
    productLine: null,
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-disclosure-refund",
    kind: "disclosure",
    title: "Refund policy disclosure",
    text: "The refund policy is linked directly above the Pay button at checkout, and the customer must tick 'I agree to the returns policy' before paying.",
    productLine: null,
    appliesTo: "refund_policy",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-disclosure-cancel",
    kind: "disclosure",
    title: "Cancellation terms shown at sign-up",
    text: "Candle Club cancellation terms are shown in full on the sign-up page and repeated in the welcome email.",
    productLine: "candle-club",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-product-blanket",
    kind: "product_description",
    title: "Linen Throw Blanket",
    text: "Stonewashed European linen throw, 130 x 180 cm, oatmeal colour.",
    productLine: "home-textiles",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "lib-product-candle",
    kind: "product_description",
    title: "Candle Club",
    text: "Monthly subscription: one 220 g soy candle shipped on the 1st of each month.",
    productLine: "candle-club",
    updatedAt: "2026-05-01T00:00:00Z",
  },
];

const ADDRESS_ELLIS = { line1: "12 Fern Lane", line2: "Apt 3", city: "Portland", state: "OR", postalCode: "97201", country: "US" };
const ADDRESS_REYES = { line1: "48 Quarry Road", city: "Asheville", state: "NC", postalCode: "28801", country: "US" };

export function baseDispute(overrides: Partial<NormalisedDispute> = {}): NormalisedDispute {
  return {
    id: "dp_1LarkTest0001",
    reason: "general",
    status: "needs_response",
    amountCents: 12900,
    currency: "usd",
    createdAt: "2026-09-25T10:00:00Z",
    dueBy: "2026-10-09T23:59:59Z",
    productLine: "home-textiles",
    customer: { name: "Jordan Ellis", email: "jordan.ellis@example.com", ip: "203.0.113.42" },
    charge: {
      id: "ch_3LarkFraud0001",
      createdAt: "2026-09-10T16:20:00Z",
      description: "Order LG-10482",
      receiptUrl: "https://pay.example.com/receipts/LG-10482",
      billingDetails: { name: "Jordan Ellis", email: "jordan.ellis@example.com", address: ADDRESS_ELLIS },
    },
    shipping: { name: "Jordan Ellis", address: ADDRESS_ELLIS, carrier: null, trackingNumber: null },
    checkout: {
      lineItems: [{ description: "Linen Throw Blanket", quantity: 1, amountCents: 12900 }],
      shippingAddress: ADDRESS_ELLIS,
    },
    ...overrides,
  };
}

export const SHIPMENTS: Shipment[] = [
  {
    id: "ship-1",
    chargeId: "ch_3LarkFraud0001",
    carrier: "UPS",
    trackingNumber: "1Z999AA10123456784",
    shippedAt: "2026-09-12T15:00:00Z",
    deliveredAt: "2026-09-15T18:30:00Z",
    proofUrl: "https://track.example.com/1Z999AA10123456784",
  },
  {
    id: "ship-2",
    chargeId: "ch_3LarkPnr0002",
    carrier: "USPS",
    trackingNumber: "9400111899223197428490",
    shippedAt: "2026-09-08T12:00:00Z",
    deliveredAt: null,
    proofUrl: null,
  },
  {
    id: "ship-other",
    chargeId: "ch_3LarkSomeoneElse",
    carrier: "FedEx",
    trackingNumber: "771234567890",
    shippedAt: "2026-09-01T12:00:00Z",
  },
];

export const MESSAGES: MessageLog[] = [
  {
    id: "msg-2",
    customerEmail: "jordan.ellis@example.com",
    channel: "email",
    occurredAt: "2026-09-16T09:12:00Z",
    direction: "inbound",
    body: "Got the blanket yesterday, it's lovely. Thanks!",
  },
  {
    id: "msg-1",
    customerEmail: "Jordan.Ellis@Example.com",
    channel: "email",
    occurredAt: "2026-09-12T15:05:00Z",
    direction: "outbound",
    body: "Your Larkspur order LG-10482 has shipped with UPS, tracking 1Z999AA10123456784.",
  },
  {
    id: "msg-other",
    customerEmail: "someone.else@example.com",
    channel: "chat",
    occurredAt: "2026-09-13T10:00:00Z",
    direction: "inbound",
    body: "Unrelated question about gift cards.",
  },
];

export const DISPUTES: Record<Exclude<DisputeReason, "other">, NormalisedDispute> = {
  fraudulent: baseDispute({ reason: "fraudulent" }),
  product_not_received: baseDispute({
    id: "dp_1LarkTest0002",
    reason: "product_not_received",
    amountCents: 8650,
    productLine: null,
    customer: { name: "Morgan Reyes", email: "morgan.reyes@example.com", ip: null },
    charge: {
      id: "ch_3LarkPnr0002",
      createdAt: "2026-09-07T11:00:00Z",
      description: "Order LG-10391",
      receiptUrl: null,
      billingDetails: { name: "Morgan Reyes", email: "morgan.reyes@example.com", address: ADDRESS_REYES },
    },
    shipping: { name: "Morgan Reyes", address: ADDRESS_REYES, carrier: null, trackingNumber: null },
    checkout: {
      lineItems: [
        { description: "Stoneware Mug Set", quantity: 2, amountCents: 6400 },
        { description: "Beeswax Wrap Trio", quantity: 1, amountCents: 2250 },
      ],
      shippingAddress: ADDRESS_REYES,
    },
  }),
  product_unacceptable: baseDispute({ reason: "product_unacceptable" }),
  subscription_canceled: baseDispute({
    id: "dp_1LarkTest0004",
    reason: "subscription_canceled",
    amountCents: 2400,
    productLine: "candle-club",
    customer: { name: "Riley Shaw", email: "riley.shaw@example.com", ip: "198.51.100.7" },
    charge: {
      id: "ch_3LarkSub0004",
      createdAt: "2026-09-01T06:00:00Z",
      description: "Candle Club - September",
      receiptUrl: null,
      billingDetails: { name: "Riley Shaw", email: "riley.shaw@example.com", address: null },
    },
    shipping: null,
    checkout: { lineItems: [{ description: "Candle Club", quantity: 1, amountCents: 2400 }] },
  }),
  duplicate: baseDispute({ reason: "duplicate" }),
  credit_not_processed: baseDispute({ reason: "credit_not_processed", productLine: null }),
  unrecognized: baseDispute({ reason: "unrecognized" }),
  general: baseDispute({ reason: "general" }),
};

export function makeInput(reason: Exclude<DisputeReason, "other">, overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    dispute: DISPUTES[reason],
    merchantName: MERCHANT,
    libraryItems: LIBRARY,
    shipments: SHIPMENTS,
    messageLogs: MESSAGES,
    manual: {},
    ...overrides,
  };
}
