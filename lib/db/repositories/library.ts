import "server-only";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { LIBRARY_KINDS, libraryItems } from "../schema";
import type { LibraryItem, LibraryKind } from "../types";
import { isUuid, normalizeHttpUrl } from "./shared";

export type LibraryItemInput = {
  kind: LibraryKind;
  title: string;
  text: string;
  url?: string | null;
  /** null applies the item to every product line. */
  productLine?: string | null;
};

const MAX_TEXT = 50_000;

function clean(input: Partial<LibraryItemInput>): Partial<typeof libraryItems.$inferInsert> {
  const values: Partial<typeof libraryItems.$inferInsert> = {};
  if (input.kind !== undefined) {
    if (!(LIBRARY_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown library kind: ${input.kind}`);
    values.kind = input.kind;
  }
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Give the item a title.");
    values.title = title.slice(0, 200);
  }
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (!text) throw new Error("The item needs some text.");
    if (text.length > MAX_TEXT) throw new Error("The text is too long (50,000 characters at most).");
    values.text = text;
  }
  if (input.url !== undefined) values.url = normalizeHttpUrl(input.url, "Policy URL");
  if (input.productLine !== undefined) values.productLine = input.productLine?.trim().slice(0, 120) || null;
  return values;
}

export async function create(orgId: string, input: LibraryItemInput): Promise<LibraryItem> {
  const values = clean(input);
  const db = await getDb();
  const [row] = await db
    .insert(libraryItems)
    .values({ orgId, kind: values.kind!, title: values.title!, text: values.text!, url: values.url ?? null, productLine: values.productLine ?? null })
    .returning();
  return row;
}

export async function getById(orgId: string, itemId: string): Promise<LibraryItem | null> {
  if (!isUuid(itemId)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.id, itemId), eq(libraryItems.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function update(orgId: string, itemId: string, patch: Partial<LibraryItemInput>): Promise<LibraryItem | null> {
  if (!isUuid(itemId)) return null;
  const values = clean(patch);
  if (Object.keys(values).length === 0) return getById(orgId, itemId);
  const db = await getDb();
  const [row] = await db
    .update(libraryItems)
    .set(values)
    .where(and(eq(libraryItems.id, itemId), eq(libraryItems.orgId, orgId)))
    .returning();
  return row ?? null;
}

export async function remove(orgId: string, itemId: string): Promise<boolean> {
  if (!isUuid(itemId)) return false;
  const db = await getDb();
  const rows = await db
    .delete(libraryItems)
    .where(and(eq(libraryItems.id, itemId), eq(libraryItems.orgId, orgId)))
    .returning({ id: libraryItems.id });
  return rows.length > 0;
}

/** Every item, grouped by kind (Postgres sorts enums in LIBRARY_KINDS order), most recently updated first within a kind. */
export async function list(orgId: string, options: { productLine?: string | null } = {}): Promise<LibraryItem[]> {
  const where: SQL[] = [eq(libraryItems.orgId, orgId)];
  if (options.productLine) where.push(eq(libraryItems.productLine, options.productLine));
  const db = await getDb();
  return db
    .select()
    .from(libraryItems)
    .where(and(...where))
    .orderBy(asc(libraryItems.kind), desc(libraryItems.updatedAt), asc(libraryItems.id));
}

/** Items of one kind, most recently updated first (the assembler takes the first that fits). */
export async function listByKind(orgId: string, kind: LibraryKind): Promise<LibraryItem[]> {
  const db = await getDb();
  return db
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.orgId, orgId), eq(libraryItems.kind, kind)))
    .orderBy(desc(libraryItems.updatedAt), asc(libraryItems.id));
}

/** Deletes items that match these (kind, title, text) triples exactly, e.g. the demo library. Returns how many. */
export async function removeMatching(
  orgId: string,
  items: readonly { kind: LibraryKind; title: string; text: string }[],
): Promise<number> {
  if (items.length === 0) return 0;
  const db = await getDb();
  let removed = 0;
  for (const item of items) {
    const rows = await db
      .delete(libraryItems)
      .where(
        and(
          eq(libraryItems.orgId, orgId),
          eq(libraryItems.kind, item.kind),
          eq(libraryItems.title, item.title.trim()),
          eq(libraryItems.text, item.text.trim()),
        ),
      )
      .returning({ id: libraryItems.id });
    removed += rows.length;
  }
  return removed;
}
