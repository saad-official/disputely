import { isValidIsoDay } from "./format";

/**
 * Token finders shared by fact extraction (assemble.ts) and narrative
 * verification (guardrails.ts). Each returns spans so callers can mask what
 * they have consumed before running the next finder.
 */

export interface Span {
  text: string;
  start: number;
  end: number;
}

export interface DateSpan extends Span {
  /** ISO days ("2026-10-04") or, when the text has no year, "--10-04". Several for ambiguous 10/04/2026. */
  candidates: string[];
}

export interface MoneySpan extends Span {
  /** Amount in major units, e.g. 129 for "$129.00". */
  major: number;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Capitalised month names and abbreviations only, so "may" the verb is not a date. */
const MONTH = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpExecArray) => string[] }> = [
  {
    // 2026-10-04, 2026-10-04T12:00:00Z
    re: /\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    parse: (m) => [day(+m[1], +m[2], +m[3])],
  },
  {
    // Oct 4, 2026 / October 4th 2026 / Oct. 4
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "g"),
    parse: (m) => [day(m[3] ? +m[3] : null, monthOf(m[1]), +m[2])],
  },
  {
    // 4 October 2026 / 4th Oct, 2026 / 4 October
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+(\\d{4}))?\\b`, "g"),
    parse: (m) => [day(m[3] ? +m[3] : null, monthOf(m[2]), +m[1])],
  },
  {
    // 10/04/2026 (US month first; day-first accepted as an alternative)
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    parse: (m) => [day(+m[3], +m[1], +m[2]), day(+m[3], +m[2], +m[1])],
  },
];

function monthOf(name: string): number {
  return MONTH_INDEX[name.toLowerCase().slice(0, name.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function day(year: number | null, month: number, d: number): string {
  if (year === null) {
    if (month < 1 || month > 12 || d < 1 || d > 31) return "";
    return `--${pad(month)}-${pad(d)}`;
  }
  const iso = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(d)}`;
  return isValidIsoDay(iso) ? iso : "";
}

/** Sort, then drop spans overlapping an earlier (or longer) one. */
function dedupeSpans<T extends Span>(spans: T[]): T[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: T[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start < last.end) continue;
    out.push(span);
  }
  return out;
}

function collect<T extends Span>(text: string, re: RegExp, build: (m: RegExpExecArray) => T | null): T[] {
  const out: T[] = [];
  const pattern = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const span = build(m);
    if (span) out.push(span);
    if (m[0].length === 0) pattern.lastIndex++;
  }
  return out;
}

export function findDates(text: string): DateSpan[] {
  const spans: DateSpan[] = [];
  for (const { re, parse } of DATE_PATTERNS) {
    spans.push(
      ...collect(text, re, (m) => {
        const candidates = parse(m).filter(Boolean);
        return candidates.length > 0 ? { text: m[0], start: m.index, end: m.index + m[0].length, candidates } : null;
      }),
    );
  }
  return dedupeSpans(spans);
}

const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?";
const CODES = "USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY";
const MONEY_PATTERNS: RegExp[] = [
  // $1,234.56  US$129  €12  £9.99  CA$40
  new RegExp(`(?:US\\$|CA\\$|AU\\$|A\\$|NZ\\$|\\$|€|£|¥)\\s?${NUM}`, "g"),
  // 1234.56 USD, 40 dollars
  new RegExp(`\\b${NUM}\\s?(?:${CODES}|dollars?|euros?|pounds?)\\b`, "gi"),
  // USD 1234.56
  new RegExp(`\\b(?:${CODES})\\s?${NUM}`, "g"),
  // bare 129.00 (exactly two decimals; IPs and versions are masked or excluded)
  /(?<![\w.,$€£¥])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d.]|\.\d)(?!\w)/g,
];

function toMajor(whole: string, frac: string | undefined): number {
  const w = Number(whole.replace(/,/g, ""));
  const f = frac ? Number(frac.padEnd(2, "0")) / 100 : 0;
  return Math.round((w + f) * 100) / 100;
}

export function findMoney(text: string): MoneySpan[] {
  const spans: MoneySpan[] = [];
  for (const re of MONEY_PATTERNS) {
    spans.push(
      ...collect(text, re, (m) => {
        const groups = m.slice(1).filter((g) => g !== undefined);
        const whole = groups[0];
        if (!whole) return null;
        return { text: m[0], start: m.index, end: m.index + m[0].length, major: toMajor(whole, groups[1]) };
      }),
    );
  }
  return dedupeSpans(spans);
}

