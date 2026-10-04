import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { logAgentEvent } from "@/lib/ai/log";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretbox";
import { MIGRATIONS_CONFIG, migrationsFolder, type DbHandle } from "@/lib/db/client";
import * as attachmentsRepo from "@/lib/db/repositories/attachments";
import { AttachmentRejectedError } from "@/lib/db/repositories/attachments";
import { findOrgForStripe } from "@/lib/db/repositories/billing";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as libraryRepo from "@/lib/db/repositories/library";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as metricsRepo from "@/lib/db/repositories/metrics";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as packetsRepo from "@/lib/db/repositories/packets";
import { PacketSubmittedError } from "@/lib/db/repositories/packets";
import * as remindersRepo from "@/lib/db/repositories/reminders";
import { NotFoundError } from "@/lib/db/repositories/shared";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import { agentEvents, organizations, packets } from "@/lib/db/schema";
import type { DisputeStatus } from "@/lib/db/types";
import {
  DAY_MS,
  dbErrorMessage,
  insertOrg,
  JPEG_BYTES,
  PDF_BYTES,
  PNG_BYTES,
  queryRows,
  startTestDb,
  stopTestDb,
  stripeDispute,
} from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

describe("migrations", () => {
  it("creates every table in the disputely schema and nothing in public", async () => {
    const rows = await queryRows<{ table_schema: string; table_name: string }>(
      handle,
      sql`select table_schema, table_name from information_schema.tables
          where table_schema in ('disputely', 'public', 'drizzle') order by table_name`,
    );
    expect(rows.every((r) => r.table_schema === "disputely")).toBe(true);
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [
        "__drizzle_migrations",
        "account",
        "agent_events",
        "attachments",
        "disputes",
        "library_items",
        "memberships",
        "message_logs",
        "organizations",
        "outbox",
        "packets",
        "reminders",
        "session",
        "shipments",
        "user",
        "verification",
      ].sort(),
    );
  });

  it("builds the hot-path indexes and needs no extensions", async () => {
    const indexes = await queryRows<{ indexname: string }>(
      handle,
      sql`select indexname from pg_indexes where schemaname = 'disputely'`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        "disputes_org_stripe_dispute_key",
        "disputes_org_status_due_idx",
        "packets_org_status_idx",
        "packets_dispute_id_unique",
        "library_items_org_kind_idx",
        "message_logs_org_customer_idx",
        "shipments_org_charge_key",
        "reminders_dispute_kind_key",
      ]),
    );
    const ext = await queryRows<{ extname: string }>(handle, sql`select extname from pg_extension where extname <> 'plpgsql'`);
    expect(ext).toEqual([]);
  });

  it("cascades every tenant table from organizations", async () => {
    const rows = await queryRows<{ table_name: string; delete_rule: string }>(
      handle,
      sql`select tc.table_name, rc.delete_rule
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
          join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
          where tc.table_schema = 'disputely' and tc.constraint_type = 'FOREIGN KEY' and kcu.column_name = 'org_id'`,
    );
    const tables = rows.map((r) => r.table_name).sort();
    expect(tables).toEqual(
      [
        "agent_events",
        "attachments",
        "disputes",
        "library_items",
        "memberships",
        "message_logs",
        "outbox",
        "packets",
        "reminders",
        "shipments",
      ].sort(),
    );
    expect(rows.every((r) => r.delete_rule === "CASCADE")).toBe(true);
  });

  it("is idempotent", async () => {
    await expect(
      migrate(handle.db as never, { migrationsFolder: migrationsFolder(), ...MIGRATIONS_CONFIG }),
    ).resolves.toBeUndefined();
  });
});

