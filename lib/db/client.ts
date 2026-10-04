import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Lazy database factory. Importing this module never connects; the first
 * `getDb()` call creates the client and the first query opens a connection.
 *
 * - `DATABASE_URL` set: postgres.js, pooled, `prepare: false` (works behind
 *   PgBouncer-style poolers such as Neon's pooled endpoint).
 * - `DATABASE_URL` unset and NODE_ENV !== "production": embedded PGlite
 *   persisted to `.pglite/`, migrated on first use, so `pnpm dev` works
 *   with zero setup.
 * - `DATABASE_URL` unset in production: throws on first use.
 */

export type Schema = typeof schema;
/** Driver-agnostic Drizzle database (postgres.js and PGlite both satisfy it). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export type DbHandle = {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
};

export const PGLITE_DIR = ".pglite";
export const MIGRATIONS_FOLDER = "drizzle";
/** Drizzle's migration journal lives next to the app tables. */
export const MIGRATIONS_CONFIG = { migrationsSchema: "disputely", migrationsTable: "__drizzle_migrations" } as const;

export function migrationsFolder(): string {
  return path.join(process.cwd(), MIGRATIONS_FOLDER);
}

export async function createPostgresDb(url: string): Promise<DbHandle> {
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle({ client, schema });
  return { db: db as unknown as Db, driver: "postgres", close: () => client.end({ timeout: 5 }) };
}

/**
 * PGlite in-process Postgres (no extensions needed). `dataDir` undefined
 * means in-memory (tests). Applies pending migrations unless
 * `migrate: false`.
 */
export async function createPgliteDb(
  dataDir: string | undefined,
  options: { migrate?: boolean } = {},
): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  // Options-object form: `new PGlite(undefined, opts)` silently ignores opts.
  const client = new PGlite({ dataDir });
  const db = drizzle({ client, schema });
  if (options.migrate !== false) {
    await migrate(db, { migrationsFolder: migrationsFolder(), ...MIGRATIONS_CONFIG });
  }
  return { db: db as unknown as Db, driver: "pglite", close: () => client.close() };
}

export function createDbFromEnv(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) return createPostgresDb(url);
  if (process.env.NODE_ENV === "production") {
    return Promise.reject(
      new Error("DATABASE_URL is not set. Production needs a Postgres connection string (see .env.example)."),
    );
  }
  return createPgliteDb(path.join(process.cwd(), PGLITE_DIR));
}

// Survives dev hot reloads: one PGlite instance per data directory, one pool.
const globalForDb = globalThis as unknown as { __disputelyDb?: Promise<DbHandle> };

export function getDbHandle(): Promise<DbHandle> {
  if (!globalForDb.__disputelyDb) {
    globalForDb.__disputelyDb = createDbFromEnv().catch((error: unknown) => {
      globalForDb.__disputelyDb = undefined;
      throw error;
    });
  }
  return globalForDb.__disputelyDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** Tests: route every `getDb()` (repositories, Better Auth) to the given handle. */
export function setDbHandle(handle: DbHandle | null): void {
  globalForDb.__disputelyDb = handle ? Promise.resolve(handle) : undefined;
}

export async function closeDb(): Promise<void> {
  const pending = globalForDb.__disputelyDb;
  globalForDb.__disputelyDb = undefined;
  if (pending) await (await pending).close();
}
