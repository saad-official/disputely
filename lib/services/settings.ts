import "server-only";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { Organization } from "@/lib/db/types";
import { asInvalidInput, NotFoundError } from "./errors";
import { audit } from "./shared";

/**
 * Organization settings: name, time zone (deadline display, pasted
 * transcripts, reminder emails) and deadline reminders. Reminder emails are
 * a Pro feature; the switch is stored on any plan and takes effect on Pro.
 */

export type ProfileInput = { name: string; timezone: string };
export type ReminderInput = { enabled: boolean; email?: string | null };

async function apply(orgId: string, patch: organizationsRepo.OrganizationSettings, type: string): Promise<Organization> {
  const org = await asInvalidInput(() => organizationsRepo.updateSettings(orgId, patch));
  if (!org) throw new NotFoundError("Organization");
  await audit({ orgId, actor: "user", type, entityType: "organization", entityId: orgId, input: { fields: Object.keys(patch) } });
  return org;
}

export async function updateProfile(orgId: string, input: ProfileInput): Promise<Organization> {
  return apply(orgId, { name: input.name, timezone: input.timezone.trim() }, "settings.profile_updated");
}

export async function updateReminders(orgId: string, input: ReminderInput): Promise<Organization> {
  return apply(orgId, { remindersEnabled: input.enabled, reminderEmail: input.email ?? null }, "settings.reminders_updated");
}
