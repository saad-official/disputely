import { needsResponse, type DisputeStatus } from "./types";

/** Deadline reminders at 7, 3 and 1 day before `due_by` (spec 3.6). */
export const REMINDER_KINDS = ["due_7d", "due_3d", "due_1d"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const REMINDER_THRESHOLDS_MS: Record<ReminderKind, number> = {
  due_7d: 7 * DAY_MS,
  due_3d: 3 * DAY_MS,
  due_1d: 1 * DAY_MS,
};

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  // Stripe reports due_by = 0 when the bank allows no response.
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Reminder kinds whose threshold has been crossed (time left <= threshold)
 * while the deadline is still ahead. The caller sends the ones not yet in
 * `reminders` (unique per dispute and kind), so a late sync sends only the
 * most relevant backlog once. When `status` is given, nothing is due unless
 * the dispute still needs a response.
 */
export function dueReminderKinds(
  dueBy: Date | string | null | undefined,
  now: Date,
  status?: DisputeStatus,
): ReminderKind[] {
  if (status && !needsResponse(status)) return [];
  const due = toTime(dueBy);
  if (due === null) return [];
  const left = due - now.getTime();
  if (left <= 0) return [];
  return REMINDER_KINDS.filter((k) => left <= REMINDER_THRESHOLDS_MS[k]);
}

export type DeadlineTone = "ok" | "soon" | "urgent" | "past";

export interface DeadlineLabel {
  /** Whole days left (or overdue, when tone is "past"). */
  days: number;
  /** Remaining whole hours after `days`. */
  hours: number;
  /** ok: > 7 days; soon: <= 7 days; urgent: <= 3 days; past: deadline passed or none. */
  tone: DeadlineTone;
}

export function deadlineLabel(dueBy: Date | string | null | undefined, now: Date): DeadlineLabel {
  const due = toTime(dueBy);
  if (due === null) return { days: 0, hours: 0, tone: "past" };
  const left = due - now.getTime();
  const abs = Math.abs(left);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / HOUR_MS);
  if (left <= 0) return { days, hours, tone: "past" };
  const tone: DeadlineTone =
    left <= REMINDER_THRESHOLDS_MS.due_3d ? "urgent" : left <= REMINDER_THRESHOLDS_MS.due_7d ? "soon" : "ok";
  return { days, hours, tone };
}
