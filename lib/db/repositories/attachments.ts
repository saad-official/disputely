import "server-only";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "../client";
import { ATTACHMENT_MIME_TYPES, attachments, MAX_ATTACHMENT_BYTES } from "../schema";
import type { Attachment, AttachmentMeta, AttachmentMimeType } from "../types";
import { assertPacketInOrg, columnsWithout, isUuid } from "./shared";
import { PacketSubmittedError } from "./packets";

export { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES };

export type AttachmentRejection = "empty" | "too_large" | "unsupported_type";

/** The file cannot be stored as dispute evidence. `message` is safe to show. */
export class AttachmentRejectedError extends Error {
  readonly code: AttachmentRejection;
  constructor(code: AttachmentRejection, message: string) {
    super(message);
    this.name = "AttachmentRejectedError";
    this.code = code;
  }
}

const SIGNATURES: Record<AttachmentMimeType, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  "image/png": (b) => b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

function normalizeMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base === "image/jpg" || base === "image/pjpeg" ? "image/jpeg" : base;
}

/**
 * Validates a file for Stripe dispute evidence: PDF, PNG or JPEG, at most
 * 5 MB, and the bytes must start with that format's signature (a renamed
 * file is rejected here rather than by Stripe at submit time).
 */
export function validateAttachment(input: { fileName: string; mimeType: string; bytes: Uint8Array }): AttachmentMimeType {
  if (input.bytes.byteLength === 0) throw new AttachmentRejectedError("empty", `${input.fileName} is empty.`);
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRejectedError("too_large", `${input.fileName} is larger than 5 MB, Stripe's limit per evidence file.`);
  }
  const mime = normalizeMime(input.mimeType);
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new AttachmentRejectedError("unsupported_type", `${input.fileName}: upload a PDF, PNG or JPEG.`);
  }
  const typed = mime as AttachmentMimeType;
  if (!SIGNATURES[typed](input.bytes)) {
    throw new AttachmentRejectedError("unsupported_type", `${input.fileName} is not a valid ${typed.split("/")[1].toUpperCase()} file.`);
  }
  return typed;
}

export type AddAttachmentInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Stripe evidence file field it supports; defaults to "uncategorized_file". */
  field?: string;
};

/** Every column but the file bytes. */
const metaColumns = columnsWithout(getTableColumns(attachments), "bytes");

/** Adds a file to a packet that has not been submitted. Throws AttachmentRejectedError, NotFoundError or PacketSubmittedError. */
export async function add(orgId: string, packetId: string, input: AddAttachmentInput): Promise<AttachmentMeta> {
  const mimeType = validateAttachment(input);
  const fileName = input.fileName.trim().replace(/[\\/]/g, "_").slice(0, 200) || "evidence";
  const db = await getDb();
  const packet = await assertPacketInOrg(db, orgId, packetId);
  if (packet.status === "submitted") throw new PacketSubmittedError();
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const [row] = await db
    .insert(attachments)
    .values({
      orgId,
      packetId,
      fileName,
      mimeType,
      sizeBytes: bytes.byteLength,
      bytes,
      field: input.field?.trim() || "uncategorized_file",
    })
    .returning(metaColumns);
  return row;
}

/** A packet's attachments without their bytes, oldest first. */
export async function list(orgId: string, packetId: string): Promise<AttachmentMeta[]> {
  if (!isUuid(packetId)) return [];
  const db = await getDb();
  return db
    .select(metaColumns)
    .from(attachments)
    .where(and(eq(attachments.packetId, packetId), eq(attachments.orgId, orgId)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
}

/** One attachment including its bytes (download, Stripe upload). */
export async function getWithBytes(orgId: string, attachmentId: string): Promise<Attachment | null> {
  if (!isUuid(attachmentId)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Deletes an attachment; true when one was removed. */
export async function remove(orgId: string, attachmentId: string): Promise<boolean> {
  if (!isUuid(attachmentId)) return false;
  const db = await getDb();
  const rows = await db
    .delete(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, orgId)))
    .returning({ id: attachments.id });
  return rows.length > 0;
}

/** Records the Stripe File id after upload (purpose dispute_evidence). */
export async function setStripeFileId(
  orgId: string,
  attachmentId: string,
  stripeFileId: string,
): Promise<AttachmentMeta | null> {
  if (!isUuid(attachmentId)) return null;
  const db = await getDb();
  const [row] = await db
    .update(attachments)
    .set({ stripeFileId })
    .where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, orgId)))
    .returning(metaColumns);
  return row ?? null;
}
