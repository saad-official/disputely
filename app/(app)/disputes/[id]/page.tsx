import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActivityList } from "@/components/disputes/activity";
import {
  CompletenessMeter,
  Countdown,
  DemoTag,
  DisputeState,
  FieldMark,
  ReasonChip,
  SourceTag,
  Stamp,
} from "@/components/disputes/parts";
import { fixLinks } from "@/components/packet/fix-links";
import { NARRATIVE_LIMIT, NarrativeMetaLine, NarrativeText, RemovedClaims } from "@/components/packet/narrative";
import {
  AttachmentsPanel,
  BuildPacketButton,
  EvidenceFields,
  GenerateNarrativeButton,
  PdfPanel,
  SubmitPanel,
  type FieldRowData,
  type SubmitGate,
} from "@/components/packet/packet-controls";
import { FormMessage } from "@/components/app/form-message";
import { requireOrgContext } from "@/lib/auth/session";
import * as agentEventsRepo from "@/lib/db/repositories/agentEvents";
import * as attachmentsRepo from "@/lib/db/repositories/attachments";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as packetsRepo from "@/lib/db/repositories/packets";
import { NEEDS_RESPONSE_STATUSES } from "@/lib/db/schema";
import type { PacketField, PacketRecord } from "@/lib/db/types";
import { EVIDENCE_FIELD_META, fieldKind } from "@/lib/domain/fields";
import { getPlaybook } from "@/lib/domain/playbooks";
import { deadlineLabel } from "@/lib/domain/reminders";
import { EVIDENCE_FIELD_KEYS, isEvidenceFieldKey, type EvidenceFieldKey } from "@/lib/domain/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { requestTime } from "@/lib/request-time";
import { buildPacket, isDemoDispute, isWithinAllowance } from "@/lib/services/packets";
import { isPlanLimitError, limitsFor } from "@/lib/services/plan-limits";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dispute packet" };

const ORIGIN_LABEL: Record<string, string> = {
  stripe_charge: "Stripe charge",
  stripe_customer: "Stripe customer",
  stripe_checkout: "Stripe Checkout",
  library: "Library",
  shipment: "Shipment record",
  message_log: "Message log",
  manual: "Entered by you",
  model: "Model",
};

