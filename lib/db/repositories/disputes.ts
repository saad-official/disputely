import "server-only";
import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "../client";
import {
  CLOSED_DISPUTE_STATUSES,
  disputes,
  isClosedStatus,
  NEEDS_RESPONSE_STATUSES,
  OPEN_DISPUTE_STATUSES,
  toDisputeReason,
} from "../schema";
import type {
  Dispute,
  DisputeCharge,
  DisputeCustomer,
  DisputeEvidenceDetails,
  DisputeShipping,
  DisputeStatus,
} from "../types";
import { clampLimit, clampOffset, isUuid, monthStartUtc, nextMonthStartUtc } from "./shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Stripe dispute after the sync normaliser (lib/stripe) has flattened it. */
export type NormalizedDispute = {
  stripeDisputeId: string;
  chargeId: string;
  paymentIntentId?: string | null;
  amountCents: number;
  currency: string;
  /** Stripe's raw reason; reasons without a playbook are stored as `other`. */
  reason: string;
  status: DisputeStatus;
  dueBy?: Date | null;
  /** Stripe `dispute.created`. */
  openedAt: Date;
  customer?: DisputeCustomer;
  charge?: DisputeCharge;
  shipping?: DisputeShipping | null;
  evidenceDetails?: DisputeEvidenceDetails;
  isChargeRefundable?: boolean;
  livemode?: boolean;
};

export type UpsertResult = { dispute: Dispute; created: boolean };

/**
 * Inserts or refreshes a dispute from Stripe, keyed on (org, stripe_dispute_id).
 * Idempotent: replaying the same Stripe object leaves the row unchanged apart
 * from `synced_at`. `closed_at` is stamped the first time a final status is
 * seen and cleared if Stripe reopens it (an inquiry escalating to a
 * chargeback). `outcome_note` and `created_at` are never touched by a sync.
 */
export async function upsertFromStripe(orgId: string, input: NormalizedDispute): Promise<UpsertResult> {
  if (!input.stripeDisputeId.trim()) throw new Error("A Stripe dispute id is required.");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error("Dispute amount must be a non-negative whole number of minor units.");
  }
  const reason = toDisputeReason(input.reason);
  const now = new Date();
  const closed = isClosedStatus(input.status);
  const values = {
    chargeId: input.chargeId,
    paymentIntentId: input.paymentIntentId ?? null,
    amountCents: input.amountCents,
    currency: input.currency.trim().toLowerCase(),
    reason,
    stripeReason: input.reason,
    status: input.status,
    dueBy: input.dueBy ?? null,
    openedAt: input.openedAt,
    customer: input.customer ?? {},
    charge: input.charge ?? {},
    shipping: input.shipping ?? null,
    evidenceDetails: input.evidenceDetails ?? {},
    isChargeRefundable: input.isChargeRefundable ?? false,
    livemode: input.livemode ?? false,
    syncedAt: now,
  };
  const db = await getDb();
  const [row] = await db
    .insert(disputes)
    .values({ orgId, stripeDisputeId: input.stripeDisputeId.trim(), ...values, closedAt: closed ? now : null })
    .onConflictDoUpdate({
      target: [disputes.orgId, disputes.stripeDisputeId],
      set: {
        ...values,
        closedAt: closed ? sql`coalesce(${disputes.closedAt}, ${now.toISOString()}::timestamptz)` : null,
        updatedAt: now,
      },
    })
    .returning({ ...getTableColumns(disputes), inserted: sql<boolean>`(xmax = 0)` });
  const { inserted, ...dispute } = row;
  return { dispute, created: Boolean(inserted) };
}

export async function getById(orgId: string, disputeId: string): Promise<Dispute | null> {
  if (!isUuid(disputeId)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, disputeId), eq(disputes.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function getByStripeId(orgId: string, stripeDisputeId: string): Promise<Dispute | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.orgId, orgId), eq(disputes.stripeDisputeId, stripeDisputeId)))
    .limit(1);
  return row ?? null;
}

/**
 * Disputes that are not final, soonest deadline first (no deadline last).
 * `needsResponseOnly` drops the ones already with the bank.
 */
export async function listOpen(orgId: string, options: { needsResponseOnly?: boolean } = {}): Promise<Dispute[]> {
  const statuses = options.needsResponseOnly ? NEEDS_RESPONSE_STATUSES : OPEN_DISPUTE_STATUSES;
  const db = await getDb();
  return db
    .select()
    .from(disputes)
    .where(and(eq(disputes.orgId, orgId), inArray(disputes.status, [...statuses])))
    .orderBy(sql`${disputes.dueBy} asc nulls last`, asc(disputes.openedAt), asc(disputes.id));
}

