import "server-only";
import { and, asc, count, eq, gte, inArray, sql, sum, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { DISPUTE_REASONS, DISPUTE_STATUSES, disputes, OPEN_DISPUTE_STATUSES, packets } from "../schema";
import type { DisputeReason, DisputeStatus, Money } from "../types";

/**
 * Dashboard and analytics aggregates (spec 3.6). Money is grouped by
 * currency, never summed across currencies. Outcome metrics (`since`) filter
 * on `closed_at`; win rate counts only won and lost (refunded, prevented and
 * closed inquiries are neither a win nor a loss).
 */

export type WinRate = { won: number; lost: number; /** won / (won + lost); null when nothing was decided. */ winRate: number | null };

export function winRateOf(won: number, lost: number): WinRate {
  const decided = won + lost;
  return { won, lost, winRate: decided === 0 ? null : won / decided };
}

/** Disputes not final yet: how many, and the amount at stake per currency (largest first). */
export async function openAtStake(orgId: string): Promise<{ count: number; atStake: Money[] }> {
  const db = await getDb();
  const rows = await db
    .select({ currency: disputes.currency, n: count(), cents: sum(disputes.amountCents) })
    .from(disputes)
    .where(and(eq(disputes.orgId, orgId), inArray(disputes.status, [...OPEN_DISPUTE_STATUSES])))
    .groupBy(disputes.currency);
  const atStake = rows
    .map((r) => ({ currency: r.currency, amountCents: Number(r.cents ?? 0) }))
    .sort((a, b) => b.amountCents - a.amountCents || a.currency.localeCompare(b.currency));
  return { count: rows.reduce((total, r) => total + Number(r.n), 0), atStake };
}

/** Win rate overall and per reason (every reason present, zero-filled), optionally for disputes closed since. */
export async function winRateByReason(
  orgId: string,
  options: { since?: Date } = {},
): Promise<{ overall: WinRate; byReason: Record<DisputeReason, WinRate> }> {
  const where: SQL[] = [eq(disputes.orgId, orgId), inArray(disputes.status, ["won", "lost"])];
  if (options.since) where.push(gte(disputes.closedAt, options.since));
  const db = await getDb();
  const rows = await db
    .select({ reason: disputes.reason, status: disputes.status, n: count() })
    .from(disputes)
    .where(and(...where))
    .groupBy(disputes.reason, disputes.status);
  const tally = Object.fromEntries(DISPUTE_REASONS.map((r) => [r, { won: 0, lost: 0 }])) as Record<
    DisputeReason,
    { won: number; lost: number }
  >;
  for (const row of rows) {
    if (row.status === "won") tally[row.reason].won += Number(row.n);
    else tally[row.reason].lost += Number(row.n);
  }
  const byReason = Object.fromEntries(
    DISPUTE_REASONS.map((r) => [r, winRateOf(tally[r].won, tally[r].lost)]),
  ) as Record<DisputeReason, WinRate>;
  const won = DISPUTE_REASONS.reduce((t, r) => t + tally[r].won, 0);
  const lost = DISPUTE_REASONS.reduce((t, r) => t + tally[r].lost, 0);
  return { overall: winRateOf(won, lost), byReason };
}

/** Median completeness (0..100) of submitted packets, optionally submitted since; null when none. */
export async function medianSubmittedCompleteness(orgId: string, options: { since?: Date } = {}): Promise<number | null> {
  const where: SQL[] = [eq(packets.orgId, orgId), eq(packets.status, "submitted")];
  if (options.since) where.push(gte(packets.submittedAt, options.since));
  const db = await getDb();
  const [row] = await db
    .select({ median: sql<number | string | null>`percentile_cont(0.5) within group (order by ${packets.completeness})` })
    .from(packets)
    .where(and(...where));
  const value = row?.median;
  if (value === null || value === undefined) return null;
  const median = Number(value);
  return Number.isFinite(median) ? median : null;
}

/** Amount of won disputes per currency (largest first), optionally closed since. */
export async function recoveredCents(orgId: string, options: { since?: Date } = {}): Promise<Money[]> {
  const where: SQL[] = [eq(disputes.orgId, orgId), eq(disputes.status, "won")];
  if (options.since) where.push(gte(disputes.closedAt, options.since));
  const db = await getDb();
  const rows = await db
    .select({ currency: disputes.currency, cents: sum(disputes.amountCents) })
    .from(disputes)
    .where(and(...where))
    .groupBy(disputes.currency)
    .orderBy(asc(disputes.currency));
  return rows
    .map((r) => ({ currency: r.currency, amountCents: Number(r.cents ?? 0) }))
    .sort((a, b) => b.amountCents - a.amountCents || a.currency.localeCompare(b.currency));
}

/** Dispute counts per status (every status present, zero-filled); optionally only disputes opened since. */
export async function countsByStatus(
  orgId: string,
  options: { since?: Date } = {},
): Promise<Record<DisputeStatus, number>> {
  const where: SQL[] = [eq(disputes.orgId, orgId)];
  if (options.since) where.push(gte(disputes.openedAt, options.since));
  const db = await getDb();
  const rows = await db
    .select({ status: disputes.status, n: count() })
    .from(disputes)
    .where(and(...where))
    .groupBy(disputes.status);
  const counts = Object.fromEntries(DISPUTE_STATUSES.map((s) => [s, 0])) as Record<DisputeStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}
