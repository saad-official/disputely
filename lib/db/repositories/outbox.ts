import "server-only";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { outbox } from "../schema";
import type { OutboxAttachment, OutboxMessage } from "../types";
import { clampLimit } from "./shared";

export type InsertOutboxInput = {
  toEmail: string;
  subject: string;
  text: string;
  html?: string | null;
  /** Short message kind, e.g. "deadline_reminder", "outcome". */
  kind?: string | null;
  disputeId?: string | null;
  attachments?: OutboxAttachment[];
  provider?: OutboxMessage["provider"];
  providerMessageId?: string | null;
  deliveredTo?: string | null;
  status?: OutboxMessage["status"];
};

export async function insert(orgId: string, input: InsertOutboxInput): Promise<OutboxMessage> {
  const db = await getDb();
  const [row] = await db
    .insert(outbox)
    .values({
      orgId,
      kind: input.kind ?? null,
      disputeId: input.disputeId ?? null,
      toEmail: input.toEmail,
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
      attachments: input.attachments ?? [],
      provider: input.provider ?? "outbox",
      providerMessageId: input.providerMessageId ?? null,
      deliveredTo: input.deliveredTo ?? null,
      status: input.status ?? "queued",
    })
    .returning();
  return row;
}

/** Newest first; optionally only one dispute's mail. */
export async function listForOrg(
  orgId: string,
  options: { limit?: number; disputeId?: string } = {},
): Promise<OutboxMessage[]> {
  const where: SQL[] = [eq(outbox.orgId, orgId)];
  if (options.disputeId) where.push(eq(outbox.disputeId, options.disputeId));
  const db = await getDb();
  return db
    .select()
    .from(outbox)
    .where(and(...where))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(clampLimit(options.limit));
}

/** Cron only (not org-scoped): failed messages to retry, oldest first. */
export async function listFailed(limit = 20): Promise<OutboxMessage[]> {
  const db = await getDb();
  return db
    .select()
    .from(outbox)
    .where(eq(outbox.status, "failed"))
    .orderBy(asc(outbox.createdAt), asc(outbox.id))
    .limit(clampLimit(limit, 20, 100));
}

export type DeliveryUpdate = {
  status: OutboxMessage["status"];
  provider?: OutboxMessage["provider"];
  providerMessageId?: string | null;
  deliveredTo?: string | null;
};

/** Records the result of a (re)send. */
export async function updateDelivery(messageId: string, update: DeliveryUpdate): Promise<void> {
  const values: Partial<typeof outbox.$inferInsert> = { status: update.status };
  if (update.provider !== undefined) values.provider = update.provider;
  if (update.providerMessageId !== undefined) values.providerMessageId = update.providerMessageId;
  if (update.deliveredTo !== undefined) values.deliveredTo = update.deliveredTo;
  const db = await getDb();
  await db.update(outbox).set(values).where(eq(outbox.id, messageId));
}
