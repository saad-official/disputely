import "server-only";
import { getOrgContext, type OrgContext } from "@/lib/auth/session";
import { isNotFoundError, isServiceError } from "@/lib/services/errors";
import { isPlanLimitError } from "@/lib/services/plan-limits";

/**
 * Shared helpers for the app's JSON API routes: session/org authorisation
 * (401 JSON instead of the page redirect `requireOrgContext` does) and one
 * mapping from service errors to HTTP statuses.
 */

export async function orgContextOr401(): Promise<OrgContext | Response> {
  const ctx = await getOrgContext();
  return ctx ?? Response.json({ error: "Sign in to continue.", code: "unauthorized" }, { status: 401 });
}

export function errorResponse(error: unknown, label: string): Response {
  if (isPlanLimitError(error)) {
    return Response.json(
      { error: error.message, code: error.code, limit: error.limit, used: error.used, upgradeUrl: error.upgradeUrl },
      { status: 402 },
    );
  }
  if (isNotFoundError(error)) return Response.json({ error: error.message, code: "not_found" }, { status: 404 });
  if (isServiceError(error)) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof Error && error.name === "AiUnavailableError") {
    return Response.json({ error: error.message, code: "ai_unavailable" }, { status: 503 });
  }
  console.error(`[api] ${label} failed`, error instanceof Error ? (error.stack ?? error.message) : error);
  return Response.json({ error: "Something went wrong. Please try again.", code: "internal" }, { status: 500 });
}

/** Content-Disposition for a download, with an ASCII fallback and the UTF-8 name. */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
