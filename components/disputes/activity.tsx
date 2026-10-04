import type { AgentEventSummary } from "@/lib/db/repositories/agentEvents";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Plain-English labels for agent_events types (anything unknown shows its raw type). */
const LABELS: Record<string, string> = {
  "dispute.synced": "Synced disputes from Stripe",
  "dispute.refreshed": "Dispute refreshed from Stripe",
  "dispute.closed": "Dispute closed by the bank",
  "dispute.webhook_failed": "Webhook refresh failed",
  "packet.assembled": "Packet assembled",
  "packet.narrative_drafted": "Statement written and fact-checked",
  "packet.narrative_failed": "Statement could not be written",
  "packet.pdf_rendered": "Packet PDF rendered",
  "packet.submitted": "Evidence submitted to Stripe",
  "packet.submit_failed": "Submission refused by Stripe",
  "attachment.uploaded": "File attached",
  "attachment.removed": "File removed",
  "library.created": "Library item added",
  "library.updated": "Library item edited",
  "library.removed": "Library item deleted",
  "shipment.saved": "Shipment record saved",
  "shipment.removed": "Shipment record deleted",
  "message_log.added": "Customer messages added",
  "message_log.removed": "Customer message deleted",
  "reminder.sent": "Deadline reminder emailed",
  "reminder.failed": "Deadline reminder failed",
  "stripe.connected": "Stripe connected",
  "stripe.disconnected": "Stripe disconnected",
  "stripe.connect_failed": "Stripe key refused",
  "demo.created": "Demo disputes created",
  "demo.cleared": "Demo data cleared",
  "demo.failed": "Demo disputes could not be created",
  "billing.plan_synced": "Plan updated",
  "settings.profile_updated": "Profile updated",
  "settings.reminders_updated": "Reminder settings updated",
};

const ACTOR: Record<AgentEventSummary["actor"], string> = {
  agent: "model",
  user: "you",
  system: "Disputely",
  cron: "daily job",
  webhook: "Stripe webhook",
};

function detail(event: AgentEventSummary): string | null {
  const out = (event.output ?? {}) as Record<string, unknown>;
  if (event.type === "dispute.synced" && typeof out.synced === "number") {
    return `${out.synced} synced${out.created ? `, ${out.created} new` : ""}${out.closed ? `, ${out.closed} closed` : ""}`;
  }
  if (event.type === "packet.assembled" && typeof out.completeness === "number") return `${out.completeness}% complete`;
  if (event.type === "packet.narrative_drafted" && typeof out.verified === "number") {
    const removed = Array.isArray(out.removed) ? out.removed.filter((r) => (r as { kind?: string }).kind !== "length").length : 0;
    return `${out.verified} facts verified${removed ? `, ${removed} removed` : ""}`;
  }
  if ((event.type === "dispute.closed" || event.type === "dispute.refreshed") && typeof out.status === "string") return out.status;
  if (event.type === "packet.submitted" && typeof out.stripeStatus === "string") return `Stripe: ${out.stripeStatus}`;
  return null;
}

export function ActivityList({ events, now, className }: { events: AgentEventSummary[]; now: Date; className?: string }) {
  if (events.length === 0) {
    return <p className={cn("px-4 py-6 text-sm text-muted-foreground", className)}>Nothing yet. Activity shows up here as you work.</p>;
  }
  return (
    <ol className={cn("divide-y divide-border", className)}>
      {events.map((event) => {
        const extra = detail(event);
        return (
          <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5">
            <span className="min-w-0 text-sm">
              <span className="text-foreground">{LABELS[event.type] ?? event.type}</span>
              {extra ? <span className="text-muted-foreground"> · {extra}</span> : null}
              <span className="block font-mono text-[0.6875rem] text-foreground/60">
                by {ACTOR[event.actor]}
                {event.model ? ` · ${event.model}` : ""}
              </span>
            </span>
            <time dateTime={event.createdAt.toISOString()} className="font-mono text-[0.6875rem] whitespace-nowrap text-foreground/65">
              {formatAgo(event.createdAt, now)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