export type ListDisputesOptions = {
  status?: DisputeStatus | readonly DisputeStatus[];
  limit?: number;
  offset?: number;
};

/** Newest first (by Stripe's opened date), optionally filtered by status, with the total for pagination. */
export async function listAll(
  orgId: string,
  options: ListDisputesOptions = {},
): Promise<{ items: Dispute[]; total: number }> {
  const where: SQL[] = [eq(disputes.orgId, orgId)];
  if (typeof options.status === "string") where.push(eq(disputes.status, options.status));
  else if (options.status) {
    if (options.status.length === 0) return { items: [], total: 0 };
    where.push(inArray(disputes.status, [...options.status]));
  }
  const db = await getDb();
  const [items, [totals]] = await Promise.all([
    db
      .select()
      .from(disputes)
      .where(and(...where))
      .orderBy(desc(disputes.openedAt), desc(disputes.id))
      .limit(clampLimit(options.limit, 25, 100))
      .offset(clampOffset(options.offset)),
    db.select({ n: count() }).from(disputes).where(and(...where)),
  ]);
  return { items, total: Number(totals?.n ?? 0) };
}

export type OutcomeInput = {
  /** A final status (usually won or lost from the webhook); omit to only change the note. */
  status?: (typeof CLOSED_DISPUTE_STATUSES)[number];
  /** null clears the note; omit to leave it. */
  note?: string | null;
};

/** Records the outcome and/or the merchant's outcome note. Stamps `closed_at` once. */
export async function markOutcome(orgId: string, disputeId: string, outcome: OutcomeInput): Promise<Dispute | null> {
  if (!isUuid(disputeId)) return null;
  const values: PgUpdateSetSource<typeof disputes> = {};
  if (outcome.status !== undefined) {
    if (!isClosedStatus(outcome.status)) throw new Error(`${outcome.status} is not a final dispute status.`);
    values.status = outcome.status;
    values.closedAt = sql`coalesce(${disputes.closedAt}, now())`;
  }
  if (outcome.note !== undefined) values.outcomeNote = outcome.note?.trim().slice(0, 2000) || null;
  if (Object.keys(values).length === 0) return getById(orgId, disputeId);
  const db = await getDb();
  const [row] = await db
    .update(disputes)
    .set(values)
    .where(and(eq(disputes.id, disputeId), eq(disputes.orgId, orgId)))
    .returning();
  return row ?? null;
}

/** Disputes Stripe opened in the UTC calendar month containing `now` (the Free plan's 3-a-month limit). */
export async function countThisMonth(orgId: string, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(disputes)
    .where(
      and(
        eq(disputes.orgId, orgId),
        gte(disputes.openedAt, monthStartUtc(now)),
        lt(disputes.openedAt, nextMonthStartUtc(now)),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Disputes the merchant still has to respond to (the Disputes nav badge). */
export async function countNeedsResponse(orgId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(disputes)
    .where(and(eq(disputes.orgId, orgId), inArray(disputes.status, [...NEEDS_RESPONSE_STATUSES])));
  return Number(row?.n ?? 0);
}

/**
 * Disputes needing a response whose deadline falls in (now, now + days],
 * soonest first. Reminder candidates; `reminders` dedupes the sends.
 */
export async function dueWithin(orgId: string, days: number, now: Date = new Date()): Promise<Dispute[]> {
  const db = await getDb();
  return db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.orgId, orgId),
        inArray(disputes.status, [...NEEDS_RESPONSE_STATUSES]),
        gt(disputes.dueBy, now),
        lte(disputes.dueBy, new Date(now.getTime() + days * DAY_MS)),
      ),
    )
    .orderBy(asc(disputes.dueBy), asc(disputes.id));
}

/**
 * Cron only (not org-scoped): organizations with at least one dispute
 * needing a response due in (now, now + days]. The reminder sweep then calls
 * `dueWithin` per org.
 */
export async function orgIdsWithDisputesDueWithin(days: number, now: Date = new Date()): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ orgId: disputes.orgId })
    .from(disputes)
    .where(
      and(
        inArray(disputes.status, [...NEEDS_RESPONSE_STATUSES]),
        gt(disputes.dueBy, now),
        lte(disputes.dueBy, new Date(now.getTime() + days * DAY_MS)),
      ),
    );
  return rows.map((r) => r.orgId);
}
