import "server-only";
import { and, asc, eq, isNotNull, max, sql } from "drizzle-orm";
import { getDb } from "../client";
import { disputes, memberships, organizations, user } from "../schema";
import type { Organization, Plan } from "../types";
import { isUuid, isValidTimeZone, normalizeEmail } from "./shared";

export async function getById(orgId: string): Promise<Organization | null> {
  if (!isUuid(orgId)) return null;
  const db = await getDb();
  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return row ?? null;
}

export type OrganizationSettings = {
  name?: string;
  /** IANA time zone, e.g. "Europe/London". */
  timezone?: string;
  remindersEnabled?: boolean;
  /** null or "" resets to the owner's sign-in email. */
  reminderEmail?: string | null;
};

/**
 * Validates and applies a partial settings update. Throws a plain Error with
 * a user-facing message on invalid input.
 */
export async function updateSettings(orgId: string, patch: OrganizationSettings): Promise<Organization | null> {
  const values: Partial<typeof organizations.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Organization name cannot be empty.");
    values.name = name.slice(0, 120);
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(patch.timezone)) throw new Error(`Unknown time zone: ${patch.timezone}`);
    values.timezone = patch.timezone;
  }
  if (patch.remindersEnabled !== undefined) values.remindersEnabled = patch.remindersEnabled;
  if (patch.reminderEmail !== undefined) {
    const email = patch.reminderEmail ? normalizeEmail(patch.reminderEmail) : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid reminder email address.");
    values.reminderEmail = email || null;
  }
  if (Object.keys(values).length === 0) return getById(orgId);
  const db = await getDb();
  const [row] = await db.update(organizations).set(values).where(eq(organizations.id, orgId)).returning();
  return row ?? null;
}

/**
 * Stores the merchant's Stripe restricted key. `ciphertext` must come from
 * `encryptSecret(orgId, key)` (lib/crypto/secretbox.ts); this layer never
 * sees the plaintext. `label` is what Settings shows (account name or masked key).
 */
export async function setStripeKey(orgId: string, ciphertext: string, label: string): Promise<Organization | null> {
  if (!ciphertext.startsWith("v1.")) throw new Error("Refusing to store a Stripe key that is not encrypted.");
  const db = await getDb();
  const [row] = await db
    .update(organizations)
    .set({
      stripeRestrictedKeyCiphertext: ciphertext,
      stripeAccountLabel: label.trim().slice(0, 200) || null,
      stripeKeyConnectedAt: new Date(),
    })
    .where(eq(organizations.id, orgId))
    .returning();
  return row ?? null;
}

export async function clearStripeKey(orgId: string): Promise<Organization | null> {
  const db = await getDb();
  const [row] = await db
    .update(organizations)
    .set({ stripeRestrictedKeyCiphertext: null, stripeAccountLabel: null, stripeKeyConnectedAt: null })
    .where(eq(organizations.id, orgId))
    .returning();
  return row ?? null;
}

export type PlanChange = {
  plan: Plan;
  /** Pass null to clear; omit to leave unchanged. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: Date | null;
};

export async function setPlan(orgId: string, change: PlanChange): Promise<Organization | null> {
  const values: Partial<Organization> = { plan: change.plan };
  if (change.stripeCustomerId !== undefined) values.stripeCustomerId = change.stripeCustomerId;
  if (change.stripeSubscriptionId !== undefined) values.stripeSubscriptionId = change.stripeSubscriptionId;
  if (change.subscriptionStatus !== undefined) values.subscriptionStatus = change.subscriptionStatus;
  if (change.currentPeriodEnd !== undefined) values.currentPeriodEnd = change.currentPeriodEnd;
  const db = await getDb();
  const [row] = await db.update(organizations).set(values).where(eq(organizations.id, orgId)).returning();
  return row ?? null;
}

/** Sign-in email of the organization's first owner; reminders go here unless `reminder_email` is set. */
export async function getOwnerEmail(orgId: string): Promise<string | null> {
  if (!isUuid(orgId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row?.email ?? null;
}

/**
 * Cron only (not org-scoped): organizations with a connected Stripe key,
 * least recently synced first (never synced first), capped per run.
 */
export async function listConnectedForSync(limit = 20): Promise<string[]> {
  const db = await getDb();
  const lastSynced = max(disputes.syncedAt);
  const rows = await db
    .select({ id: organizations.id, lastSynced })
    .from(organizations)
    .leftJoin(disputes, eq(disputes.orgId, organizations.id))
    .where(isNotNull(organizations.stripeRestrictedKeyCiphertext))
    .groupBy(organizations.id)
    .orderBy(sql`${lastSynced} asc nulls first`, asc(organizations.id))
    .limit(Math.max(1, Math.min(100, Math.floor(limit))));
  return rows.map((r) => r.id);
}
