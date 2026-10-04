import { describe, expect, it } from "vitest";
import { EVIDENCE_FIELD_META } from "@/lib/domain/fields";
import { getPlaybook, PLAYBOOKS } from "@/lib/domain/playbooks";
import { DISPUTE_REASONS, EVIDENCE_FIELD_KEYS, type DisputeReason } from "@/lib/domain/types";

const PLAYBOOK_REASONS = DISPUTE_REASONS.filter((r) => r !== "other");

describe("playbooks", () => {
  it("has a playbook for every reason with a dedicated playbook", () => {
    for (const reason of PLAYBOOK_REASONS) {
      expect(PLAYBOOKS[reason as Exclude<DisputeReason, "other">], reason).toBeDefined();
      expect(getPlaybook(reason).reason).toBe(reason);
    }
  });

  it("falls back to general for other", () => {
    const pb = getPlaybook("other");
    expect(pb.reason).toBe("general");
    expect(pb).toBe(PLAYBOOKS.general);
  });

  it.each(PLAYBOOK_REASONS)("%s: fields are known keys with no duplicates", (reason) => {
    const pb = getPlaybook(reason);
    const known = new Set<string>(EVIDENCE_FIELD_KEYS);
    const all = [...pb.required, ...pb.recommended];
    for (const key of all) expect(known.has(key), key).toBe(true);
    expect(new Set(pb.required).size).toBe(pb.required.length);
    expect(new Set(pb.recommended).size).toBe(pb.recommended.length);
    // required and recommended never overlap
    expect(pb.required.filter((k) => pb.recommended.includes(k))).toEqual([]);
    // the narrative field is produced by the model, never a checklist item
    expect(all).not.toContain("uncategorized_text");
    // merchant inputs reference known keys, no duplicates
    const inputKeys = pb.merchantInputs.map((m) => m.key);
    for (const key of inputKeys) expect(known.has(key), key).toBe(true);
    expect(new Set(inputKeys).size).toBe(inputKeys.length);
  });

  it.each(PLAYBOOK_REASONS)("%s: has copy for the UI and model", (reason) => {
    const pb = getPlaybook(reason);
    expect(pb.title.length).toBeGreaterThan(3);
    expect(pb.summary.length).toBeGreaterThan(60);
    expect(pb.winTips).toHaveLength(3);
    expect(pb.narrativeFocus.length).toBeGreaterThanOrEqual(3);
    expect(pb.required.length).toBeGreaterThanOrEqual(3);
    for (const key of pb.required) expect(EVIDENCE_FIELD_META[key]).toBeDefined();
  });

  it("asks for the reason-specific merchant inputs", () => {
    const keys = (r: DisputeReason) => getPlaybook(r).merchantInputs.map((m) => m.key);
    expect(keys("product_not_received")).toEqual(
      expect.arrayContaining(["shipping_tracking_number", "shipping_carrier", "shipping_date"]),
    );
    expect(keys("product_unacceptable")).toEqual(expect.arrayContaining(["refund_policy", "refund_policy_disclosure"]));
    expect(keys("credit_not_processed")).toEqual(expect.arrayContaining(["refund_policy", "refund_policy_disclosure"]));
    expect(keys("subscription_canceled")).toEqual(
      expect.arrayContaining(["cancellation_policy", "cancellation_policy_disclosure", "cancellation_rebuttal"]),
    );
    expect(keys("duplicate")).toEqual(expect.arrayContaining(["duplicate_charge_id", "duplicate_charge_explanation"]));
    expect(keys("fraudulent")).toEqual(
      expect.arrayContaining(["access_activity_log", "customer_purchase_ip", "service_date"]),
    );
    expect(keys("general")).toContain("customer_communication");
    expect(keys("unrecognized")).toContain("customer_communication");
  });

  it("requires the reason-defining fields", () => {
    expect(getPlaybook("product_not_received").required).toEqual(
      expect.arrayContaining(["shipping_tracking_number", "shipping_carrier", "shipping_address"]),
    );
    expect(getPlaybook("duplicate").required).toContain("duplicate_charge_id");
    expect(getPlaybook("subscription_canceled").required).toContain("cancellation_policy");
    expect(getPlaybook("credit_not_processed").required).toContain("refund_policy");
  });
});
