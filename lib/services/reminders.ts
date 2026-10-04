import "server-only";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as remindersRepo from "@/lib/db/repositories/reminders";
import type { Dispute, Organization, ReminderKind } from "@/lib/db/types";
import { formatMoney } from "@/lib/domain/format";
import { dueReminderKinds, REMINDER_KINDS } from "@/lib/domain/reminders";
import { getEmailProvider, type EmailProvider } from "@/lib/email/provider";
import { limitsFor } from "./plan-limits";
import { appOrigin, audit, errorText, nowFrom, textToHtml, type ServiceDeps } from "./shared";

/**
 * Deadline reminders at 7, 3 and 1 day before `due_by` (spec 3.6), Pro only.
 * Each (dispute, kind) is claimed in `reminders` before anything is sent
 * (`markSent` returns true only for the claimer), so overlapping sweeps send
 * once. When a late sweep finds several thresholds crossed at once (e.g. a
 * dispute synced with 2 days left), all of them are claimed and one email
 * goes out for the most urgent.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const REMINDER_WINDOW_DAYS = 7;

export type SweepResult = { orgs: number; considered: number; sent: number; skippedOrgs: number; failed: number };

/** "3 days", "1 day", "20 hours", "45 minutes". */
export function timeLeftLabel(dueBy: Date, now: Date): string {
  const left = dueBy.getTime() - now.getTime();
  if (left >= DAY_MS) {
    const days = Math.floor(left / DAY_MS);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (left >= HOUR_MS) {
    const hours = Math.floor(left / HOUR_MS);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const minutes = Math.max(1, Math.floor(left / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function reminderEmail(org: Pick<Organization, "name" | "timezone">, dispute: Dispute, now: Date) {
  const amount = formatMoney(dispute.amountCents, dispute.currency);
  const left = dispute.dueBy ? timeLeftLabel(dispute.dueBy, now) : "soon";
  const reason = dispute.stripeReason ?? dispute.reason;
  const link = `${appOrigin()}/disputes/${dispute.id}`;
  const due = dispute.dueBy
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: org.timezone,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(dispute.dueBy)
    : "unknown";
  const subject = `Dispute ${dispute.stripeDisputeId} (${amount}, ${reason}) is due in ${left}`;
  const text = [
    `The evidence for dispute ${dispute.stripeDisputeId} at ${org.name} is due in ${left} (${due}).`,
    "",
    `Amount: ${amount}`,
    `Reason: ${reason}`,
    dispute.customer.name ? `Customer: ${dispute.customer.name}` : "",
    "",
    `Review and submit the packet: ${link}`,
    "",
    "Disputely sends these reminders 7, 3 and 1 day before a deadline. Turn them off in Settings.",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
  return { subject, text, html: textToHtml(text) };
}

async function sendOne(
  org: Organization,
  to: string,
  dispute: Dispute,
  now: Date,
  provider: EmailProvider,
): Promise<boolean> {
  const email = reminderEmail(org, dispute, now);
  try {
    const result = await provider.send({ to, subject: email.subject, text: email.text, html: email.html });
    await outboxRepo.insert(org.id, {
      kind: "deadline_reminder",
      disputeId: dispute.id,
      toEmail: to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      deliveredTo: result.deliveredTo,
      status: "sent",
    });
    return true;
  } catch (error) {
    await outboxRepo.insert(org.id, {
      kind: "deadline_reminder",
      disputeId: dispute.id,
      toEmail: to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      provider: provider.name,
      status: "failed",
    });
    console.error("[reminders] send failed", dispute.id, errorText(error));
    return false;
  }
}

/** The most urgent of the kinds (due_1d before due_3d before due_7d). */
function mostUrgent(kinds: ReminderKind[]): ReminderKind {
  return [...kinds].sort((a, b) => REMINDER_KINDS.indexOf(b) - REMINDER_KINDS.indexOf(a))[0];
}

export async function runReminderSweep(now: Date = new Date(), deps?: ServiceDeps): Promise<SweepResult> {
  const at = deps?.now ? nowFrom(deps) : now;
  const provider = deps?.emailProvider ?? getEmailProvider();
  const result: SweepResult = { orgs: 0, considered: 0, sent: 0, skippedOrgs: 0, failed: 0 };
  const orgIds = await disputesRepo.orgIdsWithDisputesDueWithin(REMINDER_WINDOW_DAYS, at);

  for (const orgId of orgIds) {
    result.orgs++;
    try {
      const org = await organizationsRepo.getById(orgId);
      if (!org || !org.remindersEnabled || !limitsFor(org.plan).reminders) {
        result.skippedOrgs++;
        continue;
      }
      const to = org.reminderEmail ?? (await organizationsRepo.getOwnerEmail(orgId));
      if (!to) {
        result.skippedOrgs++;
        continue;
      }
      for (const dispute of await disputesRepo.dueWithin(orgId, REMINDER_WINDOW_DAYS, at)) {
        result.considered++;
        const claimed: ReminderKind[] = [];
        for (const kind of dueReminderKinds(dispute.dueBy, at, dispute.status)) {
          if (await remindersRepo.markSent(orgId, dispute.id, kind, at)) claimed.push(kind);
        }
        if (claimed.length === 0) continue;
        const kind = mostUrgent(claimed);
        const ok = await sendOne(org, to, dispute, at, provider);
        if (ok) result.sent++;
        else result.failed++;
        await audit({
          orgId,
          actor: "cron",
          type: ok ? "reminder.sent" : "reminder.failed",
          entityType: "dispute",
          entityId: dispute.id,
          output: { kind, claimed, dueBy: dispute.dueBy?.toISOString() ?? null },
        });
      }
    } catch (error) {
      result.failed++;
      console.error("[reminders] org sweep failed", orgId, errorText(error));
    }
  }
  return result;
}
