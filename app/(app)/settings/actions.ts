"use server";

import { revalidatePath } from "next/cache";
import { actionError, formText } from "@/app/(app)/_lib/action-errors";
import type { ActionResult, FormActionState } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { updateProfile, updateReminders } from "@/lib/services/settings";
import { connectStripeKey, disconnectStripe } from "@/lib/services/stripe-connection";

function refreshAll() {
  revalidatePath("/", "layout");
}

/** The pasted key is only ever sent to Stripe once and stored encrypted; it is never echoed back. */
export async function connectStripeAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org, role } = await requireOrgContext();
  if (role !== "owner") return { ok: false, error: "Only the workspace owner can connect Stripe." };
  try {
    const result = await connectStripeKey(org.id, formText(formData, "key"), formText(formData, "label") || null);
    refreshAll();
    return { ok: true, message: `Connected (${result.mode} mode). Sync to pull your disputes.` };
  } catch (error) {
    return actionError(error, "stripe connect");
  }
}

export async function disconnectStripeAction(): Promise<ActionResult> {
  const { org, role } = await requireOrgContext();
  if (role !== "owner") return { ok: false, error: "Only the workspace owner can disconnect Stripe." };
  try {
    await disconnectStripe(org.id);
  } catch (error) {
    return actionError(error, "stripe disconnect");
  }
  refreshAll();
  return { ok: true, message: "Stripe disconnected. Synced disputes stay here." };
}

export async function updateProfileAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org } = await requireOrgContext();
  try {
    await updateProfile(org.id, { name: formText(formData, "name"), timezone: formText(formData, "timezone") });
  } catch (error) {
    return actionError(error, "profile update");
  }
  refreshAll();
  return { ok: true, message: "Saved." };
}

export async function updateRemindersAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { org } = await requireOrgContext();
  try {
    await updateReminders(org.id, { enabled: formData.get("enabled") === "on", email: formText(formData, "email") || null });
  } catch (error) {
    return actionError(error, "reminders update");
  }
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}
