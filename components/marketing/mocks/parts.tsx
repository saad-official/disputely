import { cn } from "@/lib/utils";

/**
 * Building blocks for the product fragments on the marketing pages. These are
 * static pictures of the app, not working controls, so nothing in them is
 * focusable and buttons are drawn as spans.
 */

export function MockCard({
  label,
  meta,
  className,
  bodyClassName,
  children,
}: {
  label: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-card shadow-card ring-1 ring-foreground/10", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="min-w-0 truncate text-xs font-semibold text-foreground/75">{label}</span>
        {meta ? <span className="shrink-0 font-mono text-[0.6875rem] text-foreground/70">{meta}</span> : null}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A deadline countdown as the app draws it: "06d 14h" in mono. The visual is
 * hidden from assistive tech and replaced with words. Large sizes use oxide
 * itself; small sizes use the darker --oxide-ink so they keep 4.5:1.
 */
export function Countdown({
  days,
  hours,
  size = "sm",
  className,
}: {
  days: number;
  hours: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const large = size === "lg" || size === "xl";
  return (
    <span className={cn("inline-flex", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "countdown leading-none whitespace-nowrap",
          large ? "text-oxide" : "text-(--oxide-ink)",
          size === "sm" && "text-sm",
          size === "md" && "text-lg sm:text-xl",
          size === "lg" && "text-4xl sm:text-5xl",
          size === "xl" && "text-[3.75rem] sm:text-7xl lg:text-[5.5rem]",
        )}
      >
        {pad(days)}
        <span className="text-[0.62em] font-medium">d</span> {pad(hours)}
        <span className="text-[0.62em] font-medium">h</span>
      </span>
      <span className="sr-only">
        {days} days {hours} hours left
      </span>
    </span>
  );
}

export type Reason =
  | "fraudulent"
  | "product_not_received"
  | "product_unacceptable"
  | "subscription_canceled"
  | "duplicate"
  | "credit_not_processed"
  | "unrecognized"
  | "general";

/** A Stripe reason code as a chip: mono, neutral, the code exactly as Stripe sends it. */
export function ReasonChip({ reason, className }: { reason: Reason; className?: string }) {
  return (
    <span className={cn("status-chip max-w-full bg-card font-mono text-[0.6875rem] text-foreground/80", className)}>
      <span className="min-w-0 truncate">{reason}</span>
    </span>
  );
}

type Status = "needs_response" | "under_review" | "submitted" | "won" | "lost";

const statusTone: Record<Status, { label: string; className: string }> = {
  needs_response: { label: "Needs response", className: "text-(--oxide-ink)" },
  under_review: { label: "Under review", className: "text-steel" },
  submitted: { label: "Submitted", className: "text-steel" },
  won: { label: "Won", className: "text-olive" },
  lost: { label: "Lost", className: "text-foreground/70" },
};

export function StatusChip({ status, className }: { status: Status; className?: string }) {
  const tone = statusTone[status];
  return <span className={cn("status-chip bg-card", tone.className, className)}>{tone.label}</span>;
}

/** The rubber-stamp mark the app puts on a packet once Stripe has it, and again when the bank decides. */
export function Stamp({
  tone,
  children,
  className,
}: {
  tone: "steel" | "olive";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "stamp bg-card/80",
        tone === "steel" ? "text-steel" : "text-olive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Where a field's value came from, as a small mono tag. */
export function SourceTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[0.6875rem] leading-tight text-foreground/80",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A filled check for a field that is present, an open ring for one that is missing. */
export function FieldMark({ present }: { present: boolean }) {
  return present ? (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-olive">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--oxide-ink)">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2" />
    </svg>
  );
}

/** A segmented completeness meter: one cell per playbook field, empty cells hatched. */
export function Completeness({ have, of, className }: { have: number; of: number; className?: string }) {
  const pct = Math.round((have / of) * 100);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-foreground/80">Completeness</span>
        <span className="tabular font-mono text-foreground/80">
          {have} of {of} · {pct}%
        </span>
      </div>
      <div aria-hidden="true" className="mt-2 flex gap-1">
        {Array.from({ length: of }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 flex-1 rounded-[2px]",
              i < have ? "bg-foreground/80" : "hatch bg-card ring-1 ring-(--oxide-ink)/60 ring-inset",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** A faux button, drawn as a span because the picture is not interactive. */
export function FauxButton({
  tone = "oxide",
  children,
  className,
}: {
  tone?: "oxide" | "outline";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold whitespace-nowrap",
        tone === "oxide" ? "border-(--oxide-ink) bg-(--oxide-ink) text-white" : "border-foreground/25 bg-card text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * One open dispute as a row in the app's lists: the countdown leads, then who
 * and how much, with the reason code underneath so long codes never squeeze
 * the amount on a phone.
 */
export function DisputeRow({
  days,
  hours,
  customer,
  reason,
  amount,
  extra,
}: {
  days: number;
  hours: number;
  customer: string;
  reason: Reason;
  amount: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] sm:grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-x-3">
      <Countdown days={days} hours={hours} size="md" className="pt-0.5" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm text-foreground">{customer}</span>
          <span className="tabular shrink-0 font-mono text-sm text-foreground">{amount}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <ReasonChip reason={reason} />
          {extra}
        </div>
      </div>
    </div>
  );
}
