import "server-only";
import { isNotFoundError, isServiceError } from "@/lib/services/errors";
import { isPlanLimitError } from "@/lib/services/plan-limits";

/**
 * One mapping from service errors to what a Server Action returns to the UI
 * (`{ ok: false, error, upgradeUrl? }`). Plan limits, not-found and service
 * errors carry messages that are safe to show; anything else is logged and
 * replaced by a generic message.
 *
 * Never wrap `redirect()` in a try block that calls this: redirect works by
 * throwing, and this would swallow it.
 */
export function actionError(error: unknown, label: string): { ok: false; error: string; upgradeUrl?: string } {
  if (isPlanLimitError(error)) return { ok: false, error: error.message, upgradeUrl: error.upgradeUrl };
  if (isNotFoundError(error)) return { ok: false, error: `${notFoundSubject(error)} was not found. It may have been deleted.` };
  if (isServiceError(error)) return { ok: false, error: error.message };
  console.error(`[action] ${label} failed`, error instanceof Error ? (error.stack ?? error.message) : error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

function notFoundSubject(error: Error): string {
  const match = error.message.match(/^([A-Z][\w ]*?) not found/);
  return match ? match[1] : "That item";
}

export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** "2026-09-14" (from <input type="date">) as midnight UTC; null when empty or invalid. */
export function formDate(formData: FormData, key: string): Date | null {
  const value = formText(formData, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
