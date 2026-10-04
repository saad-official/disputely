import { findDates, findIps, findUrls, findMoney, findStripeIds, findTrackingLike, mask } from "./extract";
import { EVIDENCE_FIELD_META, fieldKind } from "./fields";
import {
  clean,
  formatAddress,
  formatMoney,
  formatPlainAmount,
  formatUtcStamp,
  isoDay,
  minorUnitDigits,
  truncate,
  uniq,
} from "./format";
import { getPlaybook, type Playbook } from "./playbooks";
import {
  EVIDENCE_FIELD_KEYS,
  type AssembledField,
  type EvidenceFieldKey,
  type Facts,
  type FieldSource,
  type LibraryItem,
  type LibraryKind,
  type MessageLog,
  type NormalisedDispute,
  type Shipment,
} from "./types";

/**
 * Deterministic evidence assembly (spec 3.3). No model calls: every value
 * comes from Stripe, the merchant's library and records, or manual input.
 */

export interface AttachmentRef {
  field: EvidenceFieldKey;
  /** Local attachment id (or Stripe file id once uploaded). */
  fileId: string;
  fileName: string;
}

export interface AssembleInput {
  dispute: NormalisedDispute;
  /** Store name; used in the transcript and as a verifiable fact. */
  merchantName?: string | null;
  libraryItems: LibraryItem[];
  shipments: Shipment[];
  messageLogs: MessageLog[];
  /** Merchant-entered values; non-blank values override everything else. */
  manual?: Partial<Record<EvidenceFieldKey, string>>;
  /** Uploaded files already linked to a field. */
  attachments?: AttachmentRef[];
}

export interface MissingField {
  key: EvidenceFieldKey;
  label: string;
  required: boolean;
  why: string;
  howToFix: string;
}

/** Library items that support the packet but have no Stripe field (shipping policy, terms). */
export interface LibraryReference {
  id: string;
  kind: LibraryKind;
  title: string;
  text: string;
  url: string | null;
}

export interface AssembleResult {
  playbook: Playbook;
  fields: AssembledField[];
  missing: MissingField[];
  /** 0-100: required fields weigh 70, recommended 30. */
  completeness: number;
  facts: Facts;
  references: LibraryReference[];
}

export const REQUIRED_WEIGHT = 70;
export const RECOMMENDED_WEIGHT = 30;
export const TRANSCRIPT_MAX_CHARS = 20_000;
const EXCERPT_CHARS = 160;
const MAX_EXCERPTS = 10;

/**
 * Completeness = 70 * (required present / required) + 30 * (recommended
 * present / recommended), rounded. An empty group counts as fully satisfied.
 */
export function completenessScore(
  required: readonly EvidenceFieldKey[],
  recommended: readonly EvidenceFieldKey[],
  present: ReadonlySet<EvidenceFieldKey>,
): number {
  const share = (keys: readonly EvidenceFieldKey[]) =>
    keys.length === 0 ? 1 : keys.filter((k) => present.has(k)).length / keys.length;
  const score = REQUIRED_WEIGHT * share(required) + RECOMMENDED_WEIGHT * share(recommended);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ------------------------------------------------------------------ */
/* Library selection                                                   */
/* ------------------------------------------------------------------ */

function byNewest(a: LibraryItem, b: LibraryItem): number {
  const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return tb - ta || a.id.localeCompare(b.id);
}

/** Prefer the dispute's product line, else the org default (no product line). */
function pickForProductLine(items: LibraryItem[], productLine: string | null | undefined): LibraryItem | null {
  const line = clean(productLine);
  if (line) {
    const match = items.filter((i) => clean(i.productLine) === line).sort(byNewest)[0];
    if (match) return match;
  }
  return items.filter((i) => !clean(i.productLine)).sort(byNewest)[0] ?? null;
}

const DISCLOSURE_HINTS: Record<"refund_policy" | "cancellation_policy" | "shipping_policy", RegExp> = {
  refund_policy: /\b(?:refund|return)/i,
  cancellation_policy: /\bcancel/i,
  shipping_policy: /\b(?:ship|deliver)/i,
};

function pickDisclosure(
  library: LibraryItem[],
  policy: keyof typeof DISCLOSURE_HINTS,
  productLine: string | null | undefined,
): LibraryItem | null {
  const disclosures = library.filter((i) => i.kind === "disclosure");
  const explicit = disclosures.filter((i) => i.appliesTo === policy);
  const inferred = disclosures.filter((i) => !i.appliesTo && DISCLOSURE_HINTS[policy].test(`${i.title} ${i.text}`));
  return pickForProductLine(explicit, productLine) ?? pickForProductLine(inferred, productLine);
}

function policyText(item: LibraryItem): string {
  const url = clean(item.url);
  return [item.title.trim(), item.text.trim(), url ? `Published at ${url}` : ""].filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = clean(a)?.toLowerCase();
  const y = clean(b)?.toLowerCase();
  return Boolean(x && y && x === y);
}

function sortMessages(logs: MessageLog[]): MessageLog[] {
  return [...logs].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.id ?? "").localeCompare(b.id ?? ""),
  );
}