describe("agent_events (append-only)", () => {
  it("accepts inserts, rejects UPDATE / DELETE / TRUNCATE, and still cascades on org delete", async () => {
    const org = await insertOrg(handle);
    await logAgentEvent(handle.db, {
      orgId: org.id,
      actor: "system",
      type: "dispute.synced",
      entityType: "organization",
      entityId: org.id,
      output: { created: 1 },
    });
    const [event] = await handle.db.select().from(agentEvents).where(eq(agentEvents.orgId, org.id));
    expect(event.type).toBe("dispute.synced");

    expect(await dbErrorMessage(handle.db.update(agentEvents).set({ type: "x" }).where(eq(agentEvents.id, event.id)))).toMatch(
      /append-only \(UPDATE rejected\)/,
    );
    expect(await dbErrorMessage(handle.db.delete(agentEvents).where(eq(agentEvents.id, event.id)))).toMatch(
      /append-only \(DELETE rejected\)/,
    );
    expect(await dbErrorMessage(handle.db.execute(sql`truncate disputely.agent_events`))).toMatch(/TRUNCATE rejected/);

    await handle.db.delete(organizations).where(eq(organizations.id, org.id));
    expect(await handle.db.select().from(agentEvents).where(eq(agentEvents.orgId, org.id))).toEqual([]);
  });
});

describe("organizations", () => {
  it("applies settings with validation", async () => {
    const org = await insertOrg(handle);
    expect(org).toMatchObject({ timezone: "UTC", plan: "free", remindersEnabled: true, reminderEmail: null });
    const updated = await organizationsRepo.updateSettings(org.id, {
      name: "  Larkspur Goods ",
      timezone: "America/New_York",
      remindersEnabled: false,
      reminderEmail: " Ops@Larkspur.example ",
    });
    expect(updated).toMatchObject({
      name: "Larkspur Goods",
      timezone: "America/New_York",
      remindersEnabled: false,
      reminderEmail: "ops@larkspur.example",
    });
    await expect(organizationsRepo.updateSettings(org.id, { timezone: "Mars/Base" })).rejects.toThrow(/time zone/);
    await expect(organizationsRepo.updateSettings(org.id, { name: "  " })).rejects.toThrow(/empty/);
    await expect(organizationsRepo.updateSettings(org.id, { reminderEmail: "nope" })).rejects.toThrow(/email/);
    expect((await organizationsRepo.updateSettings(org.id, { reminderEmail: null }))?.reminderEmail).toBeNull();
  });

  it("stores only encrypted Stripe keys and clears them", async () => {
    const previous = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      const org = await insertOrg(handle);
      await expect(organizationsRepo.setStripeKey(org.id, "rk_test_plaintext", "x")).rejects.toThrow(/not encrypted/);
      const ciphertext = encryptSecret(org.id, "rk_test_FixtureKey0003");
      const connected = await organizationsRepo.setStripeKey(org.id, ciphertext, "Larkspur Goods (rk_test_…1234)");
      expect(connected?.stripeRestrictedKeyCiphertext).toBe(ciphertext);
      expect(connected?.stripeAccountLabel).toBe("Larkspur Goods (rk_test_…1234)");
      expect(connected?.stripeKeyConnectedAt).toBeInstanceOf(Date);
      const reread = await organizationsRepo.getById(org.id);
      expect(decryptSecret(org.id, reread!.stripeRestrictedKeyCiphertext!)).toBe("rk_test_FixtureKey0003");

      const cleared = await organizationsRepo.clearStripeKey(org.id);
      expect(cleared).toMatchObject({ stripeRestrictedKeyCiphertext: null, stripeAccountLabel: null, stripeKeyConnectedAt: null });
    } finally {
      if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = previous;
    }
  });

  it("sets the plan with subscription details and finds the org for Stripe webhooks", async () => {
    const org = await insertOrg(handle);
    const periodEnd = new Date("2026-11-04T00:00:00Z");
    const pro = await organizationsRepo.setPlan(org.id, {
      plan: "pro",
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_test_1",
      subscriptionStatus: "active",
      currentPeriodEnd: periodEnd,
    });
    expect(pro).toMatchObject({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: periodEnd });
    expect((await findOrgForStripe({ subscriptionId: "sub_test_1" }))?.id).toBe(org.id);
    expect((await findOrgForStripe({ orgId: "not-a-uuid", customerId: "cus_test_1" }))?.id).toBe(org.id);
    expect(await organizationsRepo.getById("not-a-uuid")).toBeNull();
  });
});

