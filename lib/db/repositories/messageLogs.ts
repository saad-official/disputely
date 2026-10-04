import "server-only";
import { and, asc, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { CHANNELS, MESSAGE_DIRECTIONS, messageLogs } from "../schema";
import type { Channel, MessageDirection, MessageLog } from "../types";
import { assertDisputeInOrg, clampLimit, isUuid, normalizeEmail } from "./shared";

export type MessageLogInput = {
  customerEmail: string;
  channel?: Channel;
  occurredAt: Date;
  direction: MessageDirection;
  body: string;
  disputeId?: string | null;
};

/** Pasted logs can be long; one bulk insert is capped so a paste never becomes a runaway write. */
export const MAX_BULK_MESSAGES = 500;
const MAX_BODY = 20_000;

function toRow(orgId: string, input: MessageLogInput): typeof messageLogs.$inferInsert {
  const customerEmail = normalizeEmail(input.customerEmail);
  if (!/^[^\s@]+@[^\s@]+$/.test(customerEmail)) throw new Error("A message log needs the customer's email address.");
  const channel = input.channel ?? "email";
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new Error(`Unknown channel: ${channel}`);
  if (!(MESSAGE_DIRECTIONS as readonly string[]).includes(input.direction)) {
    throw new Error(`Unknown direction: ${input.direction}`);
  }
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
    throw new Error("Each message needs a valid date and time.");
  }
  const body = input.body.trim();
  if (!body) throw new Error("A message log entry cannot be empty.");
  return {
    orgId,
    customerEmail,
    channel,
    occurredAt: input.occurredAt,
    direction: input.direction,
    body: body.slice(0, MAX_BODY),
    disputeId: input.disputeId ?? null,
  };
}

export async function add(orgId: string, input: MessageLogInput): Promise<MessageLog> {
  const row = toRow(orgId, input);
  const db = await getDb();
  if (row.disputeId) await assertDisputeInOrg(db, orgId, row.disputeId);
  const [inserted] = await db.insert(messageLogs).values(row).returning();
  return inserted;
}

/**
 * Inserts many entries in one statement (all or nothing), e.g. a pasted
 * conversation after lib/domain has split it into messages. Every entry is
 * validated before anything is written.
 */
export async function bulkInsert(orgId: string, entries: readonly MessageLogInput[]): Promise<MessageLog[]> {
  if (entries.length === 0) return [];
  if (entries.length > MAX_BULK_MESSAGES) throw new Error(`Paste at most ${MAX_BULK_MESSAGES} messages at a time.`);
  const rows = entries.map((entry) => toRow(orgId, entry));
  const db = await getDb();
  for (const disputeId of new Set(rows.map((r) => r.disputeId).filter((id): id is string => Boolean(id)))) {
    await assertDisputeInOrg(db, orgId, disputeId);
  }
  return db.insert(messageLogs).values(rows).returning();
}

/** A customer's messages (email matched case-insensitively), oldest first, optionally from `since`. */
export async function listForCustomer(
  orgId: string,
  email: string,
  options: { since?: Date } = {},
): Promise<MessageLog[]> {
  const where: SQL[] = [eq(messageLogs.orgId, orgId), eq(messageLogs.customerEmail, normalizeEmail(email))];
  if (options.since) where.push(gte(messageLogs.occurredAt, options.since));
  const db = await getDb();
  return db
    .select()
    .from(messageLogs)
    .where(and(...where))
    .orderBy(asc(messageLogs.occurredAt), asc(messageLogs.id));
}

export async function listForDispute(orgId: string, disputeId: string): Promise<MessageLog[]> {
  if (!isUuid(disputeId)) return [];
  const db = await getDb();
  return db
    .select()
    .from(messageLogs)
    .where(and(eq(messageLogs.orgId, orgId), eq(messageLogs.disputeId, disputeId)))
    .orderBy(asc(messageLogs.occurredAt), asc(messageLogs.id));
}

/** Links the org's message logs to a dispute (ids from another org are ignored). Returns how many changed. */
export async function attachToDispute(orgId: string, messageLogIds: readonly string[], disputeId: string): Promise<number> {
  const ids = messageLogIds.filter(isUuid);
  if (ids.length === 0) return 0;
  const db = await getDb();
  await assertDisputeInOrg(db, orgId, disputeId);
  const rows = await db
    .update(messageLogs)
    .set({ disputeId })
    .where(and(eq(messageLogs.orgId, orgId), inArray(messageLogs.id, ids)))
    .returning({ id: messageLogs.id });
  return rows.length;
}

export async function remove(orgId: string, messageLogId: string): Promise<boolean> {
  if (!isUuid(messageLogId)) return false;
  const db = await getDb();
  const rows = await db
    .delete(messageLogs)
    .where(and(eq(messageLogs.id, messageLogId), eq(messageLogs.orgId, orgId)))
    .returning({ id: messageLogs.id });
  return rows.length > 0;
}

/** The organization's most recent messages, newest first (the Records tab). */
export async function listRecent(orgId: string, limit = 100): Promise<MessageLog[]> {
  const db = await getDb();
  return db
    .select()
    .from(messageLogs)
    .where(eq(messageLogs.orgId, orgId))
    .orderBy(desc(messageLogs.occurredAt), desc(messageLogs.id))
    .limit(clampLimit(limit, 100, 500));
}

/** Deletes every message with these customers (demo cleanup). Returns how many. */
export async function removeForCustomers(orgId: string, emails: readonly string[]): Promise<number> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (normalized.length === 0) return 0;
  const db = await getDb();
  const rows = await db
    .delete(messageLogs)
    .where(and(eq(messageLogs.orgId, orgId), inArray(messageLogs.customerEmail, normalized)))
    .returning({ id: messageLogs.id });
  return rows.length;
}
