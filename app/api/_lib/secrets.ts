import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { optionalEnv } from "@/lib/env";

/**
 * Shared-secret checks for machine-to-machine routes. Both sides are hashed
 * first so the comparison is constant-time regardless of length. A missing
 * CRON_SECRET rejects everything rather than accepting an empty secret.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer <CRON_SECRET>` (what pg_cron and Vercel Cron send). */
export function isAuthorizedCron(request: Request): boolean {
  const expected = optionalEnv("CRON_SECRET");
  if (!expected) console.error("[cron] CRON_SECRET is not set; rejecting request");
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return secretsMatch(match?.[1], expected);
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
