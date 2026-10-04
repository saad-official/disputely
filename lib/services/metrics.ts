import "server-only";
import * as agentEventsRepo from "@/lib/db/repositories/agentEvents";
import type { AgentEventSummary } from "@/lib/db/repositories/agentEvents";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as metricsRepo from "@/lib/db/repositories/metrics";
import type { WinRate } from "@/lib/db/repositories/metrics";
import * as packetsRepo from "@/lib/db/repositories/packets";
import type { PacketSummary } from "@/lib/db/repositories/packets";
import { DISPUTE_REASONS } from "@/lib/db/schema";
import type { Dispute, DisputeReason, DisputeStatus, Money } from "@/lib/db/types";
import { getPlaybook } from "@/lib/domain/playbooks";
import { deadlineLabel, type DeadlineLabel } from "@/lib/domain/reminders";

/**
 * Read models for the dashboard and analytics (spec 3.6). Every value is
 * plain data selected field by field (no organization row, no blobs), so
 * pages can pass it to client islands safely. Money is per currency.
 */

export type OpenDisputeRow = {
  id: string;
  stripeDisputeId: string;
  amountCents: number;
  currency: string;
  reason: DisputeReason;
  stripeReason: string | null;
  status: DisputeStatus;
  dueBy: string | null;
  deadline: DeadlineLabel;
  customerName: string | null;
  customerEmail: string | null;
  demo: boolean;
  packet: { status: PacketSummary["status"]; completeness: number; have: number; of: number } | null;
};

export type DashboardData = {
  open: OpenDisputeRow[];
  needsResponse: number;
  atStake: Money[];
  openCount: number;
  winRate: WinRate;
  medianCompleteness: number | null;
  recovered: Money[];
  recent: AgentEventSummary[];
  totalDisputes: number;
};

export function playbookSize(reason: DisputeReason): number {
  const playbook = getPlaybook(reason);
  return playbook.required.length + playbook.recommended.length;
}

export function toOpenRow(d: Dispute, packet: PacketSummary | undefined, now: Date): OpenDisputeRow {
  const of = playbookSize(d.reason);
  return {
    id: d.id,
    stripeDisputeId: d.stripeDisputeId,
    amountCents: d.amountCents,
    currency: d.currency,
    reason: d.reason,
    stripeReason: d.stripeReason,
    status: d.status,
    dueBy: d.dueBy?.toISOString() ?? null,
    deadline: deadlineLabel(d.dueBy, now),
    customerName: d.customer.name ?? null,
    customerEmail: d.customer.email ?? null,
    demo: Boolean(d.charge.demo) && !d.livemode,
    packet: packet
      ? {
          status: packet.status,
          completeness: packet.completeness,
          of,
          have: Math.max(0, of - packet.missing.filter((k) => k !== "uncategorized_text").length),
        }
      : null,
  };
}

export async function getDashboard(orgId: string, now: Date): Promise<DashboardData> {
  const [open, needsResponse, stake, winRates, medianCompleteness, recovered, recent, counts] = await Promise.all([
    disputesRepo.listOpen(orgId),
    disputesRepo.countNeedsResponse(orgId),
    metricsRepo.openAtStake(orgId),
    metricsRepo.winRateByReason(orgId),
    metricsRepo.medianSubmittedCompleteness(orgId),
    metricsRepo.recoveredCents(orgId),
    agentEventsRepo.listRecent(orgId, 10),
    metricsRepo.countsByStatus(orgId),
  ]);
  const packets = await packetsRepo.listSummaries(orgId, open.map((d) => d.id));
  return {
    open: open.map((d) => toOpenRow(d, packets.get(d.id), now)),
    needsResponse,
    atStake: stake.atStake,
    openCount: stake.count,
    winRate: winRates.overall,
    medianCompleteness,
    recovered,
    recent,
    totalDisputes: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

export type OutcomeRow = {
  id: string;
  stripeDisputeId: string;
  reason: DisputeReason;
  status: DisputeStatus;
  amountCents: number;
  currency: string;
  customerName: string | null;
  closedAt: string | null;
  completeness: number | null;
  demo: boolean;
};

export type AnalyticsData = {
  overall: WinRate;
  byReason: { reason: DisputeReason; title: string; rate: WinRate }[];
  medianCompleteness: number | null;
  recovered: Money[];
  counts: Record<DisputeStatus, number>;
  outcomes: OutcomeRow[];
};

export async function getAnalytics(orgId: string, options: { since?: Date } = {}): Promise<AnalyticsData> {
  const [rates, medianCompleteness, recovered, counts, closed] = await Promise.all([
    metricsRepo.winRateByReason(orgId, options),
    metricsRepo.medianSubmittedCompleteness(orgId, options),
    metricsRepo.recoveredCents(orgId, options),
    metricsRepo.countsByStatus(orgId),
    disputesRepo.listClosed(orgId, 50),
  ]);
  const packets = await packetsRepo.listSummaries(orgId, closed.map((d) => d.id));
  const byReason = DISPUTE_REASONS.map((reason) => ({
    reason,
    title: reason === "other" ? "Other" : getPlaybook(reason).title,
    rate: rates.byReason[reason],
  }))
    .filter((r) => r.rate.won + r.rate.lost > 0)
    .sort((a, b) => b.rate.won + b.rate.lost - (a.rate.won + a.rate.lost) || a.reason.localeCompare(b.reason));
  return {
    overall: rates.overall,
    byReason,
    medianCompleteness,
    recovered,
    counts,
    outcomes: closed.map((d) => ({
      id: d.id,
      stripeDisputeId: d.stripeDisputeId,
      reason: d.reason,
      status: d.status,
      amountCents: d.amountCents,
      currency: d.currency,
      customerName: d.customer.name ?? null,
      closedAt: d.closedAt?.toISOString() ?? null,
      completeness: packets.get(d.id)?.completeness ?? null,
      demo: Boolean(d.charge.demo) && !d.livemode,
    })),
  };
}
