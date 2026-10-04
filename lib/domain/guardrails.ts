import {
  findDates,
  findEmails,
  findIps,
  findMoney,
  findNameCandidates,
  findStripeIds,
  findTrackingLike,
  findUrls,
  mask,
  normaliseToken,
  normaliseWord,
  type Span,
} from "./extract";
import { minorUnitDigits } from "./format";
import type { Facts } from "./types";

/**
 * Narrative guardrails (spec 3.4). Every date, amount, tracking-like token,
 * email, IP, Stripe id and capitalised multi-word name in the model's
 * narrative must match an assembled fact. A sentence containing an unmatched
 * claim, speculation about the cardholder's motives or a legal threat is
 * removed whole; the rest of the narrative is kept.
 */

export const NARRATIVE_MAX_CHARS = 2_500;
/** More than this share of content sentences removed => ok: false. */
export const MAX_REMOVED_RATIO = 0.3;

/** Section headings the prompt asks for; never scanned as claims. */
export const NARRATIVE_SECTIONS = [
  "What was purchased",
  "Delivery / access",
  "What the customer agreed to",
  "Communication",
  "Why this dispute is invalid",
] as const;

export type ClaimKind = "date" | "amount" | "tracking" | "email" | "name" | "ip" | "id";
export type RemovalKind = ClaimKind | "speculation" | "legal_threat" | "length";

export interface VerifiedClaim {
  text: string;
  kind: ClaimKind;
}

export interface RemovedSentence {
  /** The sentence that was removed. */
  text: string;
  kind: RemovalKind;
  /** The token or phrase that caused the removal (absent for length). */
  claim?: string;
}

export interface NarrativeVerification {
  narrative: string;
  removed: RemovedSentence[];
  verified: VerifiedClaim[];
  ok: boolean;
}

/** Speculation about the cardholder's motives. */
export const SPECULATION_PATTERNS: RegExp[] = [
  /\bclearly\s+lying\b/i,
  /\b(?:is|are|was|were|be)\s+lying\b/i,
  /\bliars?\b/i,
  /\bfraudsters?\b/i,
  /\bintentional(?:ly)?\b/i,
  /\bdeliberate(?:ly)?\b/i,
  /\bscam(?:s|med|mer|mers|ming)?\b/i,
  /\bin bad faith\b/i,
  /\bfriendly fraud\b/i,
  /\bdishonest\w*/i,
  /\b(?:trying|tried|attempting|attempted) to (?:get|obtain|keep) (?:\w+ ){0,3}(?:for )?free\b/i,
];

/** Legal threats. */
export const LEGAL_THREAT_PATTERNS: RegExp[] = [
  /\blegal action\b/i,
  /\blawyers?\b/i,
  /\battorneys?\b/i,
  /\b(?:sue|sues|sued|suing)\b/i,
  /\bprosecut\w*/i,
  /\blawsuits?\b/i,
  // "court" only as a venue or action, never as part of a street address ("7 Harbor View Court").
  /\b(?:to|in|before|at) court\b/i,
  /\bcourt (?:action|order|orders|proceedings?|case|filing|summons)\b/i,
  /\bsmall claims\b/i,
  /\bpolice\b/i,
  /\blaw enforcement\b/i,
  /\bcollections? agenc(?:y|ies)\b/i,
];

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "st",
  "ave",
  "rd",
  "inc",
  "ltd",
  "co",
  "no",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "u.s",
  "approx",
  "apt",
  "jr",
  "sr",
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
]);

