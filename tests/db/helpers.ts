/**
 * Shared PGlite setup for database tests. Each test file calls `vi.mock("server-only")`
 * itself (vi.mock is hoisted per file), then `startTestDb()` in beforeAll.
 */
import type { SQL } from "drizzle-orm";
import { createPgliteDb, setDbHandle, type DbHandle } from "@/lib/db/client";
import type { NormalizedDispute } from "@/lib/db/repositories/disputes";
import { organizations } from "@/lib/db/schema";
import type { Organization } from "@/lib/db/types";

/** Fresh in-memory PGlite with every migration in drizzle/ applied, wired into getDb(). */
export async function startTestDb(): Promise<DbHandle> {
  const handle = await createPgliteDb(undefined);
  setDbHandle(handle);
  return handle;
}

export async function stopTestDb(handle: DbHandle | undefined): Promise<void> {
  setDbHandle(null);
  await handle?.close();
}

let orgCounter = 0;

export async function insertOrg(
  handle: DbHandle,
  values: Partial<typeof organizations.$inferInsert> = {},
): Promise<Organization> {
  orgCounter += 1;
  const slug = `test-co-${orgCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await handle.db
    .insert(organizations)
    .values({ name: "Test Co", slug, ...values })
    .returning();
  return org;
}

let disputeCounter = 0;

/** A plausible normalised Stripe dispute; override anything. */
export function stripeDispute(overrides: Partial<NormalizedDispute> = {}): NormalizedDispute {
  disputeCounter += 1;
  return {
    stripeDisputeId: `dp_test_${disputeCounter}_${Math.random().toString(36).slice(2, 8)}`,
    chargeId: `ch_test_${disputeCounter}`,
    paymentIntentId: `pi_test_${disputeCounter}`,
    amountCents: 12_900,
    currency: "usd",
    reason: "fraudulent",
    status: "needs_response",
    dueBy: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    openedAt: new Date(),
    customer: { name: "Jamie Rivera", email: "jamie@example.com" },
    charge: { description: "Linen throw, oat", card: { brand: "visa", last4: "0259" } },
    shipping: null,
    evidenceDetails: { hasEvidence: false, pastDue: false, submissionCount: 0 },
    isChargeRefundable: true,
    livemode: false,
    ...overrides,
  };
}

/** Raw SQL through the PGlite client (the driver-agnostic Db type leaves execute() results untyped). */
export async function queryRows<T>(handle: DbHandle, query: SQL): Promise<T[]> {
  const result = (await handle.db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/** The Postgres error message behind a rejected query (Drizzle wraps it in `cause`). */
export async function dbErrorMessage(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }
  throw new Error("expected the query to be rejected");
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal valid file bytes per type (signatures only; enough for the sniffing check). */
export const PDF_BYTES = Buffer.from("%PDF-1.4\n%test\n", "latin1");
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
