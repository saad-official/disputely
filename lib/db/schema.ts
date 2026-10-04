/**
 * Database schema (spec section 4). Everything, including Better Auth's
 * tables, lives in the `disputely` Postgres schema so the database can be
 * dedicated or shared with other apps. No extensions are needed
 * (gen_random_uuid() is core Postgres 13+).
 *
 * Multi-tenancy is by `org_id` plus explicit `where` clauses in
 * `lib/db/repositories/*` (no row-level security). Every tenant table carries
 * `org_id` (ON DELETE CASCADE), even when it is derivable through a parent,
 * so each query can filter on it directly.
 *
 * Conventions:
 * - Money is integer minor units (`amount_cents`, Stripe's `amount`) with a
 *   lower-case ISO currency code next to it. Amounts in different currencies
 *   are never summed together (metrics group by currency).
 * - `disputes` mirrors Stripe: `reason` and `status` use Stripe's values
 *   (Stripe reasons outside the playbook list map to `other`, see
 *   `toDisputeReason`). `opened_at` is Stripe's `dispute.created`; the Free
 *   plan's 3-a-month limit counts disputes by it (UTC calendar month).
 *   `closed_at` is stamped the first time a sync sees a final status.
 * - Customer emails (`message_logs.customer_email`) are stored trimmed and
 *   lower-cased so per-customer lookups are a plain index scan.
 * - Binary blobs (`packets.pdf`, `attachments.bytes`) are `bytea` and are
 *   never selected by list queries; repositories expose explicit getters.
 * - The merchant's Stripe restricted key is only ever stored encrypted
 *   (`organizations.stripe_restricted_key_ciphertext`, lib/crypto/secretbox.ts).
 * - A submitted packet is frozen: content writes are refused and the exact
 *   payload sent to Stripe is kept in `submitted_snapshot`.
 *
 * Hand-written migration (drizzle/): 0001_agent_events_append_only, a trigger
 * that rejects UPDATE, DELETE and TRUNCATE on agent_events.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const disputely = pgSchema("disputely");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/**
 * `bytea` as a Node Buffer. postgres.js returns Buffer, PGlite returns
 * Uint8Array; both are normalised to Buffer (no copy) so `Response` bodies
 * and the Stripe file upload accept it directly.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) =>
    Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength),
});

// ---------------------------------------------------------------------------
// Enums (value lists exported for zod schemas and UI)
// ---------------------------------------------------------------------------

export const PLANS = ["free", "pro"] as const;
export const MEMBERSHIP_ROLES = ["owner", "member"] as const;

/**
 * Stripe dispute reasons with a playbook (spec 3.3), plus `other` for every
 * Stripe reason without one (bank_cannot_process, check_returned,
 * customer_initiated, debit_not_authorized, incorrect_account_details,
 * insufficient_funds, noncompliant, and anything Stripe adds later).
 */
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

/**
 * Stripe dispute statuses. `charge_refunded` is a legacy Stripe status kept
 * for older API versions; `prevented` is current Stripe (stripe-node v23).
 */
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

export const PACKET_STATUSES = ["draft", "ready", "submitted"] as const;

export const LIBRARY_KINDS = [
  "refund_policy",
  "cancellation_policy",
  "terms",
  "product_description",
  "shipping_policy",
  "disclosure",
  "other",
] as const;

export const CHANNELS = ["email", "chat", "phone", "sms", "other"] as const;
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
/** Deadline reminders at 7, 3 and 1 day before `due_by` (spec 3.6). */
export const REMINDER_KINDS = ["due_7d", "due_3d", "due_1d"] as const;
export const EMAIL_PROVIDERS = ["outbox", "resend"] as const;
export const OUTBOX_STATUSES = ["queued", "sent", "delivered", "failed"] as const;
export const ACTORS = ["agent", "user", "system", "cron", "webhook"] as const;

/** Where a packet field's value came from (packets.fields[*].source). */
export const FIELD_SOURCES = ["stripe", "library", "message_log", "shipment", "attachment", "merchant", "model"] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export type FieldSource = (typeof FIELD_SOURCES)[number];

/** The merchant still has to act (the app-shell badge, reminders). */
export const NEEDS_RESPONSE_STATUSES = ["warning_needs_response", "needs_response"] as const satisfies readonly DisputeStatus[];
/** Not final yet: needs a response or is with the bank. */
export const OPEN_DISPUTE_STATUSES = [
  "warning_needs_response",
  "needs_response",
  "warning_under_review",
  "under_review",
] as const satisfies readonly DisputeStatus[];
/** Final statuses; the first sync that sees one stamps `closed_at`. */
export const CLOSED_DISPUTE_STATUSES = [
  "warning_closed",
  "won",
  "lost",
  "charge_refunded",
  "prevented",
] as const satisfies readonly DisputeStatus[];

