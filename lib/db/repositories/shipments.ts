import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "../client";
import { shipments } from "../schema";
import type { Shipment } from "../types";
import { normalizeHttpUrl } from "./shared";

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
