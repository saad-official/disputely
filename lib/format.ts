import { formatMoney } from "@/lib/domain/format";
import type { Money } from "@/lib/db/types";

/**
 * Display helpers shared by server pages and client islands. Deterministic
 * (en-US / en-GB with an explicit zone) so server and client render alike.
 */

export { formatMoney };

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** "14 Sep 2026". */
export function formatDate(value: Date | string | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: validZone(timeZone) }).format(date);
}

/** "14 Sep 2026, 10:22 BST". */
export function formatDateTime(value: Date | string | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: validZone(timeZone),
    timeZoneName: "short",
  }).format(date);
}

/** "3 min ago", "2 h ago", "5 d ago" relative to `now`. */
export function formatAgo(value: Date | string, now: Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "$184.00 · €40.00" for amounts in several currencies; "—" when none. */
export function formatMoneyList(amounts: readonly Money[]): string {
  if (amounts.length === 0) return "—";
  return amounts.map((m) => formatMoney(m.amountCents, m.currency)).join(" · ");
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}