/** Stripe's reason string, with reasons that have no playbook mapped to `other`. */
export function toDisputeReason(reason: string | null | undefined): DisputeReason {
  return (DISPUTE_REASONS as readonly string[]).includes(reason ?? "") ? (reason as DisputeReason) : "other";
}

export function isDisputeStatus(status: unknown): status is DisputeStatus {
  return typeof status === "string" && (DISPUTE_STATUSES as readonly string[]).includes(status);
}

export function isClosedStatus(status: DisputeStatus): boolean {
  return (CLOSED_DISPUTE_STATUSES as readonly DisputeStatus[]).includes(status);
}

export const planEnum = disputely.enum("plan", PLANS);
export const membershipRoleEnum = disputely.enum("membership_role", MEMBERSHIP_ROLES);
export const disputeReasonEnum = disputely.enum("dispute_reason", DISPUTE_REASONS);
export const disputeStatusEnum = disputely.enum("dispute_status", DISPUTE_STATUSES);
export const packetStatusEnum = disputely.enum("packet_status", PACKET_STATUSES);
export const libraryKindEnum = disputely.enum("library_kind", LIBRARY_KINDS);
export const channelEnum = disputely.enum("message_channel", CHANNELS);
export const messageDirectionEnum = disputely.enum("message_direction", MESSAGE_DIRECTIONS);
export const reminderKindEnum = disputely.enum("reminder_kind", REMINDER_KINDS);
export const emailProviderEnum = disputely.enum("email_provider", EMAIL_PROVIDERS);
export const outboxStatusEnum = disputely.enum("outbox_status", OUTBOX_STATUSES);
export const actorEnum = disputely.enum("actor", ACTORS);

// ---------------------------------------------------------------------------
// JSON column shapes (camelCase, written by the sync normaliser; all fields
// optional so older rows and partial Stripe objects stay valid)
// ---------------------------------------------------------------------------

export type PostalAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
};

/** disputes.customer: the Stripe customer and/or the charge's billing details. */
export type DisputeCustomer = {
  stripeCustomerId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: PostalAddress | null;
  /** IP from Checkout / Radar, when known. */
  ipAddress?: string | null;
};

/** disputes.charge: what was bought and how it was paid. */
export type DisputeCharge = {
  /** ISO datetime of the charge. */
  createdAt?: string | null;
  description?: string | null;
  statementDescriptor?: string | null;
  receiptUrl?: string | null;
  receiptNumber?: string | null;
  invoiceId?: string | null;
  checkoutSessionId?: string | null;
  card?: {
    brand?: string | null;
    last4?: string | null;
    expMonth?: number | null;
    expYear?: number | null;
    /** "pass" | "fail" | "unavailable" | "unchecked". */
    cvcCheck?: string | null;
    addressLine1Check?: string | null;
    addressPostalCodeCheck?: string | null;
    threeDSecure?: string | null;
  } | null;
  lineItems?: { description: string; quantity?: number | null; amountCents?: number | null }[];
  /** Amount refunded so far, minor units. */
  amountRefundedCents?: number | null;
};

/** disputes.shipping: the charge's or Checkout session's shipping details. */
export type DisputeShipping = {
  name?: string | null;
  phone?: string | null;
  address?: PostalAddress | null;
  carrier?: string | null;
  trackingNumber?: string | null;
};

/** disputes.evidence_details: Stripe's `evidence_details`. */
export type DisputeEvidenceDetails = {
  /** ISO datetime. */
  dueBy?: string | null;
  hasEvidence?: boolean;
  pastDue?: boolean;
  submissionCount?: number;
  /** Visa CE 3.0 etc. eligibility, as Stripe reports it. */
  enhancedEligibilityTypes?: string[];
};

/** One evidence field in a packet (packets.fields[field]). Keys are Stripe evidence field names. */
export type PacketField = {
  value: string;
  source: FieldSource;
  /** Human detail for the source, e.g. the library item title or "Charge ch_123". */
  sourceLabel?: string | null;
  /** Id of the library item, message log, shipment or attachment the value came from. */
  sourceId?: string | null;
};

export type PacketFields = Record<string, PacketField>;

