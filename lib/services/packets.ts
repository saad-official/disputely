import "server-only";
import type Stripe from "stripe";
import { AiUnavailableError } from "@/lib/ai/generate";
import { generateNarrative, NARRATIVE_PROMPT_VERSION } from "@/lib/ai/prompts/narrative";
import * as attachmentsRepo from "@/lib/db/repositories/attachments";
import { AttachmentRejectedError } from "@/lib/db/repositories/attachments";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as libraryRepo from "@/lib/db/repositories/library";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as packetsRepo from "@/lib/db/repositories/packets";
import { PacketSubmittedError } from "@/lib/db/repositories/packets";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import { NEEDS_RESPONSE_STATUSES } from "@/lib/db/schema";
import type {
  AttachmentMeta,
  Dispute,
  Json,
  LibraryItem as DbLibraryItem,
  MessageLog as DbMessageLog,
  NarrativeMeta,
  Organization,
  PacketFields,
  PacketRecord,
  Shipment as DbShipment,
} from "@/lib/db/types";
import { assemblePacket, type AssembleResult, type AttachmentRef } from "@/lib/domain/assemble";
import { fieldKind, fieldLabel } from "@/lib/domain/fields";
import { clean } from "@/lib/domain/format";
import type { NarrativeVerification } from "@/lib/domain/guardrails";
import { getPlaybook } from "@/lib/domain/playbooks";
import {
  EVIDENCE_FIELD_KEYS,
  FieldSourceSchema,
  isEvidenceFieldKey,
  toStorageSource,
  type AssembledField,
  type EvidenceFieldKey,
  type FieldSource,
  type LibraryItem,
  type MessageLog,
  type NormalisedDispute,
  type Shipment,
} from "@/lib/domain/types";
import { renderPacketPdf } from "@/lib/pdf/packet";
import { buildEvidencePayload, type EvidenceAttachment, type EvidencePayload } from "@/lib/stripe/evidence";
import { NotFoundError, ServiceError } from "./errors";
import { assertCanSubmitViaApi, assertDisputeAllowance, isPlanLimitError, limitsFor } from "./plan-limits";
import { audit, errorText, nowFrom, type ServiceDeps } from "./shared";
import { getMerchantStripe, stripeFailure } from "./stripe-connection";
import { syncOneDispute } from "./sync";

/**
 * Packet lifecycle (spec 3.3-3.5): assemble from Stripe data and the
 * merchant's records, write the narrative under the guardrails, attach
 * files (uploaded to Stripe as dispute_evidence), render the PDF, submit.
 * A submitted packet is frozen by the repository; every write here turns
 * that into a ServiceError("conflict") with the reason.
 */

/** Longest merchant-entered value for one field (Stripe's per-field cap). */
export const MAX_MANUAL_CHARS = 20_000;

export type ManualValues = Partial<Record<EvidenceFieldKey, string>>;

export type BuildOptions = {
  /** Merchant overrides to merge in; an empty string clears that field's override. */
  manual?: ManualValues;
  actor?: "user" | "system" | "webhook" | "cron";
};

export type BuildResult = { packet: PacketRecord; assembled: AssembleResult; dispute: Dispute };

/* ------------------------------------------------------------------ */
/* Mapping between the DB rows and the domain shapes                   */
/* ------------------------------------------------------------------ */

export function isDemoDispute(dispute: Pick<Dispute, "charge" | "livemode">): boolean {
  return Boolean(dispute.charge?.demo) && !dispute.livemode;
}

