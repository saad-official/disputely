/**
 * Row types inferred from lib/db/schema.ts. Type-only: safe to import from
 * client components (e.g. `Plan`, `DisputeStatus` in the app shell and lists).
 */
import type {
  agentEvents,
  attachments,
  disputes,
  libraryItems,
  memberships,
  messageLogs,
  organizations,
  outbox,
  packets,
  reminders,
  session,
  shipments,
  user,
} from "./schema";

export type { Db, DbHandle, Schema } from "./client";
export type {
  AttachmentMimeType,
  DisputeCharge,
  DisputeCustomer,
  DisputeEvidenceDetails,
  DisputeReason,
  DisputeShipping,
  DisputeStatus,
  FieldSource,
  NarrativeMeta,
  OutboxAttachment,
  PacketField,
  PacketFields,
  PostalAddress,
} from "./schema";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Plan = Organization["plan"];

export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = Membership["role"];

export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;

export type Packet = typeof packets.$inferSelect;
export type NewPacket = typeof packets.$inferInsert;
export type PacketStatus = Packet["status"];
/** A packet as reads return it: everything but the PDF bytes (see packets.getPdf). */
export type PacketRecord = Omit<Packet, "pdf"> & { hasPdf: boolean };

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
/** An attachment as list queries return it: everything but the bytes. */
export type AttachmentMeta = Omit<Attachment, "bytes">;

export type LibraryItem = typeof libraryItems.$inferSelect;
export type NewLibraryItem = typeof libraryItems.$inferInsert;
export type LibraryKind = LibraryItem["kind"];

export type MessageLog = typeof messageLogs.$inferSelect;
export type NewMessageLog = typeof messageLogs.$inferInsert;
export type Channel = MessageLog["channel"];
export type MessageDirection = MessageLog["direction"];

export type Shipment = typeof shipments.$inferSelect;
export type NewShipment = typeof shipments.$inferInsert;

export type Reminder = typeof reminders.$inferSelect;
export type ReminderKind = Reminder["kind"];

export type OutboxMessage = typeof outbox.$inferSelect;
export type NewOutboxMessage = typeof outbox.$inferInsert;

export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type Actor = AgentEvent["actor"];

/** An amount in one currency (minor units). Metrics never add across currencies. */
export type Money = { currency: string; amountCents: number };
