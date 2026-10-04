import { MAX_ATTACHMENT_BYTES } from "@/lib/db/schema";
import type { Organization, Plan } from "@/lib/db/types";

/**
 * Plan limits (spec 2). Free: up to 3 disputes a month (counted by Stripe's
 * dispute creation date, UTC calendar month), manual submit, packet PDF,
 * reason-code playbook. Pro: unlimited disputes, policy library, product-line
 * templates, one-click submit, analytics, deadline reminders.
 *
 * Minimal module created with the data layer so app/api/_lib compiles; the
 * services layer owns and extends it.
 */
export const FREE_DISPUTES_PER_MONTH = 3;

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