/** Split a line into sentences without breaking on "Ms.", "Oct.", "e.g." or initials. */
export function splitSentences(line: string): string[] {
  const out: string[] = [];
  const re = /[.!?]+["”’')\]]*(\s+)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const punctEnd = m.index + m[0].length - m[1].length;
    const next = line[m.index + m[0].length];
    if (m[0].startsWith(".") && !m[0].startsWith("..")) {
      const lastWord = (line.slice(start, m.index).split(/\s+/).pop() ?? "").replace(/^[("'“]+/, "");
      if (ABBREVIATIONS.has(lastWord.toLowerCase()) || /^\p{Lu}$/u.test(lastWord)) continue;
    }
    if (next && !/[\p{Lu}\d"“'(\[$€£]/u.test(next)) continue;
    const sentence = line.slice(start, punctEnd).trim();
    if (sentence) out.push(sentence);
    start = m.index + m[0].length;
  }
  const rest = line.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function headingKey(line: string): string {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/:$/, "")
    .replace(/\*\*$/, "")
    .trim()
    .toLowerCase();
}

const HEADING_KEYS = new Set(NARRATIVE_SECTIONS.map((h) => h.toLowerCase()));

export function isSectionHeading(line: string): boolean {
  return HEADING_KEYS.has(headingKey(line));
}

/* ------------------------------------------------------------------ */
/* Fact matching                                                       */
/* ------------------------------------------------------------------ */

interface FactIndex {
  emails: Set<string>;
  ips: Set<string>;
  ids: Set<string>;
  dates: Set<string>;
  cents: Set<number>;
  zeroDecimal: boolean;
  tokens: Set<string>;
  phrase: string;
  words: Set<string>;
}

function normalisePhrase(text: string): string {
  return text
    .split(/\s+/)
    .map(normaliseWord)
    .filter(Boolean)
    .join(" ");
}

function indexFacts(facts: Facts): FactIndex {
  const textual = [
    facts.merchantName ?? "",
    ...facts.names,
    ...facts.productNames,
    ...facts.policyTitles,
    ...facts.carriers,
    ...facts.addresses,
    ...facts.messageExcerpts,
  ].filter(Boolean);
  const tokens = new Set<string>();
  for (const t of [...facts.trackingNumbers, ...facts.ids]) tokens.add(normaliseToken(t));
  for (const t of textual) for (const s of findTrackingLike(t)) tokens.add(normaliseToken(s.text));
  const words = new Set<string>();
  for (const t of textual) for (const w of t.split(/[\s,]+/)) if (normaliseWord(w)) words.add(normaliseWord(w));
  return {
    emails: new Set(facts.emails.map((e) => e.trim().toLowerCase())),
    ips: new Set(facts.ips.map((i) => i.trim())),
    ids: new Set(facts.ids.map((i) => i.trim())),
    dates: new Set(facts.dates),
    cents: new Set(facts.amountCents),
    zeroDecimal: minorUnitDigits(facts.currency || "usd") === 0,
    tokens,
    phrase: ` ${textual.map(normalisePhrase).join(" | ")} `,
    words,
  };
}

function dateMatches(candidates: string[], idx: FactIndex): boolean {
  return candidates.some((c) =>
    c.startsWith("--") ? [...idx.dates].some((d) => d.endsWith(c.slice(1))) : idx.dates.has(c),
  );
}

function moneyMatches(major: number, idx: FactIndex): boolean {
  return idx.cents.has(Math.round(major * 100)) || (idx.zeroDecimal && idx.cents.has(Math.round(major)));
}

function nameMatches(text: string, significant: string[], idx: FactIndex): boolean {
  const phrase = normalisePhrase(text);
  if (phrase && idx.phrase.includes(` ${phrase} `)) return true;
  if (phrase && idx.phrase.includes(phrase)) return true;
  return significant.every((w) => idx.words.has(w));
}

interface SentenceCheck {
  verified: VerifiedClaim[];
  failure: { kind: RemovalKind; claim: string } | null;
}

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

function checkSentence(sentence: string, idx: FactIndex): SentenceCheck {
  const speculation = firstMatch(SPECULATION_PATTERNS, sentence);
  if (speculation) return { verified: [], failure: { kind: "speculation", claim: speculation } };
  const legal = firstMatch(LEGAL_THREAT_PATTERNS, sentence);
  if (legal) return { verified: [], failure: { kind: "legal_threat", claim: legal } };

  const verified: VerifiedClaim[] = [];
  let failure: SentenceCheck["failure"] = null;
  const record = (kind: ClaimKind, text: string, ok: boolean) => {
    if (ok) verified.push({ kind, text });
    else failure ??= { kind, claim: text };
  };

  let text = sentence;
  const consume = <T extends Span>(spans: T[], check: (s: T) => [ClaimKind, boolean] | null) => {
    for (const s of spans) {
      const result = check(s);
      if (result) record(result[0], s.text, result[1]);
    }
    text = mask(text, spans);
  };

  consume(findUrls(text), () => null);
  consume(findEmails(text), (s) => ["email", idx.emails.has(s.text.toLowerCase())]);
  consume(findIps(text), (s) => ["ip", idx.ips.has(s.text)]);
  consume(findStripeIds(text), (s) => ["id", idx.ids.has(s.text)]);
  consume(findDates(text), (s) => ["date", dateMatches(s.candidates, idx)]);
  consume(findMoney(text), (s) => ["amount", moneyMatches(s.major, idx)]);
  consume(findTrackingLike(text), (s) => ["tracking", idx.tokens.has(normaliseToken(s.text))]);
  for (const n of findNameCandidates(text)) record("name", n.text, nameMatches(n.text, n.significant, idx));

  return { verified, failure };
}

/* ------------------------------------------------------------------ */
/* verifyNarrative                                                     */
/* ------------------------------------------------------------------ */

type Block =
  | { type: "heading"; text: string }
  | { type: "blank" }
  | { type: "para"; prefix: string; sentences: string[] };

const BULLET = /^(\s*(?:[-*•]|\d+[.)])\s+)/;

function parse(narrative: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of narrative.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) blocks.push({ type: "blank" });
    else if (isSectionHeading(line)) blocks.push({ type: "heading", text: line.trim() });
    else {
      const prefix = BULLET.exec(line)?.[1] ?? "";
      blocks.push({ type: "para", prefix: prefix.trimStart(), sentences: splitSentences(line.slice(prefix.length)) });
    }
  }
  return blocks;
}

function render(blocks: Block[]): string {
  // Drop headings whose section has no content left.
  const kept: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "para" && b.sentences.length === 0) continue;
    if (b.type === "heading") {
      let hasContent = false;
      for (let j = i + 1; j < blocks.length; j++) {
        const n = blocks[j];
        if (n.type === "heading") break;
        if (n.type === "para" && n.sentences.length > 0) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) continue;
    }
    kept.push(b);
  }
  return kept
    .map((b) => (b.type === "blank" ? "" : b.type === "heading" ? b.text : `${b.prefix}${b.sentences.join(" ")}`))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function verifyNarrative(narrative: string, facts: Facts): NarrativeVerification {
  const idx = indexFacts(facts);
  const blocks = parse(narrative ?? "");
  const removed: RemovedSentence[] = [];
  const verified: VerifiedClaim[] = [];
  let total = 0;
  let removedForContent = 0;

  for (const b of blocks) {
    if (b.type !== "para") continue;
    const keep: string[] = [];
    for (const sentence of b.sentences) {
      total++;
      const check = checkSentence(sentence, idx);
      if (check.failure) {
        removedForContent++;
        removed.push({ text: sentence, kind: check.failure.kind, claim: check.failure.claim });
      } else {
        keep.push(sentence);
        verified.push(...check.verified);
      }
    }
    b.sentences = keep;
  }

  // Enforce the length cap by dropping whole sentences from the end.
  let text = render(blocks);
  while (text.length > NARRATIVE_MAX_CHARS) {
    const last = [...blocks].reverse().find((b): b is Extract<Block, { type: "para" }> => b.type === "para" && b.sentences.length > 0);
    if (!last) break;
    const dropped = last.sentences.pop()!;
    removed.push({ text: dropped, kind: "length" });
    text = render(blocks);
  }
  if (text.length > NARRATIVE_MAX_CHARS) text = text.slice(0, NARRATIVE_MAX_CHARS).trimEnd();

  // Only claims that survived into the final text count as verified.
  const finalText = text;
  const seen = new Set<string>();
  const verifiedFinal = verified.filter((v) => {
    const key = `${v.kind}:${v.text}`;
    if (seen.has(key) || !finalText.includes(v.text)) return false;
    seen.add(key);
    return true;
  });

  const ok = total > 0 && finalText.length > 0 && removedForContent / total <= MAX_REMOVED_RATIO;
  return { narrative: finalText, removed, verified: verifiedFinal, ok };
}
