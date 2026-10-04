import type { DisputeReason, EvidenceFieldKey } from "./types";

/**
 * Reason-code playbooks (spec 3.3). Field choices follow Stripe's dispute
 * category guidance. `uncategorized_text` is never listed: the narrative fills
 * it, so it is not part of the completeness score.
 */
export type PlaybookReason = Exclude<DisputeReason, "other">;

export interface MerchantInput {
  key: EvidenceFieldKey;
  /** What we ask the merchant for, in plain English. */
  prompt: string;
  /** When the input applies, if not always (e.g. "digital goods"). */
  when?: string;
}

export interface Playbook {
  reason: PlaybookReason;
  title: string;
  /** One plain-English paragraph for the packet page. */
  summary: string;
  required: EvidenceFieldKey[];
  recommended: EvidenceFieldKey[];
  /** What only the merchant can supply. */
  merchantInputs: MerchantInput[];
  /** Bullet guidance for the narrative model. */
  narrativeFocus: string[];
  winTips: [string, string, string];
}

export const PLAYBOOKS: Record<PlaybookReason, Playbook> = {
  fraudulent: {
    reason: "fraudulent",
    title: "Fraudulent",
    summary:
      "The cardholder says they did not make or authorise this purchase. Win by showing the purchase is tied to the real cardholder: matching name, email and billing address, the IP address used at checkout, and proof they received or used what they bought (delivery to their address, or logins and downloads for digital goods).",
    required: ["customer_name", "customer_email_address", "billing_address", "product_description", "customer_purchase_ip"],
    recommended: [
      "shipping_address",
      "shipping_carrier",
      "shipping_tracking_number",
      "shipping_date",
      "shipping_documentation",
      "access_activity_log",
      "service_date",
      "customer_communication",
      "receipt",
    ],
    merchantInputs: [
      { key: "customer_purchase_ip", prompt: "IP address recorded at checkout." },
      { key: "access_activity_log", prompt: "Logins or downloads after purchase, with timestamps and IPs.", when: "digital goods or services" },
      { key: "service_date", prompt: "Date the customer first accessed the product.", when: "digital goods or services" },
      { key: "shipping_tracking_number", prompt: "Tracking number showing delivery to the billing or shipping address.", when: "physical goods" },
    ],
    narrativeFocus: [
      "Connect the purchase to the cardholder: name, email and billing address on the order.",
      "State the purchase IP address if provided.",
      "Describe delivery to the cardholder's address, or access and downloads after purchase, with dates.",
      "Mention any communication from the same email address that acknowledges the order.",
    ],
    winTips: [
      "Matching billing address and IP history carry the most weight.",
      "For digital goods, include logins or downloads after the purchase date.",
      "Prior undisputed orders from the same customer help a lot.",
    ],
  },
  product_not_received: {
    reason: "product_not_received",
    title: "Product not received",
    summary:
      "The customer says the order never arrived. Win by proving it shipped to the address they gave you and was delivered: carrier, tracking number, ship date and, ideally, a proof-of-delivery page. Any message where the customer acknowledges receipt helps.",
    required: [
      "customer_name",
      "customer_email_address",
      "shipping_address",
      "shipping_carrier",
      "shipping_tracking_number",
      "shipping_date",
      "product_description",
    ],
    recommended: ["shipping_documentation", "customer_communication", "billing_address", "receipt"],
    merchantInputs: [
      { key: "shipping_tracking_number", prompt: "Tracking number for this order." },
      { key: "shipping_carrier", prompt: "Carrier that delivered it (UPS, USPS, FedEx...)." },
      { key: "shipping_date", prompt: "Date the order shipped." },
      { key: "shipping_documentation", prompt: "Carrier proof of delivery (screenshot or PDF)." },
    ],
    narrativeFocus: [
      "Give the ship date, carrier and tracking number exactly as provided.",
      "Confirm the shipping address matches the address the customer entered at checkout.",
      "State the delivery date if provided.",
      "Mention any message where the customer acknowledged the delivery.",
    ],
    winTips: [
      "A delivery confirmation to the checkout address is the strongest proof.",
      "Make sure the shipping address matches the one on the order exactly.",
      "Include any message where the customer mentions receiving the item.",
    ],
  },
  product_unacceptable: {
    reason: "product_unacceptable",
    title: "Product unacceptable",
    summary:
      "The customer says the product was defective, damaged or not as described. Win by showing the product matched its description, the customer saw and accepted your refund policy before paying, and either they did not follow the return process or you offered a remedy under the policy.",
    required: ["customer_name", "customer_email_address", "product_description", "refund_policy", "refund_policy_disclosure"],
    recommended: [
      "refund_refusal_explanation",
      "customer_communication",
      "shipping_tracking_number",
      "shipping_date",
      "shipping_carrier",
      "receipt",
    ],
    merchantInputs: [
      { key: "refund_policy", prompt: "Your refund and returns policy as shown to customers." },
      { key: "refund_policy_disclosure", prompt: "Where the customer saw the refund policy before paying." },
      { key: "refund_refusal_explanation", prompt: "Why the customer is not owed a refund under the policy." },
    ],
    narrativeFocus: [
      "Describe exactly what was sold, using the product description.",
      "Quote the relevant refund policy terms and where the customer saw them before paying.",
      "Summarise the customer communication: what they asked for and what was offered.",
      "Explain why the request falls outside the policy, using only the refusal explanation provided.",
    ],
    winTips: [
      "Show the customer saw the refund policy before paying.",
      "Include the thread where you offered a return or exchange.",
      "Describe the product with the same wording as your listing.",
    ],
  },
  subscription_canceled: {
    reason: "subscription_canceled",
    title: "Subscription cancelled",
    summary:
      "The customer says they cancelled a subscription and were still charged. Win by showing your cancellation policy, that the customer saw it when they signed up, and that no valid cancellation was received before this charge (or that they kept using the service).",
    required: [
      "customer_name",
      "customer_email_address",
      "product_description",
      "cancellation_policy",
      "cancellation_policy_disclosure",
      "cancellation_rebuttal",
    ],
    recommended: ["customer_communication", "service_date", "access_activity_log", "billing_address", "receipt"],
    merchantInputs: [
      { key: "cancellation_policy", prompt: "Your cancellation policy as shown to customers." },
      { key: "cancellation_policy_disclosure", prompt: "Where the customer saw the cancellation policy when subscribing." },
      { key: "cancellation_rebuttal", prompt: "Why the subscription was not cancelled before this charge." },
    ],
    narrativeFocus: [
      "State the subscription and the billing period this charge covers.",
      "Quote the cancellation terms and where the customer saw them.",
      "State whether and when a cancellation request was received, using only the rebuttal and communication provided.",
      "Mention usage of the service after the charge if an access log is provided.",
    ],
    winTips: [
      "Show the customer used the service after the disputed charge.",
      "Prove the cancellation terms were shown at sign-up.",
      "If no cancellation request exists, say so plainly.",
    ],
  },
  duplicate: {
    reason: "duplicate",
    title: "Duplicate charge",
    summary:
      "The customer says they were charged twice for one purchase. Win by identifying the other charge and showing the two were for separate orders (different items, dates or order numbers), or that the other charge was already refunded.",
    required: [
      "customer_name",
      "customer_email_address",
      "product_description",
      "duplicate_charge_id",
      "duplicate_charge_explanation",
    ],
    recommended: ["duplicate_charge_documentation", "receipt", "customer_communication", "billing_address"],
    merchantInputs: [
      { key: "duplicate_charge_id", prompt: "Stripe id (ch_...) of the charge the customer thinks is a duplicate." },
      { key: "duplicate_charge_explanation", prompt: "How the two charges differ (items, dates, order numbers)." },
      { key: "duplicate_charge_documentation", prompt: "Receipt or invoice for the other charge." },
    ],
    narrativeFocus: [
      "Name both charges by their ids and say what each one paid for.",
      "Explain the difference between them using only the explanation provided.",
      "Note any refund of the other charge only if it is in the facts.",
    ],
    winTips: [
      "Give the bank the id of the other charge.",
      "Show both receipts side by side.",
      "If the other charge was refunded, include the refund date.",
    ],
  },
  credit_not_processed: {
    reason: "credit_not_processed",
    title: "Credit not processed",
    summary:
      "The customer says they were promised a refund or credit that never arrived. Win by showing the refund was already issued, or that the customer was not entitled to one under the refund policy they accepted before paying.",
    required: [
      "customer_name",
      "customer_email_address",
      "product_description",
      "refund_policy",
      "refund_policy_disclosure",
      "refund_refusal_explanation",
    ],
    recommended: ["customer_communication", "receipt", "billing_address", "shipping_date"],
    merchantInputs: [
      { key: "refund_policy", prompt: "Your refund policy as shown to customers." },
      { key: "refund_policy_disclosure", prompt: "Where the customer saw the refund policy before paying." },
      { key: "refund_refusal_explanation", prompt: "Why no refund or credit is due (or when it was issued)." },
    ],
    narrativeFocus: [
      "Quote the refund policy terms and where the customer saw them before paying.",
      "State whether a return was received, using only the facts provided.",
      "Explain why no credit is due, using only the refusal explanation provided.",
    ],
    winTips: [
      "If you already refunded, say when and for how much.",
      "Show the return window and whether the item came back.",
      "Include the message thread about the refund request.",
    ],
  },
  unrecognized: {
    reason: "unrecognized",
    title: "Unrecognised charge",
    summary:
      "The cardholder does not recognise the charge on their statement. Often they do not recognise your business name. Win by showing who bought what, with matching contact details, and any communication that ties the order to them.",
    required: ["customer_name", "customer_email_address", "billing_address", "product_description", "customer_communication"],
    recommended: ["customer_purchase_ip", "receipt", "shipping_address", "shipping_tracking_number", "access_activity_log"],
    merchantInputs: [
      { key: "customer_communication", prompt: "Order confirmation or any messages with this customer." },
      { key: "customer_purchase_ip", prompt: "IP address recorded at checkout, if you have it." },
    ],
    narrativeFocus: [
      "Name the business as it appears on the order and describe what was bought.",
      "Connect the order to the cardholder: name, email and billing address.",
      "Mention the receipt or confirmation that was sent and any replies.",
    ],
    winTips: [
      "Explain how your business name appears on statements.",
      "Include the order confirmation email.",
      "Matching billing address and email help most.",
    ],
  },
  general: {
    reason: "general",
    title: "General",
    summary:
      "The dispute does not fit a specific category. Give the bank a clear account of the purchase: who bought what and when, how it was delivered, what the customer agreed to, and what communication happened.",
    required: ["customer_name", "customer_email_address", "product_description", "customer_communication"],
    recommended: [
      "billing_address",
      "receipt",
      "shipping_address",
      "shipping_tracking_number",
      "shipping_date",
      "refund_policy",
      "refund_policy_disclosure",
      "service_date",
    ],
    merchantInputs: [{ key: "customer_communication", prompt: "Messages with this customer about the order." }],
    narrativeFocus: [
      "Describe the purchase: what, when and for how much.",
      "Describe delivery or access with dates.",
      "Summarise the customer communication.",
      "Reference any policy the customer agreed to.",
    ],
    winTips: [
      "Keep the summary short and factual.",
      "Include every message with the customer.",
      "Attach proof of delivery or access.",
    ],
  },
};

/** Playbook for a reason; `other` (and anything unknown) uses `general`. */
export function getPlaybook(reason: DisputeReason): Playbook {
  return reason === "other" ? PLAYBOOKS.general : (PLAYBOOKS[reason] ?? PLAYBOOKS.general);
}
