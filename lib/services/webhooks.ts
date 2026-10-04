import "server-only";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import { audit, errorText, type ServiceDeps } from "./shared";
import { syncOneDispute } from "./sync";

/**
 * `charge.dispute.*` events on the platform webhook (spec 3.2). Merchants
 * connect their own restricted keys and the event carries no org id, so the
 * dispute id is the only link: every org that has already synced this
 * dispute re-reads it from Stripe with its own key (never trusting the event
 * body, so out-of-order deliveries cannot regress data). A dispute no org
 * has synced yet is ignored; the next manual or daily sync picks it up.
 * Per-org webhook endpoints (or Stripe Connect) are the later fix.
 */

export const DISPUTE_EVENT_TYPES = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export type DisputeEventType = (typeof DISPUTE_EVENT_TYPES)[number];

export function isDisputeEventType(type: string): type is DisputeEventType {
  return (DISPUTE_EVENT_TYPES as readonly string[]).includes(type);
}

export async function handleDisputeEvent(
  eventType: DisputeEventType,
  dispute: { id: string },
  deps?: ServiceDeps,
): Promise<string> {
  const orgIds = await disputesRepo.findOrgIdsByStripeDisputeId(dispute.id);
  if (orgIds.length === 0) return `ignored: no organization has synced ${dispute.id}`;
  const outcomes: string[] = [];
  for (const orgId of orgIds) {
    try {
      const { dispute: stored } = await syncOneDispute(orgId, dispute.id, { actor: "webhook" }, deps);
      outcomes.push(`${orgId}: ${stored.status}`);
    } catch (error) {
      // One org's revoked key must not fail the delivery for the others.
      outcomes.push(`${orgId}: failed`);
      await audit({
        orgId,
        actor: "webhook",
        type: "dispute.webhook_failed",
        entityType: "organization",
        entityId: orgId,
        input: { eventType, stripeDisputeId: dispute.id },
        output: { error: errorText(error).slice(0, 300) },
      });
    }
  }
  return outcomes.join("; ");
}
