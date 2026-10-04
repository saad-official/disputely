import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { agentEvents } from "../schema";
import type { AgentEvent } from "../types";
import { clampLimit, isUuid } from "./shared";

/** Read side of the append-only audit trail (writes go through lib/ai/log.ts). */

export type AgentEventSummary = Pick<
  AgentEvent,
  "id" | "actor" | "type" | "entityType" | "entityId" | "model" | "createdAt" | "output"
>;

const SUMMARY = {
  id: agentEvents.id,
  actor: agentEvents.actor,
  type: agentEvents.type,
  entityType: agentEvents.entityType,
  entityId: agentEvents.entityId,
  model: agentEvents.model,
  createdAt: agentEvents.createdAt,
  output: agentEvents.output,
};

/** The organization's newest events (the dashboard's recent activity). Inputs are never returned. */
export async function listRecent(orgId: string, limit = 12): Promise<AgentEventSummary[]> {
  if (!isUuid(orgId)) return [];
  const db = await getDb();
  return db
    .select(SUMMARY)
    .from(agentEvents)
    .where(eq(agentEvents.orgId, orgId))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(clampLimit(limit, 12, 100));
}

/** One entity's events, newest first (a dispute's history on the packet page). */
export async function listForEntity(orgId: string, entityIds: readonly string[], limit = 30): Promise<AgentEventSummary[]> {
  const ids = entityIds.filter(isUuid);
  if (!isUuid(orgId) || ids.length === 0) return [];
  const db = await getDb();
  return db
    .select(SUMMARY)
    .from(agentEvents)
    .where(and(eq(agentEvents.orgId, orgId), inArray(agentEvents.entityId, ids)))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(clampLimit(limit, 30, 100));
}
