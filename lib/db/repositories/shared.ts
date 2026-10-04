import "server-only";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../client";
import { EMBEDDING_DIMENSIONS, documents, questionnaires } from "../schema";

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

/** Throws unless the questionnaire exists and belongs to the organization. */
export async function assertQuestionnaireInOrg(db: Db, orgId: string, questionnaireId: string): Promise<void> {
  const [row] = await db
    .select({ id: questionnaires.id })
    .from(questionnaires)
    .where(and(eq(questionnaires.id, questionnaireId), eq(questionnaires.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Questionnaire");
}

/** Throws unless the document exists and belongs to the organization. */
export async function assertDocumentInOrg(db: Db, orgId: string, documentId: string): Promise<void> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Document");
}

/**
 * Validates an embedding (768 finite numbers) and returns its pgvector text
 * literal, e.g. "[0.1,0.2,...]". Throws on a wrong dimension so a model
 * misconfiguration fails loudly instead of corrupting the index.
 */
export function toVectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding has ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
  }
  for (const value of embedding) {
    if (!Number.isFinite(value)) throw new Error("Embedding contains a non-finite value.");
  }
  return `[${embedding.join(",")}]`;
}

/** Validates an embedding (see toVectorLiteral) and returns it unchanged, for Drizzle `vector` columns. */
export function checkedEmbedding(embedding: number[]): number[] {
  toVectorLiteral(embedding);
  return embedding;
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

export function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}
