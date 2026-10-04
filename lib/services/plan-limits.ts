import { MAX_ATTACHMENT_BYTES } from "@/lib/db/schema";
import type { Organization, Plan } from "@/lib/db/types";

/**
 * Plan limits (spec 2). Free: up to 3 disputes a month (counted by Stripe's
 * dispute creation date, UTC calendar month), manual submit, packet PDF,
 * reason-code playbook. Pro: unlimited disputes, policy library, product-line
 * templates, one-click submit, analytics, deadline reminders.
 *
 * How the services apply them:
 * - Disputes a month: a Free org can build packets for the first 3 non-demo
 *   disputes Stripe opened in each UTC calendar month (by `opened_at`, ties by
 *   id). Later ones stay visible and synced, but packet work is refused with
 *   an upgrade link. Demo disputes never count.
 * - One-click submit (the Stripe Disputes API): Pro. Free submits manually in
 *   the Stripe Dashboard using the packet PDF, except demo disputes (Stripe
 *   test mode), which Free may submit so the demo runs end to end.
 * - Library: saving or editing policy library items is Pro; Free can read and
 *   delete what is there (the demo seeds it). Product-line templates are Pro.
 * - Reminders and the analytics page are Pro.
 */
export const FREE_DISPUTES_PER_MONTH = 3;
export const PRO_PRICE_USD = 29;

/** Largest upload accepted (Stripe's per-file evidence limit). */
export const MAX_UPLOAD_BYTES = MAX_ATTACHMENT_BYTES;

export type PlanLimits = {
  /** null = unlimited. */
  disputesPerMonth: number | null;
  library: boolean;
  productLineTemplates: boolean;
  oneClickSubmit: boolean;
  analytics: boolean;
  reminders: boolean;
};

export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  free: {
    disputesPerMonth: FREE_DISPUTES_PER_MONTH,
    library: false,
    productLineTemplates: false,
    oneClickSubmit: false,
    analytics: false,
    reminders: false,
  },
  pro: {
    disputesPerMonth: null,
    library: true,
    productLineTemplates: true,
    oneClickSubmit: true,
    analytics: true,
    reminders: true,
  },
};

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export type PlanLimitCode =
  | "disputes_per_month"
  | "library"
  | "product_line_templates"
  | "one_click_submit"
  | "analytics"
  | "reminders";

/**
 * Thrown when an action exceeds the organization's plan. API routes map it to
 * HTTP 402; screens show `message` with an upgrade link to /billing.
 */
export class PlanLimitError extends Error {
  readonly code: PlanLimitCode;
  /** The limit that was hit (null for Pro-only features). */
  readonly limit: number | null;
  /** Current usage, when it applies. */
  readonly used: number | null;
  readonly upgradeUrl = "/billing";

  constructor(code: PlanLimitCode, message: string, details: { limit?: number | null; used?: number | null } = {}) {
    super(message);
    this.name = "PlanLimitError";
    this.code = code;
    this.limit = details.limit ?? null;
    this.used = details.used ?? null;
  }
}

export function isPlanLimitError(error: unknown): error is PlanLimitError {
  return error instanceof PlanLimitError || (error instanceof Error && error.name === "PlanLimitError");
}

/** Throws PlanLimitError when a Free org has already used its disputes this month. */
export function assertDisputeAllowance(org: Pick<Organization, "plan">, usedThisMonth: number): void {
  const limit = limitsFor(org.plan).disputesPerMonth;
  if (limit === null || usedThisMonth < limit) return;
  throw new PlanLimitError(
    "disputes_per_month",
    `Free covers ${limit} disputes a month and this month's are used. Upgrade to Pro for unlimited disputes.`,
    { limit, used: usedThisMonth },
  );
}

/** Throws PlanLimitError unless the org may submit through the Stripe API (Pro, or a demo dispute). */
export function assertCanSubmitViaApi(org: Pick<Organization, "plan">, dispute: { demo: boolean }): void {
  if (limitsFor(org.plan).oneClickSubmit || dispute.demo) return;
  throw new PlanLimitError(
    "one_click_submit",
    "Free covers the packet and its PDF; submitting through Stripe from here is a Pro feature. Download the PDF and submit it in your Stripe Dashboard, or upgrade to Pro for one-click submit.",
  );
}

/** Throws PlanLimitError unless the org may save policy library items. */
export function assertLibraryWrite(org: Pick<Organization, "plan">, options: { productLine?: string | null } = {}): void {
  const limits = limitsFor(org.plan);
  if (!limits.library) {
    throw new PlanLimitError("library", "Saving policies to the library is a Pro feature. Upgrade to reuse them in every packet.");
  }
  if (options.productLine?.trim() && !limits.productLineTemplates) {
    throw new PlanLimitError("product_line_templates", "Templates per product line are a Pro feature.");
  }
}
