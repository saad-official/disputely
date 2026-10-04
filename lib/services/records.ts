import "server-only";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import { MAX_BULK_MESSAGES } from "@/lib/db/repositories/messageLogs";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as packetsRepo from "@/lib/db/repositories/packets";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import { CHANNELS } from "@/lib/db/schema";
import type { Channel, MessageLog, Shipment } from "@/lib/db/types";
import { parseTranscript, type ParsedMessage } from "@/lib/domain/transcript";
import { asInvalidInput, NotFoundError, ServiceError } from "./errors";
import { buildPacket } from "./packets";
import { audit, errorText } from "./shared";

export { parseTranscript } from "@/lib/domain/transcript";
export type { ParsedMessage } from "@/lib/domain/transcript";

/**
 * The merchant's own records the assembler draws on (spec 3.3): shipment
 * records per charge and customer message logs. Saving either re-assembles
 * the open packets it affects, so completeness updates at once.
 */

const CHARGE_ID = /^(ch|py)_[A-Za-z0-9]+$/;

export type ShipmentFormInput = {
  chargeId: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  proofUrl?: string | null;
};

/** Re-assembles unsubmitted packets of the org's disputes on these charges. Failures are logged, never thrown. */
async function refreshPacketsForCharge(orgId: string, chargeId: string): Promise<number> {
  const disputes = await disputesRepo.findByCharge(orgId, chargeId);
  if (disputes.length === 0) return 0;
  const summaries = await packetsRepo.listSummaries(orgId, disputes.map((d) => d.id));
  let refreshed = 0;
  for (const dispute of disputes) {
    const summary = summaries.get(dispute.id);
    if (!summary || summary.status === "submitted") continue;
    try {
      await buildPacket(orgId, dispute.id, { actor: "system" });
      refreshed++;
    } catch (error) {
      console.error("[records] packet refresh failed", dispute.id, errorText(error));
    }
  }
  return refreshed;
}

async function refreshPacketsForCustomer(orgId: string, email: string, disputeId?: string | null): Promise<number> {
  const { items } = await disputesRepo.listAll(orgId, { limit: 100 });
  const target = email.trim().toLowerCase();
  const affected = items.filter((d) => d.id === disputeId || d.customer.email?.trim().toLowerCase() === target);
  if (affected.length === 0) return 0;
  const summaries = await packetsRepo.listSummaries(orgId, affected.map((d) => d.id));
  let refreshed = 0;
  for (const dispute of affected) {
    const summary = summaries.get(dispute.id);
    if (!summary || summary.status === "submitted") continue;
    try {
      await buildPacket(orgId, dispute.id, { actor: "system" });
      refreshed++;
    } catch (error) {
      console.error("[records] packet refresh failed", dispute.id, errorText(error));
    }
  }
  return refreshed;
}

/** Creates or replaces the shipment record for a charge. */
export async function saveShipment(orgId: string, input: ShipmentFormInput): Promise<{ shipment: Shipment; refreshed: number }> {
  const chargeId = input.chargeId.trim();
  if (!CHARGE_ID.test(chargeId)) {
    throw new ServiceError("invalid_input", "Enter the Stripe charge id the shipment fulfils (it starts with ch_).");
  }
  if (!input.carrier?.trim() && !input.trackingNumber?.trim() && !input.shippedAt && !input.proofUrl?.trim()) {
    throw new ServiceError("invalid_input", "Add at least a carrier, tracking number, ship date or proof link.");
  }
  const shipment = await asInvalidInput(() =>
    shipmentsRepo.upsertByCharge(orgId, chargeId, {
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      shippedAt: input.shippedAt ?? null,
      deliveredAt: input.deliveredAt ?? null,
      proofUrl: input.proofUrl ?? null,
    }),
  );
  await audit({
    orgId,
    actor: "user",
    type: "shipment.saved",
    entityType: "shipment",
    entityId: shipment.id,
    input: { chargeId, carrier: shipment.carrier },
  });
  return { shipment, refreshed: await refreshPacketsForCharge(orgId, chargeId) };
}

export async function removeShipment(orgId: string, shipmentId: string): Promise<void> {
  const shipments = await shipmentsRepo.listRecent(orgId, 200);
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment || !(await shipmentsRepo.remove(orgId, shipmentId))) throw new NotFoundError("Shipment");
  await audit({ orgId, actor: "user", type: "shipment.removed", entityType: "shipment", entityId: shipmentId });
  await refreshPacketsForCharge(orgId, shipment.chargeId);
}

export type MessageLogsInput = {
  customerEmail: string;
  channel?: string;
  /** Local dispute id to link the messages to. */
  disputeId?: string | null;
  /** The pasted conversation. */
  transcript: string;
};

/**
 * Parses a pasted conversation (in the org's time zone) and saves every
 * message for the customer. Returns what was saved.
 */
export async function addMessageLogs(orgId: string, input: MessageLogsInput): Promise<{ saved: MessageLog[]; refreshed: number }> {
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  const email = input.customerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("invalid_input", "Enter the customer's email address.");
  const channel = (CHANNELS as readonly string[]).includes(input.channel ?? "email") ? ((input.channel ?? "email") as Channel) : "email";

  let disputeId: string | null = null;
  let customerName: string | null = null;
  if (input.disputeId) {
    const dispute = await disputesRepo.getById(orgId, input.disputeId);
    if (!dispute) throw new NotFoundError("Dispute");
    disputeId = dispute.id;
    customerName = dispute.customer.name ?? null;
  }

  const { messages } = parseTranscript(input.transcript, { timeZone: org.timezone, customerName, merchantName: org.name });
  if (messages.length === 0) {
    throw new ServiceError(
      "invalid_input",
      "No messages found. Start each message with a date, time and speaker, e.g. “2026-09-14 10:22 Customer: …”.",
    );
  }
  if (messages.length > MAX_BULK_MESSAGES) throw new ServiceError("invalid_input", `Paste at most ${MAX_BULK_MESSAGES} messages at a time.`);

  const saved = await asInvalidInput(() =>
    messageLogsRepo.bulkInsert(
      orgId,
      messages.map((m: ParsedMessage) => ({
        customerEmail: email,
        channel,
        occurredAt: new Date(m.occurredAt),
        direction: m.direction,
        body: m.body,
        disputeId,
      })),
    ),
  );
  await audit({
    orgId,
    actor: "user",
    type: "message_log.added",
    entityType: disputeId ? "dispute" : "message_log",
    entityId: disputeId ?? saved[0]?.id ?? null,
    input: { channel, count: saved.length },
  });
  return { saved, refreshed: await refreshPacketsForCustomer(orgId, email, disputeId) };
}

export async function removeMessageLog(orgId: string, messageLogId: string): Promise<void> {
  if (!(await messageLogsRepo.remove(orgId, messageLogId))) throw new NotFoundError("Message");
  await audit({ orgId, actor: "user", type: "message_log.removed", entityType: "message_log", entityId: messageLogId });
}
