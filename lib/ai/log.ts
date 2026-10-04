import "server-only";
import type { CallMeta } from "@/lib/ai/generate";
import type { Db } from "@/lib/db/client";
import { agentEvents } from "@/lib/db/schema";
import type { Actor, Json } from "@/lib/db/types";

export type { Actor } from "@/lib/db/types";

export type AgentEntityType =
  | "organization"
  | "document"
  | "chunk"
  | "library_answer"
  | "questionnaire"
  | "question"
  | "share_link";

export type AgentEventInput = {
  /** null for system events not tied to an organization (e.g. cron sweeps). */
  orgId: string | null;
  actor: Actor;
  /** Short dotted name, e.g. "document.indexed", "question.drafted", "question.approved". */
  type: string;
  entityType?: AgentEntityType;
  entityId?: string | null;
  input?: Json;
  output?: Json;
  /** When the event wraps a model call, attach its metadata. */
  meta?: CallMeta;
};

/**
 * Append-only audit trail. agent_events rejects UPDATE, DELETE and TRUNCATE
 * at the database level (drizzle/0002_agent_events_append_only.sql), so this
 * is the only write path. Logging must never break the main flow: errors are
 * reported to the console and swallowed.
 */
export async function logAgentEvent(db: Db, event: AgentEventInput): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      orgId: event.orgId,
      actor: event.actor,
      type: event.type,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      input: event.input ?? null,
      output: event.output ?? null,
      model: event.meta?.model ?? null,
      promptVersion: event.meta?.promptVersion ?? null,
      tokensIn: event.meta?.tokensIn ?? null,
      tokensOut: event.meta?.tokensOut ?? null,
      latencyMs: event.meta?.latencyMs ?? null,
    });
  } catch (error) {
    console.error("[agent_events] insert failed", error instanceof Error ? error.message : error, event.type);
  }
}
