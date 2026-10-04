import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { reminders } from "../schema";
import type { Reminder, ReminderKind } from "../types";
import { assertDisputeInOrg, isUuid } from "./shared";

/**
 * Records that a deadline reminder went out. Idempotent on (dispute, kind):
 * returns true only for the call that recorded it, so a sweep that runs twice
 * (or concurrently) sends each reminder once. Claim first, then send.
 */
export async function markSent(
  orgId: string,
  disputeId: string,
  kind: ReminderKind,
  sentAt: Date = new Date(),
): Promise<boolean> {
  const db = await getDb();
  await assertDisputeInOrg(db, orgId, disputeId);
  const rows = await db
    .insert(reminders)
    .values({ orgId, disputeId, kind, sentAt })
    .onConflictDoNothing({ target: [reminders.disputeId, reminders.kind] })
    .returning({ id: reminders.id });
  return rows.length > 0;
}

export async function hasSent(orgId: string, disputeId: string, kind: ReminderKind): Promise<boolean> {
  if (!isUuid(disputeId)) return false;
  const db = await getDb();
  const [row] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.orgId, orgId), eq(reminders.disputeId, disputeId), eq(reminders.kind, kind)))
    .limit(1);
  return Boolean(row);
}

export async function listForDispute(orgId: string, disputeId: string): Promise<Reminder[]> {
  if (!isUuid(disputeId)) return [];
  const db = await getDb();
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.orgId, orgId), eq(reminders.disputeId, disputeId)))
    .orderBy(asc(reminders.sentAt));
}
