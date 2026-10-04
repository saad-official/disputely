import "server-only";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import { getEmailProvider } from "@/lib/email/provider";
import { runReminderSweep, type SweepResult } from "./reminders";
import { audit, errorText, nowFrom, type ServiceDeps } from "./shared";
import { syncDisputes } from "./sync";

/**
 * The daily cron (vercel.json, GET /api/cron/daily): deadline reminders,
 * then a re-sync of open disputes for connected organizations (the safety
 * net for missed or unroutable webhooks), then a retry of failed emails.
 * Each step is isolated: one failing never stops the others.
 */

export const SYNC_ORGS_PER_RUN = 20;
export const OUTBOX_RETRIES_PER_RUN = 20;

export type MaintenanceResult = {
  reminders: SweepResult | { error: string };
  sync: { orgs: number; synced: number; created: number; closed: number; failedOrgs: number };
  outbox: { retried: number; sent: number; failed: number };
};

async function resyncConnectedOrgs(deps?: ServiceDeps): Promise<MaintenanceResult["sync"]> {
  const out = { orgs: 0, synced: 0, created: 0, closed: 0, failedOrgs: 0 };
  const orgIds = await organizationsRepo.listConnectedForSync(SYNC_ORGS_PER_RUN);
  for (const orgId of orgIds) {
    out.orgs++;
    try {
      const result = await syncDisputes(orgId, { limit: 50, actor: "cron" }, deps);
      out.synced += result.synced;
      out.created += result.created;
      out.closed += result.closed;
    } catch (error) {
      out.failedOrgs++;
      console.error("[maintenance] sync failed", orgId, errorText(error));
    }
  }
  return out;
}

async function retryFailedOutbox(deps?: ServiceDeps): Promise<MaintenanceResult["outbox"]> {
  const out = { retried: 0, sent: 0, failed: 0 };
  const provider = deps?.emailProvider ?? getEmailProvider();
  for (const message of await outboxRepo.listFailed(OUTBOX_RETRIES_PER_RUN)) {
    out.retried++;
    try {
      const result = await provider.send({
        to: message.toEmail,
        subject: message.subject,
        text: message.text,
        html: message.html ?? undefined,
      });
      await outboxRepo.updateDelivery(message.id, {
        status: "sent",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        deliveredTo: result.deliveredTo,
      });
      out.sent++;
    } catch (error) {
      out.failed++;
      console.error("[maintenance] outbox retry failed", message.id, errorText(error));
    }
  }
  return out;
}

export async function runDailyMaintenance(deps?: ServiceDeps): Promise<MaintenanceResult> {
  const now = nowFrom(deps);
  let reminders: MaintenanceResult["reminders"];
  try {
    reminders = await runReminderSweep(now, deps);
  } catch (error) {
    reminders = { error: errorText(error) };
  }
  const sync = await resyncConnectedOrgs(deps).catch((error: unknown) => {
    console.error("[maintenance] sync step failed", errorText(error));
    return { orgs: 0, synced: 0, created: 0, closed: 0, failedOrgs: -1 };
  });
  const outbox = await retryFailedOutbox(deps).catch((error: unknown) => {
    console.error("[maintenance] outbox step failed", errorText(error));
    return { retried: 0, sent: 0, failed: -1 };
  });
  const result = { reminders, sync, outbox };
  await audit({ orgId: null, actor: "cron", type: "maintenance.daily", output: result });
  return result;
}
