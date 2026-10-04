import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres for local development (lib/db/client.ts) loads its WASM
  // and data files from its own package directory at runtime; bundling breaks
  // those paths, so Node loads it from node_modules instead.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
