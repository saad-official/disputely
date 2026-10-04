import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { shipments } from "../schema";
import type { Shipment } from "../types";
import { clampLimit, isUuid, normalizeHttpUrl } from "./shared";

export type ShipmentInput = {
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  proofUrl?: string | null;
  addressMatch?: boolean | null;
};

/**
 * Creates or replaces the shipment record for a charge (one per charge).
 * Fields left undefined keep their stored value on update.
 */
export async function upsertByCharge(orgId: string, chargeId: string, input: ShipmentInput): Promise<Shipment> {
  const charge = chargeId.trim();
  if (!charge) throw new Error("A shipment needs the Stripe charge id it fulfils.");
  if (input.shippedAt && input.deliveredAt && input.deliveredAt < input.shippedAt) {
    throw new Error("Delivery date cannot be before the ship date.");
  }
  const values: Partial<typeof shipments.$inferInsert> = {};
  if (input.carrier !== undefined) values.carrier = input.carrier?.trim() || null;
  if (input.trackingNumber !== undefined) values.trackingNumber = input.trackingNumber?.replace(/\s+/g, "") || null;
  if (input.shippedAt !== undefined) values.shippedAt = input.shippedAt;
  if (input.deliveredAt !== undefined) values.deliveredAt = input.deliveredAt;
  if (input.proofUrl !== undefined) values.proofUrl = normalizeHttpUrl(input.proofUrl, "Proof of delivery URL");
  if (input.addressMatch !== undefined) values.addressMatch = input.addressMatch;

  const db = await getDb();
  const insert = db.insert(shipments).values({ orgId, chargeId: charge, ...values });
  const [row] =
    Object.keys(values).length > 0
      ? await insert
          .onConflictDoUpdate({ target: [shipments.orgId, shipments.chargeId], set: { ...values, updatedAt: new Date() } })
          .returning()
      : await insert.onConflictDoNothing().returning();
  if (row) return row;
  const existing = await findByCharge(orgId, charge);
  if (!existing) throw new Error("Shipment upsert failed.");
  return existing;
}

export async function findByCharge(orgId: string, chargeId: string): Promise<Shipment | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.orgId, orgId), eq(shipments.chargeId, chargeId.trim())))
    .limit(1);
  return row ?? null;
}

/** Most recently updated first. */
export async function listRecent(orgId: string, limit = 50): Promise<Shipment[]> {
  const db = await getDb();
  return db
    .select()
    .from(shipments)
    .where(eq(shipments.orgId, orgId))
    .orderBy(desc(shipments.updatedAt), desc(shipments.id))
    .limit(clampLimit(limit, 50, 200));
}

export async function remove(orgId: string, shipmentId: string): Promise<boolean> {
  if (!isUuid(shipmentId)) return false;
  const db = await getDb();
  const rows = await db
    .delete(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.orgId, orgId)))
    .returning({ id: shipments.id });
  return rows.length > 0;
}

/** Deletes the org's shipment records for these charges (demo cleanup). */
export async function removeForCharges(orgId: string, chargeIds: readonly string[]): Promise<number> {
  const ids = [...new Set(chargeIds.map((c) => c.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const db = await getDb();
  const rows = await db
    .delete(shipments)
    .where(and(eq(shipments.orgId, orgId), inArray(shipments.chargeId, ids)))
    .returning({ id: shipments.id });
  return rows.length;
}