export function findEmails(text: string): Span[] {
  return collect(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

export function findUrls(text: string): Span[] {
  return collect(text, /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g, (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

export function findIps(text: string): Span[] {
  return collect(text, /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]\d)/g, (m) => {
    const ok = m[0].split(".").every((part) => Number(part) <= 255);
    return ok ? { text: m[0], start: m.index, end: m.index + m[0].length } : null;
  });
}

/** Stripe object ids: ch_, py_, pi_, dp_, du_, cus_, in_, cs_, re_, txn_. */
export function findStripeIds(text: string): Span[] {
  return collect(text, /\b(?:ch|py|pi|dp|du|cus|in|cs|re|txn)_[A-Za-z0-9]{6,}\b/g, (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/**
 * Tracking-like tokens: 8+ letters/digits with at least one digit and not part
 * of a larger identifier (1Z999AA10123456784, 9400111899223197428490).
 */
export function findTrackingLike(text: string): Span[] {
  return collect(text, /(?<![A-Za-z0-9_@\-/.])(?=[A-Za-z]*\d)[A-Za-z0-9]{8,}(?![A-Za-z0-9_@\-/]|\.[A-Za-z0-9])/g, (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** Words that open sentences or name things generically; never part of a person/product name candidate. */
const NAME_STOP_WORDS = new Set(
  [
    "a",
    "an",
    "the",
    "on",
    "in",
    "at",
    "by",
    "for",
    "from",
    "to",
    "of",
    "and",
    "or",
    "but",
    "this",
    "that",
    "these",
    "those",
    "our",
    "we",
    "us",
    "your",
    "you",
    "their",
    "they",
    "his",
    "her",
    "its",
    "it",
    "she",
    "he",
    "i",
    "as",
    "after",
    "before",
    "when",
    "then",
    "since",
    "if",
    "per",
    "with",
    "upon",
    "please",
    "both",
    "each",
    "all",
    "no",
    "yes",
    "dear",
    "mr",
    "mrs",
    "ms",
    "mx",
    "dr",
    "what",
    "why",
    "how",
    "who",
    "where",
    "there",
    "here",
    "however",
    "also",
    "additionally",
    "finally",
    "first",
    "second",
    "third",
    "next",
    "via",
    "using",
    "following",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
  ],
);

/** Title-cased common nouns; a candidate made only of these is not a name. */
const COMMON_TITLE_WORDS = new Set([
  "customer",
  "cardholder",
  "merchant",
  "store",
  "shop",
  "service",
  "services",
  "support",
  "team",
  "order",
  "orders",
  "confirmation",
  "refund",
  "refunds",
  "return",
  "returns",
  "policy",
  "policies",
  "shipping",
  "delivery",
  "delivered",
  "terms",
  "conditions",
  "proof",
  "tracking",
  "number",
  "card",
  "credit",
  "debit",
  "account",
  "payment",
  "receipt",
  "invoice",
  "subscription",
  "cancellation",
  "privacy",
  "notice",
  "help",
  "center",
  "centre",
  "page",
  "checkout",
  "agreement",
  "statement",
  "department",
  "evidence",
  "dispute",
  "bank",
  "issuer",
  "visa",
  "mastercard",
  "amex",
  "stripe",
  "express",
  "ground",
  "priority",
  "mail",
  "standard",
  "business",
  "days",
  "day",
  "address",
  "billing",
  "information",
  "email",
  "product",
  "products",
  "description",
  "communication",
  "access",
  "purchase",
  "purchased",
  "agreed",
  "invalid",
  "summary",
  "ip",
  "id",
  "usd",
  "eur",
  "gbp",
  "utc",
  "faq",
  "pdf",
]);

export interface NameSpan extends Span {
  /** The words that make it a name (stop/common words excluded). */
  significant: string[];
}

/**
 * Capitalised multi-word sequences ("Jordan Ellis", "Linen Throw Blanket").
 * Leading sentence words, months and weekdays split or trim candidates; a
 * candidate needs 2+ capitalised words and at least one that is not a common
 * title-cased noun ("Customer Service" is not a name).
 */
export function findNameCandidates(text: string): NameSpan[] {
  const out: NameSpan[] = [];
  const re = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]*(?:\s(?:\p{Lu}\.|\p{Lu}[\p{L}'’-]*))+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Split the run into sub-runs at stop words.
    const tokens: Array<{ word: string; start: number }> = [];
    const wordRe = /\S+/g;
    let w: RegExpExecArray | null;
    while ((w = wordRe.exec(m[0])) !== null) tokens.push({ word: w[0], start: m.index + w.index });
    let run: typeof tokens = [];
    const flush = () => {
      if (run.length >= 2) {
        const first = run[0];
        const last = run[run.length - 1];
        const words = run.map((t) => normaliseWord(t.word));
        const significant = words.filter((x) => x && !COMMON_TITLE_WORDS.has(x));
        if (significant.length > 0) {
          out.push({
            text: text.slice(first.start, last.start + last.word.length),
            start: first.start,
            end: last.start + last.word.length,
            significant,
          });
        }
      }
      run = [];
    };
    for (const token of tokens) {
      if (NAME_STOP_WORDS.has(normaliseWord(token.word))) flush();
      else run.push(token);
    }
    flush();
  }
  return out;
}

/** Lower-case, strip possessive and surrounding punctuation. */
export function normaliseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/['’]s$/u, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Replace spans with spaces so later finders do not see them; indices are preserved. */
export function mask(text: string, spans: Span[]): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + " ".repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

/** Upper-case alphanumerics only, for comparing tracking numbers and ids. */
export function normaliseToken(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
