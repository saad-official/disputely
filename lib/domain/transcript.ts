/**
 * Best-effort parser for a pasted customer conversation (Records > Message
 * logs). Pure and dependency-free so the paste preview can run it in the
 * browser and the server can run it again before saving.
 *
 * Recognised line shapes (one message per line; following lines without a
 * timestamp or speaker continue the previous message):
 *   2026-09-14 10:22 Customer: Where is my order?
 *   [2026-09-14 10:25] Me: It shipped yesterday.
 *   2026/09/14 3:05 pm - Support: ...
 *   2026-09-14T10:22:05Z Jordan Ellis: ...
 *   Customer: ...            (no timestamp: reuses the previous one + 1 minute)
 * Timestamps without an explicit zone are read in `timeZone` (default UTC).
 */

export type TranscriptDirection = "inbound" | "outbound";

export interface ParsedMessage {
  /** ISO datetime (UTC). */
  occurredAt: string;
  direction: TranscriptDirection;
  speaker: string;
  body: string;
}

export interface ParseTranscriptOptions {
  /** IANA zone for timestamps without one. */
  timeZone?: string;
  /** The customer's name; a speaker matching it (or its first name) is inbound. */
  customerName?: string | null;
  /** The store's name; a speaker matching it is outbound. */
  merchantName?: string | null;
}

export interface ParseTranscriptResult {
  messages: ParsedMessage[];
  /** Lines that could not be attached to any message (e.g. text before the first timestamp). */
  skipped: string[];
}

export const MAX_TRANSCRIPT_CHARS = 200_000;

const LINE =
  /^\s*\[?\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?\s*\]?\s*(?:[-–—|·]\s*)?([^:\n]{1,48}?)\s*:\s?(.*)$/i;
const SPEAKER_ONLY = /^\s*([A-Za-z][^:\n]{0,40}?)\s*:\s?(.+)$/;

const INBOUND = /^(customer|client|buyer|cardholder|shopper|them|they|guest|user)\b/i;
const OUTBOUND = /^(me|we|us|i|support|store|shop|merchant|agent|staff|team|admin|seller|owner|reply)\b/i;
const OUTBOUND_ANYWHERE = /\b(support|team|store|shop|agent|staff|admin|helpdesk|customer service|customer care)\b/i;

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

/** Wall-clock time in `timeZone` to a UTC instant (two passes cover DST edges). */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  if (zone === "UTC") return new Date(naive);
  let guess = naive - tzOffsetMs(naive, zone);
  guess = naive - tzOffsetMs(guess, zone);
  return new Date(guess);
}

function validDate(y: number, mo: number, d: number): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function nameMatches(speaker: string, name: string | null | undefined): boolean {
  const s = speaker.trim().toLowerCase();
  const n = name?.trim().toLowerCase();
  if (!s || !n) return false;
  if (s === n) return true;
  const first = n.split(/\s+/)[0];
  return first.length >= 2 && (s === first || s.startsWith(`${first} `));
}

export function speakerDirection(speaker: string, options: ParseTranscriptOptions = {}): TranscriptDirection {
  if (nameMatches(speaker, options.merchantName)) return "outbound";
  if (nameMatches(speaker, options.customerName)) return "inbound";
  if (OUTBOUND_ANYWHERE.test(speaker)) return "outbound";
  if (INBOUND.test(speaker.trim())) return "inbound";
  if (OUTBOUND.test(speaker.trim())) return "outbound";
  return "inbound";
}

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase().startsWith("p");
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function offsetMinutes(zone: string): number | null {
  if (/^(z|utc|gmt)$/i.test(zone)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

export function parseTranscript(text: string, options: ParseTranscriptOptions = {}): ParseTranscriptResult {
  const timeZone = options.timeZone || "UTC";
  const messages: ParsedMessage[] = [];
  const skipped: string[] = [];
  let lastTime: number | null = null;

  const push = (time: number, speaker: string, body: string) => {
    messages.push({
      occurredAt: new Date(time).toISOString(),
      direction: speakerDirection(speaker, options),
      speaker: speaker.trim(),
      body: body.trim(),
    });
    lastTime = time;
  };

  for (const raw of text.slice(0, MAX_TRANSCRIPT_CHARS).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      const last = messages.at(-1);
      if (last && last.body && !last.body.endsWith("\n")) last.body += "\n";
      continue;
    }
    const m = LINE.exec(line);
    if (m) {
      const [, y, mo, d, hh, mm, ss, meridiem, zone, speaker, body] = m;
      const year = Number(y);
      const month = Number(mo);
      const day = Number(d);
      const hour = hh === undefined ? 0 : to24h(Number(hh), meridiem);
      const minute = mm === undefined ? 0 : Number(mm);
      const second = ss === undefined ? 0 : Number(ss);
      if (validDate(year, month, day) && hour < 24 && minute < 60 && second < 60) {
        let time: number;
        const offset = zone ? offsetMinutes(zone) : null;
        if (offset !== null) time = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
        else time = zonedTimeToUtc(year, month, day, hour, minute, second, timeZone).getTime();
        push(time, speaker, body);
        continue;
      }
    }
    const s = SPEAKER_ONLY.exec(line);
    if (s && lastTime !== null && !/^https?$/i.test(s[1])) {
      push(lastTime + 60_000, s[1], s[2]);
      continue;
    }
    const last = messages.at(-1);
    if (last) last.body = last.body ? `${last.body}${last.body.endsWith("\n") ? "" : "\n"}${line.trim()}` : line.trim();
    else skipped.push(line.trim());
  }

  for (const message of messages) message.body = message.body.trim();
  return { messages: messages.filter((m) => m.body.length > 0), skipped };
}