export function toDomainDispute(d: Dispute): NormalisedDispute {
  const lineItems = (d.charge.lineItems ?? []).map((li) => ({
    description: li.description,
    quantity: li.quantity ?? null,
    amountCents: li.amountCents ?? null,
  }));
  return {
    id: d.stripeDisputeId,
    reason: d.reason,
    status: d.status,
    amountCents: d.amountCents,
    currency: d.currency,
    createdAt: d.openedAt.toISOString(),
    dueBy: d.dueBy ? d.dueBy.toISOString() : null,
    productLine: d.productLine,
    customer: { name: d.customer.name ?? null, email: d.customer.email ?? null, ip: d.customer.ipAddress ?? null },
    charge: {
      id: d.chargeId,
      createdAt: d.charge.createdAt ?? null,
      description: d.charge.orderRef && d.charge.description && !d.charge.description.includes(d.charge.orderRef)
        ? `${d.charge.description} (order ${d.charge.orderRef})`
        : (d.charge.description ?? (d.charge.orderRef ? `Order ${d.charge.orderRef}` : null)),
      receiptUrl: d.charge.receiptUrl ?? null,
      billingDetails: {
        name: d.customer.name ?? null,
        email: d.customer.email ?? null,
        address: d.customer.billingAddress ?? null,
      },
    },
    shipping: d.shipping
      ? {
          name: d.shipping.name ?? null,
          address: d.shipping.address ?? null,
          carrier: d.shipping.carrier ?? null,
          trackingNumber: d.shipping.trackingNumber ?? null,
        }
      : null,
    checkout: lineItems.length > 0 ? { lineItems, shippingAddress: null } : null,
  };
}

function toDomainLibrary(items: DbLibraryItem[]): LibraryItem[] {
  return items.map((i) => ({
    id: i.id,
    kind: i.kind,
    title: i.title,
    text: i.text,
    url: i.url,
    productLine: i.productLine,
    appliesTo: null,
    updatedAt: i.updatedAt.toISOString(),
  }));
}

function toDomainShipment(s: DbShipment): Shipment {
  return {
    id: s.id,
    chargeId: s.chargeId,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    proofUrl: s.proofUrl,
  };
}

function toDomainMessages(logs: DbMessageLog[], dispute: Dispute): MessageLog[] {
  const seen = new Set<string>();
  const out: MessageLog[] = [];
  for (const log of logs) {
    if (seen.has(log.id)) continue;
    seen.add(log.id);
    out.push({
      id: log.id,
      disputeId: log.disputeId === dispute.id ? dispute.stripeDisputeId : null,
      customerEmail: log.customerEmail,
      channel: log.channel,
      occurredAt: log.occurredAt.toISOString(),
      direction: log.direction,
      body: log.body,
    });
  }
  return out;
}

function toAttachmentRefs(attachments: AttachmentMeta[]): AttachmentRef[] {
  return attachments
    .filter((a) => isEvidenceFieldKey(a.field))
    .map((a) => ({ field: a.field as EvidenceFieldKey, fileId: a.stripeFileId ?? a.id, fileName: a.fileName }));
}

const BACK_TO_DOMAIN: Record<string, FieldSource> = {
  stripe: "stripe_charge",
  library: "library",
  message_log: "message_log",
  shipment: "shipment",
  attachment: "manual",
  merchant: "manual",
  model: "model",
};

/** Stored packet fields back to the assembler's shape, in Stripe's key order. */
export function storedToAssembled(fields: PacketFields): AssembledField[] {
  const out: AssembledField[] = [];
  for (const key of EVIDENCE_FIELD_KEYS) {
    const f = fields[key];
    if (!f || !f.value?.trim()) continue;
    const origin = FieldSourceSchema.safeParse(f.origin);
    const field: AssembledField = {
      key,
      value: f.value,
      source: origin.success ? origin.data : (BACK_TO_DOMAIN[f.source] ?? "manual"),
    };
    if (f.sourceLabel) field.sourceLabel = f.sourceLabel;
    if (f.sourceId) field.fileId = f.sourceId;
    out.push(field);
  }
  return out;
}

function assembledToStored(fields: AssembledField[], overrides: ReadonlySet<EvidenceFieldKey>): PacketFields {
  const out: PacketFields = {};
  for (const f of fields) {
    out[f.key] = {
      value: f.value,
      source: toStorageSource(f.source, Boolean(f.fileId) && f.source === "manual" && !overrides.has(f.key)),
      sourceLabel: f.sourceLabel ?? null,
      sourceId: f.fileId ?? null,
      origin: f.source,
      ...(overrides.has(f.key) ? { override: true } : {}),
    };
  }
  return out;
}

