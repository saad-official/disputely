import { describe, expect, it } from "vitest";
import { deadlineLabel, dueReminderKinds } from "@/lib/domain/reminders";

const DUE = new Date("2026-10-20T23:59:59Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const before = (ms: number) => new Date(DUE.getTime() - ms);

describe("dueReminderKinds", () => {
  it.each([
    [8 * DAY, []],
    [7 * DAY + 1, []],
    [7 * DAY, ["due_7d"]],
    [5 * DAY, ["due_7d"]],
    [3 * DAY, ["due_7d", "due_3d"]],
    [2 * DAY, ["due_7d", "due_3d"]],
    [DAY + 1, ["due_7d", "due_3d"]],
    [DAY, ["due_7d", "due_3d", "due_1d"]],
    [1, ["due_7d", "due_3d", "due_1d"]],
    [0, []],
    [-HOUR, []],
  ])("%d ms before the deadline -> %j", (msBefore, kinds) => {
    expect(dueReminderKinds(DUE, before(msBefore))).toEqual(kinds);
  });

  it("accepts ISO strings", () => {
    expect(dueReminderKinds("2026-10-20T23:59:59Z", before(2 * DAY))).toEqual(["due_7d", "due_3d"]);
  });

  it("returns nothing without a usable deadline", () => {
    expect(dueReminderKinds(null, new Date())).toEqual([]);
    expect(dueReminderKinds("not a date", new Date())).toEqual([]);
    expect(dueReminderKinds(new Date(0), new Date(0))).toEqual([]);
  });

  it("returns nothing once the dispute no longer needs a response", () => {
    expect(dueReminderKinds(DUE, before(DAY), "under_review")).toEqual([]);
    expect(dueReminderKinds(DUE, before(DAY), "won")).toEqual([]);
    expect(dueReminderKinds(DUE, before(DAY), "needs_response")).toHaveLength(3);
    expect(dueReminderKinds(DUE, before(DAY), "warning_needs_response")).toHaveLength(3);
  });
});

describe("deadlineLabel", () => {
  it.each([
    [10 * DAY + 5 * HOUR, { days: 10, hours: 5, tone: "ok" }],
    [7 * DAY + HOUR, { days: 7, hours: 1, tone: "ok" }],
    [7 * DAY, { days: 7, hours: 0, tone: "soon" }],
    [4 * DAY + 23 * HOUR, { days: 4, hours: 23, tone: "soon" }],
    [3 * DAY + 1, { days: 3, hours: 0, tone: "soon" }],
    [3 * DAY, { days: 3, hours: 0, tone: "urgent" }],
    [5 * HOUR + 59 * 60_000, { days: 0, hours: 5, tone: "urgent" }],
    [1, { days: 0, hours: 0, tone: "urgent" }],
    [0, { days: 0, hours: 0, tone: "past" }],
    [-(DAY + 2 * HOUR), { days: 1, hours: 2, tone: "past" }],
  ])("%d ms left -> %j", (msLeft, expected) => {
    expect(deadlineLabel(DUE, before(msLeft))).toEqual(expected);
  });

  it("treats a missing deadline as past", () => {
    expect(deadlineLabel(null, new Date())).toEqual({ days: 0, hours: 0, tone: "past" });
  });
});