/** packets.narrative_meta: what the narrative guardrails did (spec 3.4). */
export type NarrativeMeta = {
  /** Dates, amounts, tracking numbers and names found in the assembled facts. */
  verifiedFacts?: string[];
  /** Claims removed because they were not in the assembled facts. */
  removedClaims?: string[];
  model?: string | null;
  promptVersion?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
  /** ISO datetime. */
  generatedAt?: string;
};

export type OutboxAttachment = {
  filename: string;
  contentType: string;
  /** UTF-8 text content. */
  content: string;
};

// ---------------------------------------------------------------------------
// Better Auth core schema (v1.7). JS keys are Better Auth's field names (the
// adapter looks columns up by them); column names are snake_case.
// ---------------------------------------------------------------------------

export const user = disputely.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Additional field (lib/auth/server.ts): names the organization created on sign-up. */
  businessName: text("business_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = disputely.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = disputely.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = disputely.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Tenancy and settings
// ---------------------------------------------------------------------------

export const organizations = disputely.table("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  /** Stripe subscription status as last synced (active, trialing, past_due, canceled, ...). */
  subscriptionStatus: text("subscription_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** IANA time zone for deadline display and reminder emails. */
  timezone: text("timezone").notNull().default("UTC"),
  /**
   * The merchant's Stripe restricted key (rk_...), encrypted with the per-org
   * key from lib/crypto/secretbox.ts ("v1." + base64url). Never plaintext.
   */
  stripeRestrictedKeyCiphertext: text("stripe_restricted_key_ciphertext"),
  /** Display label for the connected account, e.g. "Larkspur Goods (acct_...)" or the masked key. */
  stripeAccountLabel: text("stripe_account_label"),
  stripeKeyConnectedAt: timestamp("stripe_key_connected_at", { withTimezone: true }),
  /** Deadline reminder emails (Pro). */
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  /** Where reminders go; null means the owner's sign-in email. */
  reminderEmail: text("reminder_email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = disputely.table(
  "memberships",
  {
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_id_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Disputes and packets
// ---------------------------------------------------------------------------

export const disputes = disputely.table(
  "disputes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** Stripe `dp_...`. Unique per organization; the sync upserts on it. */
    stripeDisputeId: text("stripe_dispute_id").notNull(),
    chargeId: text("charge_id").notNull(),
    paymentIntentId: text("payment_intent_id"),
    amountCents: integer("amount_cents").notNull(),
    /** Lower-case ISO 4217, e.g. "usd". */
    currency: text("currency").notNull(),
    reason: disputeReasonEnum("reason").notNull(),
    /** Stripe's raw reason when it mapped to `other`, for display. */
    stripeReason: text("stripe_reason"),
    status: disputeStatusEnum("status").notNull(),
    /** Evidence deadline (Stripe evidence_details.due_by); null once closed or for some warnings. */
    dueBy: timestamp("due_by", { withTimezone: true }),
    /** Pro templates: the product line the merchant tagged this dispute with; null uses the default library items. */
    productLine: text("product_line"),
    /** Stripe `dispute.created`. */
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    customer: jsonb("customer").$type<DisputeCustomer>().notNull().default({}),
    charge: jsonb("charge").$type<DisputeCharge>().notNull().default({}),
    shipping: jsonb("shipping").$type<DisputeShipping>(),
    evidenceDetails: jsonb("evidence_details").$type<DisputeEvidenceDetails>().notNull().default({}),
    isChargeRefundable: boolean("is_charge_refundable").notNull().default(false),
    livemode: boolean("livemode").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Merchant's note on the outcome (e.g. what the bank said). */
    outcomeNote: text("outcome_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("disputes_org_stripe_dispute_key").on(t.orgId, t.stripeDisputeId),
    index("disputes_org_status_due_idx").on(t.orgId, t.status, t.dueBy),
    index("disputes_org_opened_idx").on(t.orgId, t.openedAt.desc()),
    index("disputes_org_charge_idx").on(t.orgId, t.chargeId),
    check("disputes_amount_check", sql`${t.amountCents} >= 0`),
  ],
);

export const packets = disputely.table(
  "packets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** One packet per dispute. */
    disputeId: uuid("dispute_id")
      .notNull()
      .unique()
      .references(() => disputes.id, { onDelete: "cascade" }),
    /** Playbook key (the dispute reason it was assembled for). */
    playbook: text("playbook").notNull(),
    /** Stripe evidence field name -> value and where it came from. */
    fields: jsonb("fields").$type<PacketFields>().notNull().default({}),
    /** `uncategorized_text`, written by the model under the guardrails (spec 3.4). */
    narrative: text("narrative").notNull().default(""),
    narrativeMeta: jsonb("narrative_meta").$type<NarrativeMeta>(),
    /** 0..100. */
    completeness: smallint("completeness").notNull().default(0),
    /** Evidence fields / merchant inputs the playbook wants but the packet lacks. */
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    status: packetStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** The exact evidence payload sent to Stripe. */
    submittedSnapshot: jsonb("submitted_snapshot"),
    /** Stripe's dispute object as returned by the submit call. */
    stripeResponse: jsonb("stripe_response"),
    /** Rendered PDF packet; cleared whenever the content changes. */
    pdf: bytea("pdf"),
    pdfGeneratedAt: timestamp("pdf_generated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("packets_org_status_idx").on(t.orgId, t.status),
    check("packets_completeness_check", sql`${t.completeness} between 0 and 100`),
  ],
);

/** Stripe's per-file limit for dispute evidence (spec 3.4). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export const attachments = disputely.table(
  "attachments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    packetId: uuid("packet_id")
      .notNull()
      .references(() => packets.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").$type<AttachmentMimeType>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Never selected by list queries. */
    bytes: bytea("bytes").notNull(),
    /** Stripe `file_...` once uploaded with purpose dispute_evidence. */
    stripeFileId: text("stripe_file_id"),
    /** The Stripe evidence file field it supports, e.g. "shipping_documentation", "uncategorized_file". */
    field: text("field").notNull().default("uncategorized_file"),
    createdAt: createdAt(),
  },
  (t) => [
    index("attachments_packet_idx").on(t.packetId, t.createdAt),
    index("attachments_org_idx").on(t.orgId),
    check("attachments_size_check", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= ${sql.raw(String(MAX_ATTACHMENT_BYTES))}`),
  ],
);

// ---------------------------------------------------------------------------
// Merchant records the assembler draws on
// ---------------------------------------------------------------------------

export const libraryItems = disputely.table(
  "library_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    kind: libraryKindEnum("kind").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    /** Where the policy is published, when it is. */
    url: text("url"),
    /** Pro templates per product line; null applies to every product line. */
    productLine: text("product_line"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("library_items_org_kind_idx").on(t.orgId, t.kind, t.updatedAt.desc())],
);

export const messageLogs = disputely.table(
  "message_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    disputeId: uuid("dispute_id").references(() => disputes.id, { onDelete: "set null" }),
    /** Trimmed and lower-cased. */
    customerEmail: text("customer_email").notNull(),
    channel: channelEnum("channel").notNull().default("email"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("message_logs_org_customer_idx").on(t.orgId, t.customerEmail, t.occurredAt),
    index("message_logs_dispute_idx")
      .on(t.disputeId, t.occurredAt)
      .where(sql`${t.disputeId} is not null`),
  ],
);

export const shipments = disputely.table(
  "shipments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** Stripe `ch_...` the shipment fulfils; one shipment record per charge. */
    chargeId: text("charge_id").notNull(),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Carrier proof-of-delivery page or document. */
    proofUrl: text("proof_url"),
    /** Delivery address matched the billing/shipping address on the charge; null when unknown. */
    addressMatch: boolean("address_match"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("shipments_org_charge_key").on(t.orgId, t.chargeId)],
);

export const reminders = disputely.table(
  "reminders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),
    kind: reminderKindEnum("kind").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reminders_dispute_kind_key").on(t.disputeId, t.kind),
    index("reminders_org_sent_idx").on(t.orgId, t.sentAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Email and audit
// ---------------------------------------------------------------------------

export const outbox = disputely.table(
  "outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: orgId(),
    /** e.g. "deadline_reminder", "outcome". */
    kind: text("kind"),
    disputeId: uuid("dispute_id").references(() => disputes.id, { onDelete: "set null" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text").notNull(),
    attachments: jsonb("attachments").$type<OutboxAttachment[]>().notNull().default([]),
    provider: emailProviderEnum("provider").notNull().default("outbox"),
    providerMessageId: text("provider_message_id"),
    /** Where the message actually went (differs from to_email in demo mode). */
    deliveredTo: text("delivered_to"),
    status: outboxStatusEnum("status").notNull().default("queued"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_org_created_idx").on(t.orgId, t.createdAt.desc())],
);

export const agentEvents = disputely.table(
  "agent_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** null for system events not tied to an organization (e.g. cron sweeps). */
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    actor: actorEnum("actor").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    input: jsonb("input"),
    output: jsonb("output"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_events_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("agent_events_entity_idx")
      .on(t.entityType, t.entityId, t.createdAt.desc())
      .where(sql`${t.entityId} is not null`),
  ],
);
