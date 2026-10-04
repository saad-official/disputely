/**
 * Applies drizzle/ migrations.
 *
 *   pnpm db:migrate
 *
 * DATABASE_URL set   -> postgres.js against that database (use the direct,
 *                       non-pooled connection string for migrations).
 * DATABASE_URL unset -> embedded PGlite in .pglite/ (local development).
 *
 * Self-contained on purpose (no app imports): runs under plain Node 24 with
 * built-in TypeScript type stripping.
 */
import path from "node:path";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const migrationsConfig = { migrationsFolder, migrationsSchema: "disputely", migrationsTable: "__drizzle_migrations" };

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await migrate(drizzle({ client }), migrationsConfig);
    } finally {
      await client.end({ timeout: 5 });
    }
    console.log(`Migrations applied to ${new URL(url).host}.`);
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set; refusing to migrate an embedded database in production.");
  }
  const dataDir = path.join(process.cwd(), ".pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite({ dataDir, extensions: { vector } });
  try {
    await migrate(drizzle({ client }), migrationsConfig);
  } finally {
    await client.close();
  }
  console.log(`Migrations applied to embedded PGlite at ${dataDir}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