/** The merchant overrides recorded on a packet. */
export function overridesOf(fields: PacketFields): ManualValues {
  const manual: ManualValues = {};
  for (const [key, f] of Object.entries(fields)) {
    if (f.override && isEvidenceFieldKey(key) && f.value.trim()) manual[key] = f.value;
  }
  return manual;
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadOrg(orgId: string): Promise<Organization> {
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");
  return org;
}

async function loadDispute(orgId: string, disputeId: string): Promise<Dispute> {
  const dispute = await disputesRepo.getById(orgId, disputeId);
  if (!dispute) throw new NotFoundError("Dispute");
  return dispute;
}

function frozen(error: unknown): never {
  if (error instanceof PacketSubmittedError) throw new ServiceError("conflict", error.message, { cause: error });
  throw error;
}

/** Throws PlanLimitError when a Free org is past its 3 disputes this month (demo disputes never count). */
export async function assertWithinAllowance(org: Organization, dispute: Dispute): Promise<void> {
  if (limitsFor(org.plan).disputesPerMonth === null || isDemoDispute(dispute)) return;
  assertDisputeAllowance(org, await disputesRepo.allowanceRank(org.id, dispute));
}

/** True when the dispute is covered by the org's plan (for list badges). */
export async function isWithinAllowance(org: Organization, dispute: Dispute): Promise<boolean> {
  try {
    await assertWithinAllowance(org, dispute);
    return true;
  } catch (error) {
    if (isPlanLimitError(error)) return false;
    throw error;
  }
}

async function assembleFor(org: Organization, dispute: Dispute, packet: PacketRecord, manual: ManualValues) {
  const email = clean(dispute.customer.email);
  const [library, shipment, byCustomer, byDispute, attachments] = await Promise.all([
    libraryRepo.list(org.id),
    shipmentsRepo.findByCharge(org.id, dispute.chargeId),
    email ? messageLogsRepo.listForCustomer(org.id, email) : Promise.resolve([]),
    messageLogsRepo.listForDispute(org.id, dispute.id),
    attachmentsRepo.list(org.id, packet.id),
  ]);
  return assemblePacket({
    dispute: toDomainDispute(dispute),
    merchantName: org.name,
    libraryItems: toDomainLibrary(library),
    shipments: shipment ? [toDomainShipment(shipment)] : [],
    messageLogs: toDomainMessages([...byCustomer, ...byDispute], dispute),
    manual,
    attachments: toAttachmentRefs(attachments),
  });
}

function mergeManual(existing: ManualValues, patch: ManualValues | undefined): ManualValues {
  const merged: ManualValues = { ...existing };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!isEvidenceFieldKey(key)) throw new ServiceError("invalid_input", `Unknown evidence field: ${key}`);
    const v = (value ?? "").trim();
    if (v.length > MAX_MANUAL_CHARS) {
      throw new ServiceError("invalid_input", `${fieldLabel(key)} is too long (${MAX_MANUAL_CHARS.toLocaleString("en-US")} characters at most).`);
    }
    if (v) merged[key] = v;
    else delete merged[key];
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/**
 * Assembles (or re-assembles) the dispute's packet and persists fields,
 * missing list, completeness and playbook. Merchant overrides persist across
 * rebuilds. Status becomes "ready" once every required field is present.
 */
export async function buildPacket(orgId: string, disputeId: string, options: BuildOptions = {}): Promise<BuildResult> {
  const org = await loadOrg(orgId);
  const dispute = await loadDispute(orgId, disputeId);
  const existing = await packetsRepo.getByDispute(orgId, disputeId);
  if (existing?.status === "submitted") frozen(new PacketSubmittedError());
  await assertWithinAllowance(org, dispute);

  const { packet } = existing ? { packet: existing } : await packetsRepo.getOrCreateForDispute(orgId, disputeId);
  const manual = mergeManual(overridesOf(packet.fields), options.manual);
  const assembled = await assembleFor(org, dispute, packet, manual);
  const overrides = new Set(Object.keys(manual) as EvidenceFieldKey[]);
  const requiredMissing = assembled.missing.filter((m) => m.required).length;

  let updated: PacketRecord;
  try {
    updated = await packetsRepo.update(orgId, packet.id, {
      playbook: assembled.playbook.reason,
      fields: assembledToStored(assembled.fields, overrides),
      missing: assembled.missing.map((m) => m.key),
      completeness: assembled.completeness,
    });
    updated = await packetsRepo.setStatus(orgId, packet.id, requiredMissing === 0 ? "ready" : "draft");
  } catch (error) {
    frozen(error);
  }

  await audit({
    orgId,
    actor: options.actor ?? "user",
    type: "packet.assembled",
    entityType: "packet",
    entityId: packet.id,
    input: { disputeId, manualFields: options.manual ? Object.keys(options.manual) : [] },
    output: {
      playbook: assembled.playbook.reason,
      completeness: assembled.completeness,
      missing: assembled.missing.map((m) => m.key),
      fields: assembled.fields.length,
    },
  });
  return { packet: updated, assembled, dispute };
}

/* ------------------------------------------------------------------ */
/* Narrative                                                           */
/* ------------------------------------------------------------------ */

export type NarrativeResultSummary = { packet: PacketRecord; verifiedCount: number; removedCount: number; ok: boolean };

/**
 * Rebuilds the packet (so the facts are current), asks the model for the
 * statement, runs the guardrails, and stores the verified text plus what the
 * guardrails did. Throws AiUnavailableError when no model is configured.
 */
export async function writeNarrative(orgId: string, disputeId: string, deps?: ServiceDeps): Promise<NarrativeResultSummary> {
  const { packet, assembled, dispute } = await buildPacket(orgId, disputeId, { actor: "system" });
  let result: Awaited<ReturnType<typeof generateNarrative>>;
  try {
    result = await generateNarrative(
      {
        playbook: assembled.playbook,
        facts: assembled.facts,
        fields: assembled.fields,
        dispute: {
          id: dispute.stripeDisputeId,
          reason: dispute.reason,
          amountCents: dispute.amountCents,
          currency: dispute.currency,
          createdAt: dispute.openedAt.toISOString(),
        },
      },
      { generate: deps?.generate },
    );
  } catch (error) {
    await audit({
      orgId,
      actor: "agent",
      type: "packet.narrative_failed",
      entityType: "packet",
      entityId: packet.id,
      output: { error: error instanceof AiUnavailableError ? "ai_unavailable" : errorText(error).slice(0, 300) },
    });
    if (error instanceof AiUnavailableError) throw error;
    throw new ServiceError("unavailable", "The model could not write the statement just now. Try again in a minute.", {
      cause: error,
    });
  }

  const { verification, output, meta } = result;
  const narrativeMeta: NarrativeMeta = {
    verifiedFacts: verification.verified.map((v) => v.text),
    removedClaims: verification.removed.filter((r) => r.kind !== "length").map((r) => r.text),
    verified: verification.verified.map((v) => ({ text: v.text, kind: v.kind })),
    removed: verification.removed.map((r) => ({ text: r.text, kind: r.kind, claim: r.claim ?? null })),
    ok: verification.ok,
    confidence: output.confidence,
    model: meta.model,
    promptVersion: meta.promptVersion ?? NARRATIVE_PROMPT_VERSION,
    tokensIn: meta.tokensIn,
    tokensOut: meta.tokensOut,
    latencyMs: meta.latencyMs,
    generatedAt: nowFrom(deps).toISOString(),
  };

  let updated: PacketRecord;
  try {
    updated = await packetsRepo.update(orgId, packet.id, { narrative: output.narrative, narrativeMeta });
  } catch (error) {
    frozen(error);
  }
  await audit({
    orgId,
    actor: "agent",
    type: "packet.narrative_drafted",
    entityType: "packet",
    entityId: packet.id,
    input: { facts: assembled.facts.amounts.length + assembled.facts.dates.length + assembled.facts.names.length },
    output: {
      chars: output.narrative.length,
      verified: verification.verified.length,
      removed: verification.removed.map((r) => ({ kind: r.kind, claim: r.claim ?? null })),
      ok: verification.ok,
      confidence: output.confidence,
    },
    meta,
  });
  return {
    packet: updated,
    verifiedCount: verification.verified.length,
    removedCount: verification.removed.filter((r) => r.kind !== "length").length,
    ok: verification.ok,
  };
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export type UploadInput = { fileName: string; mimeType: string; bytes: Uint8Array };
export type UploadResult = { attachment: AttachmentMeta; stripeFileId: string | null; warning: string | null };

/** Evidence fields that take a file (Stripe File id). */
export const FILE_FIELD_KEYS = EVIDENCE_FIELD_KEYS.filter((k) => fieldKind(k) === "file");

/**
 * Stores the file on the packet, then uploads it to Stripe as a File with
 * purpose dispute_evidence and records the file id. A failed Stripe upload
 * keeps the local copy (it still appears in the PDF) and returns a warning.
 */
export async function uploadAttachment(
  orgId: string,
  disputeId: string,
  file: UploadInput,
  field: string,
  deps?: ServiceDeps,
): Promise<UploadResult> {
  if (!isEvidenceFieldKey(field) || fieldKind(field) !== "file") {
    throw new ServiceError("invalid_input", "Choose which evidence field this file supports.");
  }
  const org = await loadOrg(orgId);
  const dispute = await loadDispute(orgId, disputeId);
  await assertWithinAllowance(org, dispute);
  const { packet } = await packetsRepo.getOrCreateForDispute(orgId, disputeId);
  if (packet.status === "submitted") frozen(new PacketSubmittedError());

  let attachment: AttachmentMeta;
  try {
    attachment = await attachmentsRepo.add(orgId, packet.id, { ...file, field });
  } catch (error) {
    if (error instanceof AttachmentRejectedError) {
      throw new ServiceError(error.code === "too_large" ? "too_large" : "unsupported_file", error.message, { cause: error });
    }
    frozen(error);
  }

  let stripeFileId: string | null = null;
  let warning: string | null = null;
  if (!org.stripeRestrictedKeyCiphertext) {
    warning = "Saved here only: connect Stripe in Settings to upload it as evidence.";
  } else {
    try {
      const client = getMerchantStripe(org, deps);
      const uploaded = await client.files.create({
        file: { data: file.bytes, name: attachment.fileName, type: attachment.mimeType },
        purpose: "dispute_evidence",
      });
      stripeFileId = uploaded.id;
      attachment = (await attachmentsRepo.setStripeFileId(orgId, attachment.id, uploaded.id)) ?? attachment;
    } catch (error) {
      warning = `Saved here, but Stripe did not accept the upload: ${stripeFailure(error, "upload the file").message}`;
    }
  }

  await audit({
    orgId,
    actor: "user",
    type: "attachment.uploaded",
    entityType: "attachment",
    entityId: attachment.id,
    input: { field, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes },
    output: { stripeFileId, warning },
  });
  await buildPacket(orgId, disputeId, { actor: "system" });
  return { attachment, stripeFileId, warning };
}

export async function removeAttachment(orgId: string, disputeId: string, attachmentId: string): Promise<void> {
  const packet = await packetsRepo.getByDispute(orgId, disputeId);
  if (!packet) throw new NotFoundError("Packet");
  if (packet.status === "submitted") frozen(new PacketSubmittedError());
  const attachment = await attachmentsRepo.getWithBytes(orgId, attachmentId);
  if (!attachment || attachment.packetId !== packet.id) throw new NotFoundError("Attachment");
  await attachmentsRepo.remove(orgId, attachmentId);
  await audit({ orgId, actor: "user", type: "attachment.removed", entityType: "attachment", entityId: attachmentId });
  await buildPacket(orgId, disputeId, { actor: "system" });
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

function verificationFrom(narrative: string, meta: NarrativeMeta | null): NarrativeVerification | null {
  if (!meta) return null;
  return {
    narrative,
    verified: (meta.verified ?? (meta.verifiedFacts ?? []).map((text) => ({ text, kind: "id" }))) as NarrativeVerification["verified"],
    removed: (meta.removed ?? (meta.removedClaims ?? []).map((text) => ({ text, kind: "id" }))).map((r) => ({
      text: r.text,
      kind: r.kind,
      ...("claim" in r && r.claim ? { claim: r.claim } : {}),
    })) as NarrativeVerification["removed"],
    ok: meta.ok ?? true,
  };
}

/**
 * The packet PDF. Reuses the stored copy while the content is unchanged (any
 * content write clears it); otherwise renders and stores a fresh one. After
 * submission the first rendered copy is kept as the archive.
 */
export async function renderPdf(orgId: string, disputeId: string, deps?: ServiceDeps): Promise<{ bytes: Buffer; fileName: string }> {
  const org = await loadOrg(orgId);
  const dispute = await loadDispute(orgId, disputeId);
  let packet = await packetsRepo.getByDispute(orgId, disputeId);
  if (!packet) packet = (await buildPacket(orgId, disputeId, { actor: "system" })).packet;
  const fileName = `disputely-${dispute.stripeDisputeId}.pdf`;

  if (packet.hasPdf) {
    const stored = await packetsRepo.getPdf(orgId, packet.id);
    if (stored) return { bytes: stored, fileName };
  }

  const attachments = await attachmentsRepo.list(orgId, packet.id);
  const bytes = await renderPacketPdf({
    org: { name: org.name },
    dispute: {
      id: dispute.stripeDisputeId,
      reason: dispute.reason,
      amountCents: dispute.amountCents,
      currency: dispute.currency,
      dueBy: dispute.dueBy?.toISOString() ?? null,
      createdAt: dispute.openedAt.toISOString(),
      chargeId: dispute.chargeId,
      customerName: dispute.customer.name ?? null,
    },
    playbook: getPlaybook(dispute.reason),
    fields: storedToAssembled(packet.fields),
    narrative: packet.narrative,
    verification: verificationFrom(packet.narrative, packet.narrativeMeta),
    attachmentsList: attachments.map((a) => ({
      fileName: a.fileName,
      field: isEvidenceFieldKey(a.field) ? a.field : null,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      stripeFileId: a.stripeFileId,
    })),
    completeness: packet.completeness,
    generatedAt: nowFrom(deps),
  });
  try {
    await packetsRepo.setPdf(orgId, packet.id, bytes);
  } catch (error) {
    // A submitted packet that already has its archived copy: serve the fresh render without storing it.
    if (!(error instanceof PacketSubmittedError)) throw error;
  }
  await audit({
    orgId,
    actor: "user",
    type: "packet.pdf_rendered",
    entityType: "packet",
    entityId: packet.id,
    output: { bytes: bytes.byteLength },
  });
  return { bytes, fileName };
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type TestOutcome = "winning_evidence" | "losing_evidence";

export type SubmitOptions = {
  /** Must be true: the owner confirmed in the dialog. */
  confirm: boolean;
  /** Stripe test mode only: force the outcome. */
  testOutcome?: TestOutcome | null;
};

export type SubmitResult = { packet: PacketRecord; dispute: Dispute; payload: EvidencePayload };

/** What is kept of Stripe's response: the dispute without expanded objects. */
function slimDispute(d: Stripe.Dispute): Json {
  return {
    id: d.id,
    object: d.object,
    status: d.status,
    reason: d.reason,
    amount: d.amount,
    currency: d.currency,
    livemode: d.livemode,
    created: d.created,
    evidence_details: {
      due_by: d.evidence_details?.due_by ?? null,
      has_evidence: d.evidence_details?.has_evidence ?? null,
      past_due: d.evidence_details?.past_due ?? null,
      submission_count: d.evidence_details?.submission_count ?? null,
    },
  };
}

/** Attachments with a Stripe file id, newest first (Stripe takes one file per field; the newest wins). */
function evidenceAttachments(attachments: AttachmentMeta[]): EvidenceAttachment[] {
  return [...attachments]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((a) => a.stripeFileId && isEvidenceFieldKey(a.field))
    .map((a) => ({ field: a.field as EvidenceFieldKey, stripeFileId: a.stripeFileId! }));
}

/**
 * Submits the packet through `stripe.disputes.update(id, { evidence, submit: true })`
 * with the merchant's key, freezes it with the exact payload and Stripe's
 * response, then re-syncs the dispute.
 */
export async function submitPacket(
  orgId: string,
  disputeId: string,
  options: SubmitOptions,
  deps?: ServiceDeps,
): Promise<SubmitResult> {
  if (options.confirm !== true) throw new ServiceError("invalid_input", "Confirm the submission first.");
  const org = await loadOrg(orgId);
  const dispute = await loadDispute(orgId, disputeId);
  const packet = await packetsRepo.getByDispute(orgId, disputeId);
  if (!packet) throw new ServiceError("conflict", "Build the packet before submitting it.");
  if (packet.status === "submitted") frozen(new PacketSubmittedError());

  const demo = isDemoDispute(dispute);
  if (options.testOutcome) {
    if (dispute.livemode) throw new ServiceError("invalid_input", "Simulated outcomes only exist in Stripe test mode.");
    if (options.testOutcome !== "winning_evidence" && options.testOutcome !== "losing_evidence") {
      throw new ServiceError("invalid_input", "Unknown simulated outcome.");
    }
  }
  if (!(NEEDS_RESPONSE_STATUSES as readonly string[]).includes(dispute.status)) {
    throw new ServiceError("conflict", `Stripe no longer accepts evidence for this dispute (status ${dispute.status}).`);
  }
  if (dispute.evidenceDetails.pastDue || (dispute.dueBy && dispute.dueBy.getTime() <= nowFrom(deps).getTime())) {
    throw new ServiceError("conflict", "The evidence deadline has passed; Stripe will not accept a submission.");
  }
  assertCanSubmitViaApi(org, { demo });
  await assertWithinAllowance(org, dispute);

  const client = getMerchantStripe(org, deps);
  const attachments = await attachmentsRepo.list(orgId, packet.id);
  const payload = buildEvidencePayload(storedToAssembled(packet.fields), packet.narrative, evidenceAttachments(attachments), {
    testOutcome: options.testOutcome ?? undefined,
  });
  if (Object.keys(payload).length === 0) throw new ServiceError("invalid_input", "The packet is empty. Build it first.");

  let response: Stripe.Dispute;
  try {
    response = await client.disputes.update(dispute.stripeDisputeId, { evidence: payload, submit: true });
  } catch (error) {
    await audit({
      orgId,
      actor: "user",
      type: "packet.submit_failed",
      entityType: "packet",
      entityId: packet.id,
      output: { error: errorText(error).slice(0, 300) },
    });
    throw stripeFailure(error, "accept the evidence");
  }

  let submitted: PacketRecord;
  try {
    submitted = await packetsRepo.recordSubmission(orgId, packet.id, payload as Json, slimDispute(response), nowFrom(deps));
  } catch (error) {
    frozen(error);
  }
  await audit({
    orgId,
    actor: "user",
    type: "packet.submitted",
    entityType: "packet",
    entityId: packet.id,
    input: { disputeId, testOutcome: options.testOutcome ?? null, demo },
    output: { fields: Object.keys(payload), stripeStatus: response.status, completeness: packet.completeness },
  });

  let refreshed = dispute;
  try {
    refreshed = (await syncOneDispute(orgId, dispute.stripeDisputeId, { actor: "system" }, deps)).dispute;
  } catch (error) {
    console.error("[submit] re-sync failed", dispute.stripeDisputeId, errorText(error));
  }
  return { packet: submitted, dispute: refreshed, payload };
}