function formatMessage(log: MessageLog, merchantName: string): string {
  const who = log.direction === "inbound" ? "Customer" : merchantName;
  return `[${formatUtcStamp(log.occurredAt)}] ${who} (${log.channel}):\n${log.body.trim()}`;
}

/**
 * Dated transcript, oldest first / newest last. Over the cap, the oldest
 * messages are dropped and a marker says how many.
 */
export function formatTranscript(logs: MessageLog[], merchantName: string, maxChars = TRANSCRIPT_MAX_CHARS): string {
  const blocks = sortMessages(logs).map((l) => formatMessage(l, merchantName));
  const sep = "\n\n";
  let kept = blocks;
  let text = kept.join(sep);
  let dropped = 0;
  while (text.length > maxChars && kept.length > 1) {
    dropped++;
    kept = blocks.slice(dropped);
    text = `[${dropped} earlier messages omitted]${sep}${kept.join(sep)}`;
  }
  return truncate(text, maxChars);
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

type Draft = Map<EvidenceFieldKey, AssembledField>;

function put(draft: Draft, key: EvidenceFieldKey, value: string | null | undefined, source: FieldSource, sourceLabel?: string) {
  const v = clean(value);
  if (!v || draft.has(key)) return;
  draft.set(key, sourceLabel ? { key, value: v, source, sourceLabel } : { key, value: v, source });
}

function lineItemsText(dispute: NormalisedDispute): string | null {
  const items = dispute.checkout?.lineItems ?? [];
  if (items.length === 0) return null;
  return items
    .map((li) => {
      const qty = li.quantity ?? 1;
      const amount = typeof li.amountCents === "number" ? ` - ${formatMoney(li.amountCents, dispute.currency)}` : "";
      return `${qty} x ${li.description.trim()}${amount}`;
    })
    .join("\n");
}

function productLibraryItems(dispute: NormalisedDispute, library: LibraryItem[]): LibraryItem[] {
  const names = (dispute.checkout?.lineItems ?? []).map((li) => li.description.trim().toLowerCase());
  const line = clean(dispute.productLine);
  return library
    .filter((i) => i.kind === "product_description")
    .filter((i) => {
      const title = i.title.trim().toLowerCase();
      const titleMatch = title.length > 0 && names.some((n) => n.includes(title) || title.includes(n));
      return titleMatch || (line !== null && clean(i.productLine) === line);
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function assemblePacket(input: AssembleInput): AssembleResult {
  const { dispute } = input;
  const playbook = getPlaybook(dispute.reason);
  const merchantName = clean(input.merchantName) ?? "Merchant";
  const draft: Draft = new Map();
  const references: LibraryReference[] = [];
  const usedLibrary: LibraryItem[] = [];

  // 1. Manual values win.
  for (const key of EVIDENCE_FIELD_KEYS) put(draft, key, input.manual?.[key], "manual");

  // 2. Stripe customer / charge.
  const billing = dispute.charge.billingDetails ?? null;
  if (clean(dispute.customer.name)) put(draft, "customer_name", dispute.customer.name, "stripe_customer");
  else put(draft, "customer_name", billing?.name ?? dispute.shipping?.name, "stripe_charge");
  if (clean(dispute.customer.email)) put(draft, "customer_email_address", dispute.customer.email, "stripe_customer");
  else put(draft, "customer_email_address", billing?.email, "stripe_charge");
  put(draft, "customer_purchase_ip", dispute.customer.ip, "stripe_charge");
  put(draft, "billing_address", formatAddress(billing?.address), "stripe_charge");
  if (formatAddress(dispute.shipping?.address)) {
    put(draft, "shipping_address", formatAddress(dispute.shipping?.address), "stripe_charge");
  } else {
    put(draft, "shipping_address", formatAddress(dispute.checkout?.shippingAddress), "stripe_checkout");
  }
  const receiptUrl = clean(dispute.charge.receiptUrl);
  if (receiptUrl) put(draft, "receipt", `Stripe receipt for charge ${dispute.charge.id}: ${receiptUrl}`, "stripe_charge");

  // 3. Shipments recorded for this charge, else tracking on the charge itself.
  const shipments = input.shipments
    .filter((s) => s.chargeId === dispute.charge.id)
    .sort((a, b) => (a.shippedAt ?? "").localeCompare(b.shippedAt ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
  if (shipments.length > 0) {
    const carriers = uniq(shipments.map((s) => clean(s.carrier)).filter((c): c is string => Boolean(c)));
    const tracking = uniq(shipments.map((s) => clean(s.trackingNumber)).filter((t): t is string => Boolean(t)));
    const shipDays = shipments.map((s) => isoDay(s.shippedAt)).filter((d): d is string => Boolean(d)).sort();
    put(draft, "shipping_carrier", carriers.join(", "), "shipment");
    put(draft, "shipping_tracking_number", tracking.join(", "), "shipment");
    put(draft, "shipping_date", shipDays[0], "shipment");
    const proofs = shipments
      .filter((s) => s.deliveredAt || s.proofUrl)
      .map((s) => {
        const parts = [
          `${clean(s.carrier) ?? "Carrier"} shipment ${clean(s.trackingNumber) ?? ""}`.replace(/\s+$/, ""),
          isoDay(s.shippedAt) ? `shipped ${isoDay(s.shippedAt)}` : "",
          isoDay(s.deliveredAt) ? `delivered ${isoDay(s.deliveredAt)}` : "",
        ].filter(Boolean);
        const proof = clean(s.proofUrl) ? ` Proof of delivery: ${clean(s.proofUrl)}` : "";
        return `${parts.join(", ")}.${proof}`;
      });
    put(draft, "shipping_documentation", proofs.join("\n"), "shipment");
  } else {
    put(draft, "shipping_carrier", dispute.shipping?.carrier, "stripe_charge");
    put(draft, "shipping_tracking_number", dispute.shipping?.trackingNumber, "stripe_charge");
  }

  // 4. Policies and disclosures from the library.
  const library = input.libraryItems;
  const ofKind = (kind: LibraryKind) => library.filter((i) => i.kind === kind);
  for (const kind of ["refund_policy", "cancellation_policy"] as const) {
    const policy = pickForProductLine(ofKind(kind), dispute.productLine);
    if (policy) {
      put(draft, kind, policyText(policy), "library", policy.title);
      usedLibrary.push(policy);
    }
    const disclosure = pickDisclosure(library, kind, dispute.productLine);
    if (disclosure) {
      put(draft, `${kind}_disclosure` as EvidenceFieldKey, disclosure.text, "library", disclosure.title);
      usedLibrary.push(disclosure);
    }
  }
  for (const kind of ["shipping_policy", "terms"] as const) {
    const item = pickForProductLine(ofKind(kind), dispute.productLine);
    if (!item) continue;
    usedLibrary.push(item);
    references.push({ id: item.id, kind, title: item.title, text: item.text, url: clean(item.url) });
    const disclosure = kind === "shipping_policy" ? pickDisclosure(library, kind, dispute.productLine) : null;
    if (disclosure) {
      usedLibrary.push(disclosure);
      references.push({ id: disclosure.id, kind: "disclosure", title: disclosure.title, text: disclosure.text, url: clean(disclosure.url) });
    }
  }

  // 5. Product description: line items + matching library descriptions, else the charge description.
  const products = productLibraryItems(dispute, library);
  usedLibrary.push(...products);
  const itemsText = lineItemsText(dispute);
  const libraryText = products.map((p) => `${p.title.trim()}: ${p.text.trim()}`).join("\n");
  if (itemsText) {
    put(draft, "product_description", [itemsText, libraryText].filter(Boolean).join("\n\n"), "stripe_checkout");
  } else if (libraryText) {
    put(draft, "product_description", libraryText, "library", products.map((p) => p.title).join(", "));
  } else {
    put(draft, "product_description", dispute.charge.description, "stripe_charge");
  }

  // 6. Customer communication for this customer (or explicitly linked to this dispute).
  const customerEmail = draft.get("customer_email_address")?.value ?? dispute.customer.email ?? billing?.email ?? null;
  const messages = sortMessages(
    input.messageLogs.filter(
      (m) => sameEmail(m.customerEmail, customerEmail) || (m.disputeId && m.disputeId === dispute.id),
    ),
  );
  if (messages.length > 0) put(draft, "customer_communication", formatTranscript(messages, merchantName), "message_log");

  // 7. Attachments: a file satisfies its field.
  for (const att of input.attachments ?? []) {
    const existing = draft.get(att.field);
    if (existing) {
      if (!existing.fileId) draft.set(att.field, { ...existing, fileId: att.fileId });
    } else {
      const name = clean(att.fileName) ?? att.fileId;
      draft.set(att.field, { key: att.field, value: name, source: "manual", fileId: att.fileId });
    }
  }

  // Stable output order: Stripe's key order.
  const fields = EVIDENCE_FIELD_KEYS.map((k) => draft.get(k)).filter((f): f is AssembledField => Boolean(f));
  const present = new Set(fields.map((f) => f.key));

  const missing: MissingField[] = [
    ...playbook.required.map((key) => ({ key, required: true })),
    ...playbook.recommended.map((key) => ({ key, required: false })),
  ]
    .filter((m) => !present.has(m.key))
    .map(({ key, required }) => ({
      key,
      required,
      label: EVIDENCE_FIELD_META[key].label,
      why: EVIDENCE_FIELD_META[key].why,
      howToFix: EVIDENCE_FIELD_META[key].howToFix,
    }));

  return {
    playbook,
    fields,
    missing,
    completeness: completenessScore(playbook.required, playbook.recommended, present),
    facts: extractFacts({ dispute, merchantName: clean(input.merchantName), fields, shipments, messages, usedLibrary }),
    references,
  };
}

/* ------------------------------------------------------------------ */
/* Facts                                                               */
/* ------------------------------------------------------------------ */

/** Free-text fields whose dates, amounts and ids become facts (not the transcript: customer claims are not facts). */
const FACT_TEXT_FIELDS = new Set<EvidenceFieldKey>(
  EVIDENCE_FIELD_KEYS.filter((k) => k !== "customer_communication" && k !== "uncategorized_text"),
);

function extractFacts(args: {
  dispute: NormalisedDispute;
  merchantName: string | null;
  fields: AssembledField[];
  shipments: Shipment[];
  messages: MessageLog[];
  usedLibrary: LibraryItem[];
}): Facts {
  const { dispute, fields, shipments, messages, usedLibrary } = args;
  const value = (k: EvidenceFieldKey) => fields.find((f) => f.key === k)?.value ?? null;
  const split = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const currency = dispute.currency.toLowerCase();
  const scale = 10 ** minorUnitDigits(currency);

  const cents: number[] = [dispute.amountCents];
  for (const li of dispute.checkout?.lineItems ?? []) if (typeof li.amountCents === "number") cents.push(li.amountCents);

  const dates: string[] = [];
  const pushDay = (v: string | null | undefined) => {
    const d = isoDay(v);
    if (d) dates.push(d);
  };
  pushDay(dispute.createdAt);
  pushDay(dispute.charge.createdAt);
  for (const s of shipments) {
    pushDay(s.shippedAt);
    pushDay(s.deliveredAt);
  }
  for (const m of messages) pushDay(m.occurredAt);

  const ids: string[] = [dispute.id, dispute.charge.id];
  const ips: string[] = [];
  const tracking: string[] = [...split(value("shipping_tracking_number"))];

  for (const f of fields) {
    // Skip the transcript and attachment-only fields (their value is a file name).
    if (!FACT_TEXT_FIELDS.has(f.key) || (fieldKind(f.key) === "file" && f.source === "manual" && f.fileId)) continue;
    let text = f.value;
    text = mask(text, findUrls(text));
    const ipSpans = findIps(text);
    ips.push(...ipSpans.map((s) => s.text));
    const idSpans = findStripeIds(text);
    ids.push(...idSpans.map((s) => s.text));
    const dateSpans = findDates(text);
    for (const d of dateSpans) for (const c of d.candidates) if (!c.startsWith("--")) dates.push(c);
    text = mask(text, [...ipSpans, ...idSpans, ...dateSpans]);
    const moneySpans = findMoney(text);
    for (const m of moneySpans) cents.push(Math.round(m.major * scale));
    text = mask(text, moneySpans);
    // Order numbers and other codes the merchant wrote down ("LG-10482" has no 8-char run; "LG10482AB" does).
    if (f.key !== "shipping_tracking_number") ids.push(...findTrackingLike(text).map((s) => s.text));
  }
  if (dispute.customer.ip) ips.push(dispute.customer.ip.trim());

  const uniqCents = uniq(cents.filter((c) => Number.isFinite(c) && c >= 0)).sort((a, b) => a - b);
  const amounts = uniq(uniqCents.flatMap((c) => [formatMoney(c, currency), formatPlainAmount(c, currency)]));

  const names = uniq(
    [value("customer_name"), dispute.customer.name, dispute.charge.billingDetails?.name, dispute.shipping?.name]
      .map(clean)
      .filter((n): n is string => Boolean(n)),
  );
  const emails = uniq(
    [value("customer_email_address"), dispute.customer.email, dispute.charge.billingDetails?.email]
      .map((e) => clean(e)?.toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
  const addresses = uniq(
    [value("billing_address"), value("shipping_address")].map(clean).filter((a): a is string => Boolean(a)),
  );
  const productNames = uniq(
    [
      ...(dispute.checkout?.lineItems ?? []).map((li) => li.description),
      ...usedLibrary.filter((i) => i.kind === "product_description").map((i) => i.title),
      dispute.charge.description ?? "",
    ]
      .map(clean)
      .filter((p): p is string => Boolean(p)),
  );
  const policyTitles = uniq(
    usedLibrary
      .filter((i) => i.kind !== "product_description" && i.kind !== "disclosure")
      .map((i) => i.title.trim())
      .filter(Boolean),
  );
  const messageExcerpts = messages.slice(-MAX_EXCERPTS).map((m) => {
    const who = m.direction === "inbound" ? "customer" : "merchant";
    return `${isoDay(m.occurredAt) ?? m.occurredAt} ${who}: ${truncate(m.body.trim().replace(/\s+/g, " "), EXCERPT_CHARS, "...")}`;
  });

  return {
    merchantName: args.merchantName,
    currency,
    amounts,
    amountCents: uniqCents,
    dates: uniq(dates).sort(),
    names,
    emails,
    addresses,
    trackingNumbers: uniq(tracking),
    carriers: uniq(split(value("shipping_carrier"))),
    productNames,
    policyTitles,
    ids: uniq(ids.map((i) => i.trim()).filter(Boolean)),
    ips: uniq(ips),
    messageExcerpts,
  };
}
