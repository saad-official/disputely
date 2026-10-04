import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` diffs lib/db/schema.ts against drizzle/ and writes a new
 * migration; it never touches a database. `pnpm db:studio` opens Drizzle
 * Studio against DATABASE_URL, or against the embedded PGlite database in
 * .pglite/ when DATABASE_URL is unset (run `pnpm db:migrate` first).
 *
 * Migrations are applied by scripts/migrate.ts, not drizzle-kit, so the same
 * code path works for postgres.js and PGlite.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: fine, use the process environment
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["disputely"],
  migrations: { schema: "disputely", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite" as const, dbCredentials: { url: "./.pglite" } }),
});
