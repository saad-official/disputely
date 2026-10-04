import "server-only";
import { and, eq, getTableColumns, ne, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "../client";
import { disputes, packets } from "../schema";
import type { Json, NarrativeMeta, PacketFields, PacketRecord, PacketStatus } from "../types";
import { assertDisputeInOrg, assertPacketInOrg, columnsWithout, isUuid, NotFoundError } from "./shared";

/** A submitted packet is frozen: its content, status and PDF can no longer change. */
export class PacketSubmittedError extends Error {
  constructor() {
    super("This packet has already been submitted to Stripe and can no longer be changed.");
    this.name = "PacketSubmittedError";
  }
}

/** Every column but the PDF bytes, plus whether a PDF exists. */
const RECORD = { ...columnsWithout(getTableColumns(packets), "pdf"), hasPdf: sql<boolean>`(${packets.pdf} is not null)` };

export async function getById(orgId: string, packetId: string): Promise<PacketRecord | null> {
  if (!isUuid(packetId)) return null;
  const db = await getDb();
  const [row] = await db
    .select(RECORD)
    .from(packets)
    .where(and(eq(packets.id, packetId), eq(packets.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function getByDispute(orgId: string, disputeId: string): Promise<PacketRecord | null> {
  if (!isUuid(disputeId)) return null;
  const db = await getDb();
  const [row] = await db
    .select(RECORD)
    .from(packets)
    .where(and(eq(packets.disputeId, disputeId), eq(packets.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * The dispute's packet, created on first call (one per dispute, enforced by
 * a unique index, so concurrent calls converge on the same row). `playbook`
 * defaults to the dispute's reason.
 */
export async function getOrCreateForDispute(
  orgId: string,
  disputeId: string,
  options: { playbook?: string } = {},
): Promise<{ packet: PacketRecord; created: boolean }> {
  const db = await getDb();
  await assertDisputeInOrg(db, orgId, disputeId);
  const existing = await getByDispute(orgId, disputeId);
  if (existing) return { packet: existing, created: false };

  let playbook = options.playbook;
  if (!playbook) {
    const [dispute] = await db.select({ reason: disputes.reason }).from(disputes).where(eq(disputes.id, disputeId));
    playbook = dispute.reason;
  }
  const [inserted] = await db
    .insert(packets)
    .values({ orgId, disputeId, playbook })
    .onConflictDoNothing({ target: packets.disputeId })
    .returning(RECORD);
  if (inserted) return { packet: inserted, created: true };
  const raced = await getByDispute(orgId, disputeId);
  if (!raced) throw new NotFoundError("Packet");
  return { packet: raced, created: false };
}

export type PacketContentPatch = {
  playbook?: string;
  fields?: PacketFields;
  narrative?: string;
  narrativeMeta?: NarrativeMeta | null;
  /** 0..100; rounded and clamped. */
  completeness?: number;
  missing?: string[];
};

async function writeUnlessSubmitted(
  orgId: string,
  packetId: string,
  values: PgUpdateSetSource<typeof packets>,
): Promise<PacketRecord> {
  const db = await getDb();
  const [row] = await db
    .update(packets)
    .set(values)
    .where(and(eq(packets.id, packetId), eq(packets.orgId, orgId), ne(packets.status, "submitted")))
    .returning(RECORD);
  if (row) return row;
  await assertPacketInOrg(db, orgId, packetId); // NotFoundError when missing / other org
  throw new PacketSubmittedError();
}

/**
 * Updates assembled content. Any content change clears the stored PDF (it
 * would be stale). Throws PacketSubmittedError once submitted.
 */
export async function update(orgId: string, packetId: string, patch: PacketContentPatch): Promise<PacketRecord> {
  const values: PgUpdateSetSource<typeof packets> = {};
  if (patch.playbook !== undefined) values.playbook = patch.playbook;
  if (patch.fields !== undefined) values.fields = patch.fields;
  if (patch.narrative !== undefined) values.narrative = patch.narrative;
  if (patch.narrativeMeta !== undefined) values.narrativeMeta = patch.narrativeMeta;
  if (patch.completeness !== undefined) {
    if (!Number.isFinite(patch.completeness)) throw new Error("Completeness must be a number between 0 and 100.");
    values.completeness = Math.min(100, Math.max(0, Math.round(patch.completeness)));
  }
  if (patch.missing !== undefined) values.missing = [...patch.missing];
  if (Object.keys(values).length > 0) {
    values.pdf = null;
    values.pdfGeneratedAt = null;
  }
  return writeUnlessSubmitted(orgId, packetId, values);
}

/** draft <-> ready. "submitted" is only reachable through recordSubmission. */
export async function setStatus(
  orgId: string,
  packetId: string,
  status: Exclude<PacketStatus, "submitted">,
): Promise<PacketRecord> {
  if ((status as PacketStatus) === "submitted") throw new Error("Use recordSubmission to submit a packet.");
  return writeUnlessSubmitted(orgId, packetId, { status });
}

/**
 * Marks the packet submitted and freezes the evidence payload sent to Stripe
 * and Stripe's response. Throws PacketSubmittedError if it already was.
 */
export async function recordSubmission(
  orgId: string,
  packetId: string,
  snapshot: Json,
  stripeResponse: Json,
  submittedAt: Date = new Date(),
): Promise<PacketRecord> {
  return writeUnlessSubmitted(orgId, packetId, {
    status: "submitted",
    submittedAt,
    submittedSnapshot: snapshot,
    stripeResponse,
  });
}

/** Stores the rendered PDF packet. Allowed after submission only while none is stored (the archived copy). */
export async function setPdf(orgId: string, packetId: string, pdf: Buffer | Uint8Array): Promise<PacketRecord> {
  if (pdf.byteLength === 0) throw new Error("The PDF is empty.");
  const bytes = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const db = await getDb();
  const [row] = await db
    .update(packets)
    .set({ pdf: bytes, pdfGeneratedAt: new Date() })
    .where(
      and(
        eq(packets.id, packetId),
        eq(packets.orgId, orgId),
        sql`(${packets.status} <> 'submitted' or ${packets.pdf} is null)`,
      ),
    )
    .returning(RECORD);
  if (row) return row;
  await assertPacketInOrg(db, orgId, packetId);
  throw new PacketSubmittedError();
}

/** The stored PDF bytes, or null when none has been rendered (or the packet is not the org's). */
export async function getPdf(orgId: string, packetId: string): Promise<Buffer | null> {
  if (!isUuid(packetId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ pdf: packets.pdf })
    .from(packets)
    .where(and(eq(packets.id, packetId), eq(packets.orgId, orgId)))
    .limit(1);
  return row?.pdf ?? null;
}