function sourceLabel(f: PacketField): string {
  if (f.override) return "Entered by you";
  if (f.source === "attachment") return "File";
  return ORIGIN_LABEL[f.origin ?? ""] ?? ORIGIN_LABEL[f.source] ?? f.source;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asKey(value: string | undefined): EvidenceFieldKey | null {
  return value && isEvidenceFieldKey(value) ? value : null;
}

function Section({ id, title, aside, children, className }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("grid scroll-mt-20 gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SubmittedSnapshot({ packet, timezone }: { packet: PacketRecord; timezone: string }) {
  const snapshot = (packet.submittedSnapshot ?? {}) as Record<string, unknown>;
  const entries = Object.entries(snapshot).filter(([, v]) => typeof v === "string" && v);
  return (
    <div className="hatch rounded-lg bg-card p-4 shadow-card ring-1 ring-steel/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stamp tone="steel">Submitted</Stamp>
        <span className="font-mono text-xs text-foreground/75">{formatDateTime(packet.submittedAt, timezone)}</span>
      </div>
      <p className="mt-3 text-sm text-foreground/80">Exactly what Stripe received. The packet is frozen.</p>
      <dl className="mt-3 divide-y divide-border rounded-md bg-card ring-1 ring-foreground/10">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
            <dt className="font-mono text-xs text-foreground/70">{key}</dt>
            <dd className={cn("text-sm break-words whitespace-pre-wrap", /^file_/.test(String(value)) && "font-mono text-steel")}>
              {String(value).length > 600 ? `${String(value).slice(0, 600)}…` : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function DisputePage({ params, searchParams }: PageProps<"/disputes/[id]">) {
  const { org, role } = await requireOrgContext();
  const { id } = await params;
  const sp = await searchParams;
  const now = requestTime();
  const dispute = await disputesRepo.getById(org.id, id);
  if (!dispute) notFound();

  const within = await isWithinAllowance(org, dispute);
  let packet = await packetsRepo.getByDispute(org.id, dispute.id);
  let buildError: string | null = null;
  if (!packet && within) {
    try {
      packet = (await buildPacket(org.id, dispute.id, { actor: "system" })).packet;
    } catch (error) {
      if (!isPlanLimitError(error)) throw error;
      buildError = error.message;
    }
  }

  const playbook = getPlaybook(dispute.reason);
  const frozen = packet?.status === "submitted";
  const demo = isDemoDispute(dispute);
  const connected = Boolean(org.stripeRestrictedKeyCiphertext);
  const limits = limitsFor(org.plan);
  const deadline = deadlineLabel(dispute.dueBy, now);
  const needsResponse = (NEEDS_RESPONSE_STATUSES as readonly string[]).includes(dispute.status);
  const editable = Boolean(packet) && !frozen && within;

  const attachments = packet ? await attachmentsRepo.list(org.id, packet.id) : [];
  const history = await agentEventsRepo.listForEntity(org.id, [dispute.id, ...(packet ? [packet.id] : []), ...attachments.map((a) => a.id)], 15);

  const required = new Set<EvidenceFieldKey>(playbook.required);
  const recommended = new Set<EvidenceFieldKey>(playbook.recommended);
  const rows: FieldRowData[] = packet
    ? EVIDENCE_FIELD_KEYS.filter((k) => packet.fields[k]?.value?.trim()).map((key) => {
        const f = packet.fields[key]!;
        return {
          key,
          value: f.value,
          source: sourceLabel(f),
          sourceDetail: f.sourceLabel ?? (f.sourceId && /^file_/.test(f.sourceId) ? f.sourceId : null),
          override: Boolean(f.override),
          file: f.source === "attachment" || Boolean(f.sourceId),
          role: required.has(key) ? "required" : recommended.has(key) ? "recommended" : "extra",
        };
      })
    : [];
  const missing = (packet?.missing ?? []).filter(isEvidenceFieldKey);
  const requiredMissing = missing.filter((k) => required.has(k));
  const playbookKeys = [...playbook.required, ...playbook.recommended];
  const have = playbookKeys.length - missing.length;
  const fixContext = { disputeId: dispute.id, chargeId: dispute.chargeId, customerEmail: dispute.customer.email ?? null, canUseLibrary: limits.library };

  let gate: SubmitGate = { kind: "ok" };
  if (!needsResponse) gate = { kind: "closed", message: `Stripe no longer accepts evidence for this dispute (${dispute.status.replaceAll("_", " ")}).` };
  else if (deadline.tone === "past" || dispute.evidenceDetails.pastDue) gate = { kind: "closed", message: "The evidence deadline has passed." };
  else if (!connected) gate = { kind: "closed", message: "Connect Stripe in Settings to submit from here." };
  else if (role !== "owner") gate = { kind: "role", message: "Only the workspace owner can submit evidence." };
  else if (!within) gate = { kind: "plan", message: buildError ?? "This dispute is beyond the Free plan's 3 disputes this month." };
  else if (!limits.oneClickSubmit && !demo) {
    gate = {
      kind: "plan",
      message:
        "On Free you submit manually: download the PDF and upload it with the statement in your Stripe Dashboard. Pro submits it for you in one click.",
    };
  }

  const editKey = asKey(one(sp.edit));
  const attachKey = asKey(one(sp.attach));
  const narrativeFacts = packet?.narrativeMeta?.verified?.map((v) => v.text) ?? packet?.narrativeMeta?.verifiedFacts ?? [];
  const narrativeChars = packet?.narrative.length ?? 0;
  const filesOnStripe = attachments.filter((a) => a.stripeFileId).length;

  return (
    <>
      <Link href="/disputes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-foreground/75 hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Disputes
      </Link>

      {/* Header: the deadline first and largest, then what is at stake. */}
      <article className="relative overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
        <div aria-hidden="true" className={cn("h-1", needsResponse && !frozen ? "bg-oxide" : dispute.status === "won" ? "bg-olive" : "bg-steel")} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
          <span className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate font-mono text-sm font-medium tracking-normal">{dispute.stripeDisputeId}</h1>
            {demo ? <DemoTag /> : null}
            {dispute.livemode ? null : <SourceTag className="whitespace-nowrap">test mode</SourceTag>}
          </span>
          <DisputeState status={dispute.status} packetSubmitted={frozen} />
        </div>
        <div className="grid gap-6 px-4 pt-5 pb-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground/75">{needsResponse ? "Evidence due in" : "Deadline"}</p>
            {needsResponse ? (
              <Countdown deadline={deadline} hasDeadline={Boolean(dispute.dueBy)} size="xl" className="mt-2" />
            ) : (
              <p className="mt-2 font-heading text-3xl">{frozen ? "Submitted" : dispute.closedAt ? "Closed" : "With the bank"}</p>
            )}
            <p className="mt-3 font-mono text-xs text-foreground/75">
              Stripe <span className="text-foreground">due_by</span> {formatDateTime(dispute.dueBy, org.timezone)}
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-foreground/70">Amount</dt>
                <dd className="tabular mt-1 truncate font-mono text-sm">{formatMoney(dispute.amountCents, dispute.currency)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-foreground/70">Customer</dt>
                <dd className="mt-1 truncate text-sm">{dispute.customer.name ?? dispute.customer.email ?? "Unknown"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-foreground/70">{dispute.charge.orderRef ? "Order" : "Charge"}</dt>
                <dd className="mt-1 truncate font-mono text-sm">{dispute.charge.orderRef ?? dispute.chargeId}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-foreground/70">Opened</dt>
                <dd className="tabular mt-1 truncate font-mono text-sm">{formatDate(dispute.openedAt, org.timezone)}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-[0.6875rem] font-semibold text-foreground/70">Reason</span>
              <ReasonChip reason={dispute.reason} stripeReason={dispute.stripeReason} />
              <span className="text-sm text-foreground/80">{playbook.title} playbook</span>
            </div>
          </div>
          <div className="grid content-start gap-4 rounded-md bg-secondary p-4">
            {packet ? (
              <>
                <CompletenessMeter have={have} of={playbookKeys.length} percent={packet.completeness} />
                <p className="text-xs leading-relaxed text-foreground/80">
                  {missing.length === 0
                    ? "Every field this playbook asks for is filled."
                    : requiredMissing.length > 0
                      ? `${requiredMissing.length} required ${requiredMissing.length === 1 ? "field" : "fields"} missing.`
                      : `${missing.length} recommended ${missing.length === 1 ? "field" : "fields"} missing.`}{" "}
                  {packet.narrativeMeta ? <NarrativeCount verified={narrativeFacts.length} removed={(packet.narrativeMeta.removed ?? []).filter((r) => r.kind !== "length").length} /> : "No statement yet."}
                </p>
              </>
            ) : (
              <FormMessage error={buildError ?? "No packet yet."} upgradeUrl={buildError ? "/billing" : null} />
            )}
            {!frozen && packet ? (
              <SubmitPanel
                disputeId={dispute.id}
                stripeDisputeId={dispute.stripeDisputeId}
                gate={gate}
                demo={demo}
                livemode={dispute.livemode}
                requiredMissing={requiredMissing.map((k) => EVIDENCE_FIELD_META[k].label)}
                fieldCount={rows.length}
                fileCount={filesOnStripe}
                narrativeChars={narrativeChars}
              />
            ) : null}
          </div>
        </div>
      </article>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="grid min-w-0 content-start gap-10 lg:col-span-8">
          {frozen && packet ? <SubmittedSnapshot packet={packet} timezone={org.timezone} /> : null}

          {packet && missing.length > 0 && !frozen ? (
            <Section id="missing" title="Missing, and how to fix it">
              <ul className="divide-y divide-border rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
                {missing.map((key) => {
                  const meta = EVIDENCE_FIELD_META[key];
                  return (
                    <li key={key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 px-4 py-3">
                      <FieldMark present={false} />
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-semibold">{meta.label}</span>{" "}
                          <span className="font-mono text-[0.6875rem] text-oxide-ink">{key}</span>
                          <span className="ml-2 text-[0.6875rem] text-foreground/60">{required.has(key) ? "required" : "recommended"}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{meta.why}</p>
                        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                          {fixLinks(key, fixContext).map((link) => (
                            <Link key={link.href} href={link.href} className="text-xs font-semibold text-foreground underline decoration-foreground/35 underline-offset-3 hover:decoration-foreground">
                              {link.label}
                            </Link>
                          ))}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}

          {packet ? (
            <Section id="evidence" title="Evidence fields" aside={editable ? <BuildPacketButton disputeId={dispute.id} /> : null}>
              <EvidenceFields key={editKey ?? "none"} disputeId={dispute.id} rows={rows} editKey={editable ? editKey : null} frozen={!editable} />
            </Section>
          ) : null}

          {packet ? (
            <Section
              id="statement"
              title="Statement"
              aside={
                <span className={cn("tabular font-mono text-xs", narrativeChars > NARRATIVE_LIMIT ? "text-oxide-ink" : "text-foreground/70")}>
                  uncategorized_text · {narrativeChars.toLocaleString("en-US")} / 2,500 chars
                </span>
              }
            >
              <div className="overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
                <div className="relative px-4 py-5 sm:py-6 sm:pr-6 sm:pl-10">
                  <span aria-hidden="true" className="absolute inset-y-0 left-6 hidden w-px bg-oxide-ink/30 sm:block" />
                  {packet.narrative.trim() ? (
                    <NarrativeText narrative={packet.narrative} facts={narrativeFacts} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No statement yet. The model writes it from the assembled facts only; every date, amount, tracking number and
                      name it uses is checked against the evidence, and anything it cannot match is removed and shown here.
                    </p>
                  )}
                </div>
                <RemovedClaims meta={packet.narrativeMeta} />
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <NarrativeMetaLine meta={packet.narrativeMeta} timezone={org.timezone} />
                {editable ? <GenerateNarrativeButton disputeId={dispute.id} hasNarrative={Boolean(packet.narrative.trim())} /> : null}
              </div>
            </Section>
          ) : null}

          {packet ? (
            <Section id="attachments" title="Files">
              <AttachmentsPanel
                key={attachKey ?? "none"}
                disputeId={dispute.id}
                attachments={attachments.map((a) => ({
                  id: a.id,
                  fileName: a.fileName,
                  field: a.field,
                  mimeType: a.mimeType,
                  sizeBytes: a.sizeBytes,
                  stripeFileId: a.stripeFileId,
                }))}
                initialField={attachKey && fieldKind(attachKey) === "file" ? attachKey : null}
                frozen={!editable}
                connected={connected}
              />
            </Section>
          ) : null}
        </div>

        <aside className="grid min-w-0 content-start gap-6 lg:col-span-4">
          <section aria-labelledby="playbook-title" className="rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <p className="text-xs font-semibold text-foreground/70">Playbook</p>
            <h2 id="playbook-title" className="mt-1 text-lg">
              {playbook.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground/85">{playbook.summary}</p>
            <h3 className="mt-4 font-sans text-xs font-semibold tracking-normal text-foreground/70">What wins</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {playbook.winTips.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-oxide-ink" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 font-sans text-xs font-semibold tracking-normal text-foreground/70">Fields</h3>
            <ul className="mt-2 grid gap-1.5">
              {playbookKeys.map((key) => (
                <li key={key} className="flex items-start gap-2 text-sm">
                  <FieldMark present={Boolean(packet) && !missing.includes(key)} />
                  <span className="min-w-0">
                    {EVIDENCE_FIELD_META[key].label}
                    {required.has(key) ? <span className="ml-1 text-[0.6875rem] text-foreground/60">required</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {packet ? (
            <section aria-labelledby="pdf-title" className="rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10">
              <h2 id="pdf-title" className="text-base">
                Packet PDF
              </h2>
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                Cover, evidence table, statement with its fact check, and a file index. Use it to submit by hand or to keep a record.
              </p>
              <PdfPanel disputeId={dispute.id} />
            </section>
          ) : null}

          <section aria-labelledby="history-title" className="rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
            <h2 id="history-title" className="border-b border-border px-4 py-2.5 font-sans text-xs font-semibold tracking-normal text-foreground/75">
              History
            </h2>
            <ActivityList events={history} now={now} />
          </section>
        </aside>
      </div>
    </>
  );
}

function NarrativeCount({ verified, removed }: { verified: number; removed: number }) {
  return (
    <>
      Statement: <span className="font-semibold text-olive">{verified} facts verified</span>
      {removed ? `, ${removed} ${removed === 1 ? "claim" : "claims"} removed` : ""}.
    </>
  );
}
