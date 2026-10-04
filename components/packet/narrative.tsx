import { isSectionHeading } from "@/lib/domain/guardrails";
import type { NarrativeMeta } from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceTag } from "@/components/disputes/parts";

/**
 * The statement (Stripe's `uncategorized_text`) as the guardrails left it:
 * verified facts highlighted, removed sentences listed struck through with
 * why. Merchant and model text is rendered as React text, never as HTML.
 */

export const NARRATIVE_LIMIT = 2_500;

const REMOVAL_REASON: Record<string, string> = {
  date: "a date that is not in the evidence",
  amount: "an amount that is not in the evidence",
  tracking: "a tracking number or code that is not in the evidence",
  email: "an email address that is not in the evidence",
  name: "a name that is not in the evidence",
  ip: "an IP address that is not in the evidence",
  id: "an id that is not in the evidence",
  speculation: "speculation about the cardholder's motives",
  legal_threat: "a legal threat",
  length: "over the 2,500-character limit",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a line into plain and verified-fact segments. */
export function highlightSegments(line: string, facts: readonly string[]): { text: string; fact: boolean }[] {
  const usable = [...new Set(facts.map((f) => f.trim()).filter((f) => f.length >= 2))].sort((a, b) => b.length - a.length);
  if (usable.length === 0) return [{ text: line, fact: false }];
  const pattern = new RegExp(`(${usable.map(escapeRegExp).join("|")})`, "g");
  const set = new Set(usable);
  return line
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, fact: set.has(part) }));
}

export function NarrativeText({ narrative, facts }: { narrative: string; facts: readonly string[] }) {
  const lines = narrative.split("\n");
  return (
    <div className="space-y-1.5 text-[0.9375rem] leading-[1.8] text-foreground">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} aria-hidden="true" className="h-2" />;
        if (isSectionHeading(line)) {
          return (
            <p key={i} className="pt-2 font-sans text-xs font-semibold tracking-wide text-foreground/70 uppercase first:pt-0">
              {line.trim()}
            </p>
          );
        }
        return (
          <p key={i}>
            {highlightSegments(line, facts).map((seg, j) =>
              seg.fact ? (
                <mark key={j} className="fact rounded-[2px] text-foreground">
                  {seg.text}
                </mark>
              ) : (
                <span key={j}>{seg.text}</span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}

export function RemovedClaims({ meta }: { meta: NarrativeMeta | null }) {
  const removed = (meta?.removed ?? []).filter((r) => r.kind !== "length");
  const trimmed = (meta?.removed ?? []).some((r) => r.kind === "length");
  if (removed.length === 0 && !trimmed) return null;
  return (
    <div className="border-t-2 border-oxide-ink/70 bg-accent/60 px-4 py-3">
      <p className="text-xs font-semibold text-oxide-ink">Removed and flagged ({removed.length})</p>
      <ul className="mt-2 space-y-2">
        {removed.map((r, i) => (
          <li key={i} className="text-xs leading-relaxed text-foreground/85">
            <del className="decoration-oxide-ink decoration-2 text-foreground/70">
              <span className="sr-only">Removed claim: </span>
              {r.text}
            </del>
            <span className="mt-0.5 block">
              Removed: {REMOVAL_REASON[r.kind] ?? r.kind}
              {r.claim ? (
                <>
                  {" "}
                  (<span className="font-mono">{r.claim}</span>)
                </>
              ) : null}
              . It is not part of what Stripe receives.
            </span>
          </li>
        ))}
        {trimmed ? <li className="text-xs text-foreground/80">The end of the statement was trimmed to fit 2,500 characters.</li> : null}
      </ul>
    </div>
  );
}

export function NarrativeMetaLine({ meta, timezone }: { meta: NarrativeMeta | null; timezone: string }) {
  if (!meta) return null;
  const verified = meta.verified?.length ?? meta.verifiedFacts?.length ?? 0;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className={cn("font-semibold", verified > 0 ? "text-olive" : "text-foreground/70")}>
        {verified} {verified === 1 ? "fact" : "facts"} verified
      </span>
      {meta.ok === false ? <span className="font-semibold text-oxide-ink">Too much was removed: rewrite or edit the evidence.</span> : null}
      {meta.model ? <SourceTag>{meta.model}</SourceTag> : null}
      {meta.promptVersion ? <SourceTag>{meta.promptVersion}</SourceTag> : null}
      {meta.generatedAt ? <span>written {formatDateTime(meta.generatedAt, timezone)}</span> : null}
    </p>
  );
}
