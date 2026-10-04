import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DbHandle } from "@/lib/db/client";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as remindersRepo from "@/lib/db/repositories/reminders";
import type { Plan } from "@/lib/db/types";
import type { EmailProvider, OutgoingEmail } from "@/lib/email/provider";
import { runReminderSweep, timeLeftLabel } from "@/lib/services/reminders";
import { DAY_MS, insertOrg, startTestDb, stopTestDb, stripeDispute } from "../db/helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

function recordingProvider(fail = false): EmailProvider & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: "outbox",
    sent,
    async send(email) {
      if (fail) throw new Error("provider down");
      sent.push(email);
      return { provider: "outbox", providerMessageId: null, deliveredTo: email.to, demo: true };
    },
  };
}

async function orgWithDispute(plan: Plan, dueInMs: number, options: { remindersEnabled?: boolean } = {}) {
  const org = await insertOrg(handle, { plan, name: "Larkspur Goods" });
  await organizationsRepo.updateSettings(org.id, {
    reminderEmail: "ops@larkspur.example.com",
    remindersEnabled: options.remindersEnabled ?? true,
  });
  const now = new Date();
  const { dispute } = await disputesRepo.upsertFromStripe(
    org.id,
    stripeDispute({ amountCents: 18_400, reason: "product_not_received", dueBy: new Date(now.getTime() + dueInMs) }),
  );
  return { org, dispute, now };
}

describe("timeLeftLabel", () => {
  it("speaks in days, then hours, then minutes", () => {
    const now = new Date("2026-10-04T00:00:00Z");
    expect(timeLeftLabel(new Date("2026-10-07T05:00:00Z"), now)).toBe("3 days");
    expect(timeLeftLabel(new Date("2026-10-05T01:00:00Z"), now)).toBe("1 day");
    expect(timeLeftLabel(new Date("2026-10-04T20:00:00Z"), now)).toBe("20 hours");
    expect(timeLeftLabel(new Date("2026-10-04T00:30:00Z"), now)).toBe("30 minutes");
  });
});

describe("runReminderSweep", () => {
  it("claims each threshold once and sends one email for the most urgent", async () => {
    const { org, dispute, now } = await orgWithDispute("pro", 2 * DAY_MS + 3600_000);
    const provider = recordingProvider();

    const first = await runReminderSweep(now, { emailProvider: provider });
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const mine = provider.sent.filter((m) => m.subject.includes(dispute.stripeDisputeId));
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toBe("ops@larkspur.example.com");
    expect(mine[0].subject).toBe(`Dispute ${dispute.stripeDisputeId} ($184.00, product_not_received) is due in 2 days`);
    expect(mine[0].text).toContain(`/disputes/${dispute.id}`);
    expect((await remindersRepo.listForDispute(org.id, dispute.id)).map((r) => r.kind).sort()).toEqual(["due_3d", "due_7d"]);

    const outbox = await outboxRepo.listForOrg(org.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "deadline_reminder", disputeId: dispute.id, status: "sent" });

    // A second (or concurrent) sweep sends nothing new for this dispute.
    await runReminderSweep(now, { emailProvider: provider });
    expect(provider.sent.filter((m) => m.subject.includes(dispute.stripeDisputeId))).toHaveLength(1);
    expect(await outboxRepo.listForOrg(org.id)).toHaveLength(1);
  });

  it("skips Free organizations and organizations that turned reminders off", async () => {
    const free = await orgWithDispute("free", DAY_MS / 2);
    const off = await orgWithDispute("pro", DAY_MS / 2, { remindersEnabled: false });
    const provider = recordingProvider();
    await runReminderSweep(free.now, { emailProvider: provider });
    expect(provider.sent.some((m) => m.subject.includes(free.dispute.stripeDisputeId))).toBe(false);
    expect(provider.sent.some((m) => m.subject.includes(off.dispute.stripeDisputeId))).toBe(false);
    expect(await remindersRepo.listForDispute(free.org.id, free.dispute.id)).toHaveLength(0);
  });

  it("records a failed send in the outbox for the daily retry", async () => {
    const { org, now } = await orgWithDispute("pro", DAY_MS / 2);
    await runReminderSweep(now, { emailProvider: recordingProvider(true) });
    const outbox = await outboxRepo.listForOrg(org.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].status).toBe("failed");
  });
});
