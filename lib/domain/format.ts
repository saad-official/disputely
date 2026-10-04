import type { PostalAddress } from "./types";

/** ISO 4217 currencies with no minor unit (Stripe "zero-decimal" currencies). */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export function minorUnitDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 0 : 2;
}

/** "$129.00", "€12.00", "CA$1,234.56". Deterministic (en-US). */
export function formatMoney(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** "129.00" (no symbol, no grouping). */
export function formatPlainAmount(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Calendar day (UTC) of an ISO date or datetime; null when unparseable. */
export function isoDay(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidIsoDay(trimmed) ? trimmed : null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      const m = ISO_DAY.exec(trimmed);
      return m && isValidIsoDay(m[0]) ? m[0] : null;
    }
    return parsed.toISOString().slice(0, 10);
  }
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
}

export function isValidIsoDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "October 4, 2026" from "2026-10-04". */
export function formatLongDate(iso: string): string {
  const day = isoDay(iso);
  if (!day) return iso;
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

/** "2026-10-04 14:05 UTC" for transcripts. */
export function formatUtcStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/** One-line postal address: "12 Fern Lane, Apt 3, Portland, OR 97201, US". */
export function formatAddress(address: PostalAddress | null | undefined): string | null {
  if (!address) return null;
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(" ")]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [address.line1, address.line2, cityLine, address.country]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Trim and treat empty strings as absent. */
export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

/** Truncate to `max` chars, appending a marker; never exceeds `max`. */
export function truncate(text: string, max: number, marker = " [truncated]"): string {
  if (text.length <= max) return text;
  if (max <= marker.length) return text.slice(0, max);
  return text.slice(0, max - marker.length).trimEnd() + marker;
}
