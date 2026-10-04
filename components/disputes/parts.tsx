import type { DisputeReason, DisputeStatus } from "@/lib/db/types";
import type { DeadlineLabel } from "@/lib/domain/reminders";
import { cn } from "@/lib/utils";

/**
 * The product's visual vocabulary (see components/marketing/mocks/parts.tsx
 * for the pictures these match): mono countdowns, reason codes as neutral
 * chips, status chips, rubber stamps once Stripe has a packet, segmented
 * completeness meters. Oxide only for deadlines, missing items and primary
 * actions; small oxide text uses --oxide-ink for contrast.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function Countdown({
  deadline,
  hasDeadline = true,
  size = "sm",
  className,
}: {
  deadline: DeadlineLabel;
  /** false when Stripe gave no deadline (closed, or a warning without a response window). */
  hasDeadline?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const large = size === "lg" || size === "xl";
  const sizes = cn(
    size === "sm" && "text-sm",
    size === "md" && "text-lg sm:text-xl",
    size === "lg" && "text-4xl sm:text-5xl",
    size === "xl" && "text-[3.5rem] sm:text-7xl",
  );
  if (!hasDeadline) {
    return (
      <span className={cn("countdown leading-none whitespace-nowrap text-foreground/45", sizes, className)}>
        <span aria-hidden="true">--d --h</span>
        <span className="sr-only">No deadline</span>
      </span>
    );
  }
  if (deadline.tone === "past") {
    return (
      <span className={cn("inline-flex flex-col", className)}>
        <span className={cn("countdown leading-none whitespace-nowrap text-foreground/55 line-through decoration-1", sizes)} aria-hidden="true">
          00<span className="text-[0.62em] font-medium">d</span> 00<span className="text-[0.62em] font-medium">h</span>
        </span>
        <span className="mt-1 text-xs font-medium text-foreground/70">Deadline passed</span>
      </span>
    );
  }
  const tone =
    deadline.tone === "ok" ? "text-foreground/85" : large ? "text-oxide" : "text-oxide-ink";
  return (
    <span className={cn("inline-flex", className)}>
      <span aria-hidden="true" className={cn("countdown leading-none whitespace-nowrap", tone, sizes)}>
        {pad(deadline.days)}
        <span className="text-[0.62em] font-medium">d</span> {pad(deadline.hours)}
        <span className="text-[0.62em] font-medium">h</span>
      </span>
      <span className="sr-only">
        {deadline.days} days {deadline.hours} hours left
      </span>
    </span>
  );
}

/** A Stripe reason code as a chip: mono, neutral, exactly as Stripe sends it. */
export function ReasonChip({ reason, stripeReason, className }: { reason: DisputeReason; stripeReason?: string | null; className?: string }) {
  const code = reason === "other" && stripeReason ? stripeReason : reason;
  return (
    <span className={cn("status-chip max-w-full bg-card font-mono text-[0.6875rem] text-foreground/80", className)}>
      <span className="min-w-0 truncate">{code}</span>
    </span>
  );
}

export const STATUS_LABELS: Record<DisputeStatus, string> = {
  warning_needs_response: "Inquiry: needs response",
  needs_response: "Needs response",
  warning_under_review: "Inquiry under review",
  under_review: "Under review",
  won: "Won",
  lost: "Lost",
  warning_closed: "Inquiry closed",
  charge_refunded: "Refunded",
  prevented: "Prevented",
};

const STATUS_TONE: Record<DisputeStatus, string> = {
  warning_needs_response: "text-oxide-ink",
  needs_response: "text-oxide-ink",
  warning_under_review: "text-steel",
  under_review: "text-steel",
  won: "text-olive",
  lost: "text-foreground/70",
  warning_closed: "text-foreground/70",
  charge_refunded: "text-foreground/70",
  prevented: "text-olive",
};

export function StatusChip({ status, className }: { status: DisputeStatus; className?: string }) {
  return <span className={cn("status-chip bg-card whitespace-nowrap", STATUS_TONE[status], className)}>{STATUS_LABELS[status]}</span>;
}

/** The rubber stamp the app puts on a packet once Stripe has it, and again when the bank decides. */
export function Stamp({ tone, children, className }: { tone: "steel" | "olive" | "ash"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "stamp bg-card/80 whitespace-nowrap",
        tone === "steel" ? "text-steel" : tone === "olive" ? "text-olive" : "text-foreground/65",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** SUBMITTED / WON / LOST, or the status chip while the dispute is still open. */
export function DisputeState({
  status,
  packetSubmitted,
  className,
}: {
  status: DisputeStatus;
  packetSubmitted: boolean;
  className?: string;
}) {
  if (status === "won") return <Stamp tone="olive" className={className}>Won</Stamp>;
  if (status === "lost") return <Stamp tone="ash" className={className}>Lost</Stamp>;
  if (packetSubmitted && status !== "warning_closed" && status !== "charge_refunded" && status !== "prevented") {
    return <Stamp tone="steel" className={className}>Submitted</Stamp>;
  }
  return <StatusChip status={status} className={className} />;
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

/** A filled check for a present field, a dashed ring for a missing one. */
export function FieldMark({ present, className }: { present: boolean; className?: string }) {
  return present ? (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-olive", className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-oxide-ink", className)}>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2" />
    </svg>
  );
}

/** Segmented completeness: one cell per playbook field, empty cells hatched. */
export function CompletenessMeter({
  have,
  of,
  percent,
  compact = false,
  className,
}: {
  have: number;
  of: number;
  /** The stored weighted score (required 70 / recommended 30). */
  percent: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {compact ? null : (
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-semibold text-foreground/80">Completeness</span>
          <span className="tabular font-mono text-foreground/80">
            {have} of {of} · {percent}%
          </span>
        </div>
      )}
      <div
        role="img"
        aria-label={`Completeness ${percent}%: ${have} of ${of} playbook fields`}
        className={cn("flex gap-0.5", compact ? "" : "mt-2")}
      >
        {Array.from({ length: of }, (_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-[2px]",
              compact ? "h-1.5" : "h-2",
              i < have ? "bg-foreground/75" : "hatch bg-card ring-1 ring-oxide-ink/50 ring-inset",
            )}
          />
        ))}
      </div>
      {compact ? <span className="tabular mt-1 block font-mono text-[0.6875rem] text-foreground/70">{percent}%</span> : null}
    </div>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-sm border border-dashed border-foreground/30 px-1.5 py-px font-mono text-[0.625rem] tracking-wide text-foreground/70 uppercase", className)}
      title="Created by Create demo disputes in Stripe test mode"
    >
      Demo
    </span>
  );
}
