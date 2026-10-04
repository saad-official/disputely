import { isAuthorizedCron, unauthorized } from "@/app/api/_lib/secrets";
import { runDailyMaintenance } from "@/lib/services/maintenance";

/**
 * Daily job (vercel.json: 06:00 UTC), `Authorization: Bearer <CRON_SECRET>`:
 * deadline reminders, re-sync of connected orgs (20 a run), failed email
 * retries. Returns a JSON summary.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();
  try {
    const result = await runDailyMaintenance();
    console.info(
      `[cron] daily: reminders ${"sent" in result.reminders ? result.reminders.sent : "failed"}, synced orgs ${result.sync.orgs}, outbox retried ${result.outbox.retried}`,
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron] daily failed", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "daily job failed" }, { status: 500 });
  }
}