describe("disputes", () => {
  it("upserts idempotently on the Stripe dispute id, per organization", async () => {
    const org = await insertOrg(handle);
    const other = await insertOrg(handle);
    const input = stripeDispute({ reason: "bank_cannot_process" });

    const first = await disputesRepo.upsertFromStripe(org.id, input);
    expect(first.created).toBe(true);
    expect(first.dispute).toMatchObject({
      orgId: org.id,
      reason: "other",
      stripeReason: "bank_cannot_process",
      status: "needs_response",
      amountCents: 12_900,
      currency: "usd",
      closedAt: null,
    });

    const replay = await disputesRepo.upsertFromStripe(org.id, input);
    expect(replay.created).toBe(false);
    expect(replay.dispute.id).toBe(first.dispute.id);
    expect(replay.dispute.syncedAt.getTime()).toBeGreaterThanOrEqual(first.dispute.syncedAt.getTime());

    const elsewhere = await disputesRepo.upsertFromStripe(other.id, input);
    expect(elsewhere.created).toBe(true);
    expect(elsewhere.dispute.id).not.toBe(first.dispute.id);

    const { total } = await disputesRepo.listAll(org.id);
    expect(total).toBe(1);
    expect(await disputesRepo.getById(other.id, first.dispute.id)).toBeNull();
    expect((await disputesRepo.getByStripeId(org.id, input.stripeDisputeId))?.id).toBe(first.dispute.id);
  });

  it("stamps closed_at once on a final status and clears it if Stripe reopens", async () => {
    const org = await insertOrg(handle);
    const input = stripeDispute({ status: "warning_needs_response" });
    await disputesRepo.upsertFromStripe(org.id, input);

    const won = await disputesRepo.upsertFromStripe(org.id, { ...input, status: "warning_closed" });
    expect(won.dispute.closedAt).toBeInstanceOf(Date);
    const again = await disputesRepo.upsertFromStripe(org.id, { ...input, status: "warning_closed" });
    expect(again.dispute.closedAt?.getTime()).toBe(won.dispute.closedAt?.getTime());

    const reopened = await disputesRepo.upsertFromStripe(org.id, { ...input, status: "needs_response" });
    expect(reopened.dispute.closedAt).toBeNull();
  });

  it("keeps the merchant's outcome note across syncs", async () => {
    const org = await insertOrg(handle);
    const input = stripeDispute({ status: "under_review" });
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, input);
    const noted = await disputesRepo.markOutcome(org.id, dispute.id, { status: "won", note: " Bank accepted tracking. " });
    expect(noted).toMatchObject({ status: "won", outcomeNote: "Bank accepted tracking." });
    expect(noted?.closedAt).toBeInstanceOf(Date);
    const synced = await disputesRepo.upsertFromStripe(org.id, { ...input, status: "won" });
    expect(synced.dispute.outcomeNote).toBe("Bank accepted tracking.");
    await expect(disputesRepo.markOutcome(org.id, dispute.id, { status: "under_review" as never })).rejects.toThrow(/final/);
  });

  it("lists open disputes by deadline (no deadline last) and filters needs-response", async () => {
    const org = await insertOrg(handle);
    const now = Date.now();
    const late = await disputesRepo.upsertFromStripe(org.id, stripeDispute({ dueBy: new Date(now + 9 * DAY_MS) }));
    const soon = await disputesRepo.upsertFromStripe(org.id, stripeDispute({ dueBy: new Date(now + 2 * DAY_MS) }));
    const review = await disputesRepo.upsertFromStripe(
      org.id,
      stripeDispute({ status: "under_review", dueBy: new Date(now + 5 * DAY_MS) }),
    );
    const noDeadline = await disputesRepo.upsertFromStripe(
      org.id,
      stripeDispute({ status: "warning_under_review", dueBy: null }),
    );
    await disputesRepo.upsertFromStripe(org.id, stripeDispute({ status: "lost", dueBy: new Date(now + DAY_MS) }));

    const open = await disputesRepo.listOpen(org.id);
    expect(open.map((d) => d.id)).toEqual([soon.dispute.id, review.dispute.id, late.dispute.id, noDeadline.dispute.id]);
    const needs = await disputesRepo.listOpen(org.id, { needsResponseOnly: true });
    expect(needs.map((d) => d.id)).toEqual([soon.dispute.id, late.dispute.id]);
    expect(await disputesRepo.countNeedsResponse(org.id)).toBe(2);

    const due = await disputesRepo.dueWithin(org.id, 3);
    expect(due.map((d) => d.id)).toEqual([soon.dispute.id]);
    expect(await disputesRepo.orgIdsWithDisputesDueWithin(3)).toContain(org.id);
  });

  it("paginates listAll with a status filter and total", async () => {
    const org = await insertOrg(handle);
    const base = Date.now() - 10 * DAY_MS;
    for (let i = 0; i < 5; i++) {
      await disputesRepo.upsertFromStripe(org.id, stripeDispute({ openedAt: new Date(base + i * DAY_MS), status: i < 3 ? "won" : "lost" }));
    }
    const page1 = await disputesRepo.listAll(org.id, { status: "won", limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].openedAt.getTime()).toBeGreaterThan(page1.items[1].openedAt.getTime());
    const page2 = await disputesRepo.listAll(org.id, { status: "won", limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(1);
    expect((await disputesRepo.listAll(org.id, { status: ["won", "lost"] })).total).toBe(5);
    expect(await disputesRepo.listAll(org.id, { status: [] })).toEqual({ items: [], total: 0 });
  });

  it("counts disputes opened this UTC month for the Free limit", async () => {
    const org = await insertOrg(handle);
    const now = new Date("2026-10-15T12:00:00Z");
    await disputesRepo.upsertFromStripe(org.id, stripeDispute({ openedAt: new Date("2026-10-01T00:00:00Z") }));
    await disputesRepo.upsertFromStripe(org.id, stripeDispute({ openedAt: new Date("2026-10-31T23:59:59Z") }));
    await disputesRepo.upsertFromStripe(org.id, stripeDispute({ openedAt: new Date("2026-09-30T23:59:59Z") }));
    await disputesRepo.upsertFromStripe(org.id, stripeDispute({ openedAt: new Date("2026-11-01T00:00:00Z") }));
    expect(await disputesRepo.countThisMonth(org.id, now)).toBe(2);
  });
});

describe("packets", () => {
  it("getOrCreateForDispute creates one packet per dispute, even concurrently", async () => {
    const org = await insertOrg(handle);
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute({ reason: "product_not_received" }));

    const results = await Promise.all([
      packetsRepo.getOrCreateForDispute(org.id, dispute.id),
      packetsRepo.getOrCreateForDispute(org.id, dispute.id),
      packetsRepo.getOrCreateForDispute(org.id, dispute.id),
    ]);
    expect(new Set(results.map((r) => r.packet.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0].packet).toMatchObject({
      playbook: "product_not_received",
      status: "draft",
      completeness: 0,
      missing: [],
      fields: {},
      hasPdf: false,
    });
    const rows = await handle.db.select({ id: packets.id }).from(packets).where(eq(packets.disputeId, dispute.id));
    expect(rows).toHaveLength(1);

    const again = await packetsRepo.getOrCreateForDispute(org.id, dispute.id);
    expect(again.created).toBe(false);

    const other = await insertOrg(handle);
    await expect(packetsRepo.getOrCreateForDispute(other.id, dispute.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updates content, clamps completeness, clears a stale PDF, and freezes on submission", async () => {
    const org = await insertOrg(handle);
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
    const { packet } = await packetsRepo.getOrCreateForDispute(org.id, dispute.id, { playbook: "fraudulent" });

    await packetsRepo.setPdf(org.id, packet.id, PDF_BYTES);
    expect((await packetsRepo.getById(org.id, packet.id))?.hasPdf).toBe(true);
    expect((await packetsRepo.getPdf(org.id, packet.id))?.equals(PDF_BYTES)).toBe(true);

    const updated = await packetsRepo.update(org.id, packet.id, {
      fields: { customer_name: { value: "Jamie Rivera", source: "stripe" } },
      narrative: "On 2 October the customer bought...",
      narrativeMeta: { verifiedFacts: ["2 October"], removedClaims: [] },
      completeness: 104.6,
      missing: ["shipping_documentation"],
    });
    expect(updated).toMatchObject({ completeness: 100, missing: ["shipping_documentation"], hasPdf: false });
    expect(updated.fields.customer_name).toEqual({ value: "Jamie Rivera", source: "stripe" });
    expect((await packetsRepo.update(org.id, packet.id, { completeness: -3 })).completeness).toBe(0);

    expect((await packetsRepo.setStatus(org.id, packet.id, "ready")).status).toBe("ready");
    const submitted = await packetsRepo.recordSubmission(
      org.id,
      packet.id,
      { customer_name: "Jamie Rivera" },
      { id: dispute.stripeDisputeId, status: "under_review" },
    );
    expect(submitted).toMatchObject({ status: "submitted", submittedSnapshot: { customer_name: "Jamie Rivera" } });
    expect(submitted.submittedAt).toBeInstanceOf(Date);

    await expect(packetsRepo.update(org.id, packet.id, { narrative: "changed" })).rejects.toBeInstanceOf(PacketSubmittedError);
    await expect(packetsRepo.setStatus(org.id, packet.id, "draft")).rejects.toBeInstanceOf(PacketSubmittedError);
    await expect(packetsRepo.recordSubmission(org.id, packet.id, {}, {})).rejects.toBeInstanceOf(PacketSubmittedError);
    // The archived PDF may be rendered once after submission, never replaced.
    expect((await packetsRepo.setPdf(org.id, packet.id, PDF_BYTES)).hasPdf).toBe(true);
    await expect(packetsRepo.setPdf(org.id, packet.id, PDF_BYTES)).rejects.toBeInstanceOf(PacketSubmittedError);

    const other = await insertOrg(handle);
    await expect(packetsRepo.update(other.id, packet.id, { narrative: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await packetsRepo.getByDispute(other.id, dispute.id)).toBeNull();
  });
});

describe("attachments", () => {
  async function newPacket() {
    const org = await insertOrg(handle);
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
    const { packet } = await packetsRepo.getOrCreateForDispute(org.id, dispute.id);
    return { org, packet };
  }

  it("stores PDF, PNG and JPEG files and lists them without bytes", async () => {
    const { org, packet } = await newPacket();
    const pdf = await attachmentsRepo.add(org.id, packet.id, {
      fileName: "tracking.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      field: "shipping_documentation",
    });
    expect(pdf).toMatchObject({ fileName: "tracking.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.length, field: "shipping_documentation" });
    expect("bytes" in pdf).toBe(false);
    await attachmentsRepo.add(org.id, packet.id, { fileName: "chat.png", mimeType: "image/png", bytes: PNG_BYTES });
    const jpg = await attachmentsRepo.add(org.id, packet.id, { fileName: "label.jpg", mimeType: "image/jpg", bytes: JPEG_BYTES });
    expect(jpg).toMatchObject({ mimeType: "image/jpeg", field: "uncategorized_file" });

    const listed = await attachmentsRepo.list(org.id, packet.id);
    expect(listed.map((a) => a.fileName)).toEqual(["tracking.pdf", "chat.png", "label.jpg"]);
    expect(listed.every((a) => !("bytes" in a))).toBe(true);

    const full = await attachmentsRepo.getWithBytes(org.id, pdf.id);
    expect(full?.bytes.equals(PDF_BYTES)).toBe(true);
    expect((await attachmentsRepo.setStripeFileId(org.id, pdf.id, "file_test_1"))?.stripeFileId).toBe("file_test_1");

    const other = await insertOrg(handle);
    expect(await attachmentsRepo.getWithBytes(other.id, pdf.id)).toBeNull();
    expect(await attachmentsRepo.remove(other.id, pdf.id)).toBe(false);
    expect(await attachmentsRepo.remove(org.id, pdf.id)).toBe(true);
    expect(await attachmentsRepo.list(org.id, packet.id)).toHaveLength(2);
  });

  it("rejects files over 5 MB, unsupported types, mismatched bytes and empty files", async () => {
    const { org, packet } = await newPacket();
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(5 * 1024 * 1024)]);
    await expect(
      attachmentsRepo.add(org.id, packet.id, { fileName: "big.pdf", mimeType: "application/pdf", bytes: big }),
    ).rejects.toMatchObject({ name: "AttachmentRejectedError", code: "too_large" });
    await expect(
      attachmentsRepo.add(org.id, packet.id, { fileName: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("hi") }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      attachmentsRepo.add(org.id, packet.id, { fileName: "fake.png", mimeType: "image/png", bytes: PDF_BYTES }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      attachmentsRepo.add(org.id, packet.id, { fileName: "empty.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(0) }),
    ).rejects.toBeInstanceOf(AttachmentRejectedError);

    // Exactly 5 MB is allowed.
    const max = Buffer.concat([PDF_BYTES, Buffer.alloc(5 * 1024 * 1024 - PDF_BYTES.length)]);
    const ok = await attachmentsRepo.add(org.id, packet.id, { fileName: "max.pdf", mimeType: "application/pdf", bytes: max });
    expect(ok.sizeBytes).toBe(5 * 1024 * 1024);
    expect(await attachmentsRepo.list(org.id, packet.id)).toHaveLength(1);
  });

  it("refuses new files on a submitted packet", async () => {
    const { org, packet } = await newPacket();
    await packetsRepo.recordSubmission(org.id, packet.id, {}, {});
    await expect(
      attachmentsRepo.add(org.id, packet.id, { fileName: "late.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
    ).rejects.toBeInstanceOf(PacketSubmittedError);
  });
});

describe("library", () => {
  it("creates, updates, lists by kind and deletes, scoped to the org", async () => {
    const org = await insertOrg(handle);
    const refund = await libraryRepo.create(org.id, {
      kind: "refund_policy",
      title: " Refunds ",
      text: "Refunds within 30 days of delivery.",
      url: "https://larkspur.example/refunds",
    });
    expect(refund).toMatchObject({ title: "Refunds", url: "https://larkspur.example/refunds", productLine: null });
    await libraryRepo.create(org.id, { kind: "disclosure", title: "Checkout checkbox", text: "Customers tick ...", productLine: "Linens" });
    await expect(libraryRepo.create(org.id, { kind: "terms", title: "T", text: "x", url: "javascript:alert(1)" })).rejects.toThrow(/http/);
    await expect(libraryRepo.create(org.id, { kind: "terms", title: " ", text: "x" })).rejects.toThrow(/title/);

    const renamed = await libraryRepo.update(org.id, refund.id, { title: "Refund policy", url: null });
    expect(renamed).toMatchObject({ title: "Refund policy", url: null });
    expect((await libraryRepo.listByKind(org.id, "refund_policy")).map((i) => i.id)).toEqual([refund.id]);
    expect((await libraryRepo.list(org.id)).map((i) => i.kind)).toEqual(["refund_policy", "disclosure"]);
    expect(await libraryRepo.list(org.id, { productLine: "Linens" })).toHaveLength(1);

    const other = await insertOrg(handle);
    expect(await libraryRepo.getById(other.id, refund.id)).toBeNull();
    expect(await libraryRepo.update(other.id, refund.id, { title: "x" })).toBeNull();
    expect(await libraryRepo.remove(other.id, refund.id)).toBe(false);
    expect(await libraryRepo.remove(org.id, refund.id)).toBe(true);
  });
});

describe("message logs", () => {
  it("normalises emails, lists per customer in time order and attaches to a dispute", async () => {
    const org = await insertOrg(handle);
    const t0 = new Date("2026-09-20T10:00:00Z");
    await messageLogsRepo.add(org.id, {
      customerEmail: " Jamie@Example.com ",
      occurredAt: new Date(t0.getTime() + DAY_MS),
      direction: "outbound",
      body: "Your order shipped today.",
    });
    const inserted = await messageLogsRepo.bulkInsert(org.id, [
      { customerEmail: "jamie@example.com", channel: "chat", occurredAt: t0, direction: "inbound", body: "Where is my order?" },
      { customerEmail: "jamie@example.com", occurredAt: new Date(t0.getTime() + 3 * DAY_MS), direction: "inbound", body: "Got it, thanks!" },
      { customerEmail: "someone@else.example", occurredAt: t0, direction: "inbound", body: "Hi" },
    ]);
    expect(inserted).toHaveLength(3);

    const all = await messageLogsRepo.listForCustomer(org.id, "JAMIE@example.com");
    expect(all.map((m) => m.body)).toEqual(["Where is my order?", "Your order shipped today.", "Got it, thanks!"]);
    expect(all.every((m) => m.customerEmail === "jamie@example.com")).toBe(true);
    const since = await messageLogsRepo.listForCustomer(org.id, "jamie@example.com", { since: new Date(t0.getTime() + DAY_MS) });
    expect(since).toHaveLength(2);

    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
    expect(await messageLogsRepo.attachToDispute(org.id, all.map((m) => m.id), dispute.id)).toBe(3);
    expect(await messageLogsRepo.listForDispute(org.id, dispute.id)).toHaveLength(3);

    const other = await insertOrg(handle);
    expect(await messageLogsRepo.listForCustomer(other.id, "jamie@example.com")).toEqual([]);
    await expect(messageLogsRepo.attachToDispute(other.id, [all[0].id], dispute.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bulk insert is all-or-nothing", async () => {
    const org = await insertOrg(handle);
    await expect(
      messageLogsRepo.bulkInsert(org.id, [
        { customerEmail: "a@b.example", occurredAt: new Date(), direction: "inbound", body: "ok" },
        { customerEmail: "not-an-email", occurredAt: new Date(), direction: "inbound", body: "bad" },
      ]),
    ).rejects.toThrow(/email/);
    expect(await messageLogsRepo.listForCustomer(org.id, "a@b.example")).toEqual([]);
  });
});

describe("shipments", () => {
  it("upserts one shipment per charge, keeping fields not passed", async () => {
    const org = await insertOrg(handle);
    const created = await shipmentsRepo.upsertByCharge(org.id, "ch_123", {
      carrier: "USPS",
      trackingNumber: "9400 1000 0000 0000 0000 00",
      shippedAt: new Date("2026-09-21T00:00:00Z"),
    });
    expect(created).toMatchObject({ carrier: "USPS", trackingNumber: "9400100000000000000000", deliveredAt: null });
    const delivered = await shipmentsRepo.upsertByCharge(org.id, "ch_123", {
      deliveredAt: new Date("2026-09-24T00:00:00Z"),
      addressMatch: true,
      proofUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400",
    });
    expect(delivered.id).toBe(created.id);
    expect(delivered).toMatchObject({ carrier: "USPS", addressMatch: true });
    expect(delivered.deliveredAt).toEqual(new Date("2026-09-24T00:00:00Z"));
    expect((await shipmentsRepo.upsertByCharge(org.id, "ch_123", {})).id).toBe(created.id);
    await expect(
      shipmentsRepo.upsertByCharge(org.id, "ch_9", { shippedAt: new Date("2026-09-05"), deliveredAt: new Date("2026-09-01") }),
    ).rejects.toThrow(/before/);

    const other = await insertOrg(handle);
    expect(await shipmentsRepo.findByCharge(other.id, "ch_123")).toBeNull();
    expect((await shipmentsRepo.findByCharge(org.id, "ch_123"))?.id).toBe(created.id);
  });
});

describe("reminders", () => {
  it("markSent is idempotent per dispute and kind", async () => {
    const org = await insertOrg(handle);
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
    expect(await remindersRepo.hasSent(org.id, dispute.id, "due_7d")).toBe(false);
    const claims = await Promise.all([
      remindersRepo.markSent(org.id, dispute.id, "due_7d"),
      remindersRepo.markSent(org.id, dispute.id, "due_7d"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await remindersRepo.markSent(org.id, dispute.id, "due_7d")).toBe(false);
    expect(await remindersRepo.markSent(org.id, dispute.id, "due_3d")).toBe(true);
    expect(await remindersRepo.hasSent(org.id, dispute.id, "due_7d")).toBe(true);
    expect(await remindersRepo.hasSent(org.id, dispute.id, "due_1d")).toBe(false);
    expect((await remindersRepo.listForDispute(org.id, dispute.id)).map((r) => r.kind)).toEqual(["due_7d", "due_3d"]);

    const other = await insertOrg(handle);
    await expect(remindersRepo.markSent(other.id, dispute.id, "due_1d")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("outbox", () => {
  it("inserts and lists newest first, optionally per dispute", async () => {
    const org = await insertOrg(handle);
    const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
    await outboxRepo.insert(org.id, { toEmail: "ops@larkspur.example", subject: "Digest", text: "..." });
    const reminder = await outboxRepo.insert(org.id, {
      toEmail: "ops@larkspur.example",
      subject: "Evidence due in 3 days",
      text: "...",
      kind: "deadline_reminder",
      disputeId: dispute.id,
    });
    expect(reminder).toMatchObject({ provider: "outbox", status: "queued", attachments: [] });
    expect(await outboxRepo.listForOrg(org.id)).toHaveLength(2);
    expect((await outboxRepo.listForOrg(org.id, { disputeId: dispute.id })).map((m) => m.id)).toEqual([reminder.id]);
  });
});

describe("metrics", () => {
  it("computes win rate as won / (won + lost) per reason, ignoring refunds and open disputes", async () => {
    const org = await insertOrg(handle);
    const add = (reason: string, status: DisputeStatus, amountCents = 10_000, currency = "usd") =>
      disputesRepo.upsertFromStripe(org.id, stripeDispute({ reason, status, amountCents, currency }));
    await add("fraudulent", "won", 10_000);
    await add("fraudulent", "won", 5_000);
    await add("fraudulent", "lost");
    await add("product_not_received", "lost");
    await add("general", "charge_refunded");
    await add("duplicate", "needs_response", 2_500);
    await add("duplicate", "under_review", 1_000, "eur");
    await add("credit_not_processed", "won", 7_000, "eur");

    const { overall, byReason } = await metricsRepo.winRateByReason(org.id);
    expect(overall).toEqual({ won: 3, lost: 2, winRate: 0.6 });
    expect(byReason.fraudulent.winRate).toBeCloseTo(2 / 3);
    expect(byReason.product_not_received).toEqual({ won: 0, lost: 1, winRate: 0 });
    expect(byReason.general).toEqual({ won: 0, lost: 0, winRate: null });
    expect(byReason.credit_not_processed.winRate).toBe(1);
    expect(Object.keys(byReason)).toHaveLength(9);
    expect(metricsRepo.winRateOf(0, 0).winRate).toBeNull();

    expect(await metricsRepo.recoveredCents(org.id)).toEqual([
      { currency: "usd", amountCents: 15_000 },
      { currency: "eur", amountCents: 7_000 },
    ]);
    expect(await metricsRepo.openAtStake(org.id)).toEqual({
      count: 2,
      atStake: [
        { currency: "usd", amountCents: 2_500 },
        { currency: "eur", amountCents: 1_000 },
      ],
    });
    const counts = await metricsRepo.countsByStatus(org.id);
    expect(counts).toMatchObject({ won: 3, lost: 2, charge_refunded: 1, needs_response: 1, under_review: 1, prevented: 0 });

    const future = new Date(Date.now() + DAY_MS);
    expect((await metricsRepo.winRateByReason(org.id, { since: future })).overall.winRate).toBeNull();
  });

  it("takes the median completeness of submitted packets only", async () => {
    const org = await insertOrg(handle);
    expect(await metricsRepo.medianSubmittedCompleteness(org.id)).toBeNull();
    for (const [completeness, submit] of [[40, true], [80, true], [95, true], [10, false]] as const) {
      const { dispute } = await disputesRepo.upsertFromStripe(org.id, stripeDispute());
      const { packet } = await packetsRepo.getOrCreateForDispute(org.id, dispute.id);
      await packetsRepo.update(org.id, packet.id, { completeness });
      if (submit) await packetsRepo.recordSubmission(org.id, packet.id, {}, {});
    }
    expect(await metricsRepo.medianSubmittedCompleteness(org.id)).toBe(80);
  });
});
