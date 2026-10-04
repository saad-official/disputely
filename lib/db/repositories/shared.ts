import "server-only";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../client";
import { disputes, packets } from "../schema";

/** `org_id = $orgId`, or `org_id is null` for anonymous (org-less) rows. */
export function orgMatch(column: PgColumn, orgId: string | null): SQL {
  return orgId === null ? isNull(column) : eq(column, orgId);
}

const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Random url-safe id. 64 symbols, so masking a byte to 6 bits is unbiased. */
export function randomUrlSafeId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += URL_SAFE[byte & 63];
  return out;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards lookups so a malformed id is a miss, not a Postgres cast error. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Throws NotFoundError unless the dispute exists and belongs to the organization. */
export async function assertDisputeInOrg(db: Db, orgId: string, disputeId: string): Promise<void> {
  if (!isUuid(disputeId)) throw new NotFoundError("Dispute");
  const [row] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.id, disputeId), eq(disputes.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Dispute");
}

/** Throws NotFoundError unless the packet exists and belongs to the organization; returns its status. */
export async function assertPacketInOrg(
  db: Db,
  orgId: string,
  packetId: string,
): Promise<{ status: (typeof packets.$inferSelect)["status"] }> {
  if (!isUuid(packetId)) throw new NotFoundError("Packet");
  const [row] = await db
    .select({ status: packets.status })
    .from(packets)
    .where(and(eq(packets.id, packetId), eq(packets.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Packet");
  return row;
}

/** Postgres unique violation (23505), optionally on one constraint; follows `cause` chains (Drizzle wraps driver errors). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === "23505") {
      if (!constraint) return true;
      if (e.constraint === constraint || e.constraint_name === constraint) return true;
    }
    current = e.cause;
  }
  return false;
}

/** A table's columns minus one (e.g. a bytea blob list queries must not load). */
export function columnsWithout<T extends Record<string, unknown>, K extends keyof T>(columns: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(columns).filter(([name]) => name !== key)) as Omit<T, K>;
}

export function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}

export function clampOffset(offset: number | undefined): number {
  return offset && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

/** True for a valid IANA time zone name ("Europe/London", "UTC"). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Trimmed, lower-cased email: the stored and compared form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** An http(s) URL, trimmed; null for empty input. Throws on anything else. */
export function normalizeHttpUrl(value: string | null | undefined, label = "URL"): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a full http(s) address.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must start with http or https.`);
  return url.toString();
}

/** First instant of the UTC calendar month containing `now`. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First instant of the next UTC calendar month. */
export function nextMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
