import type { Metadata } from "next";
import { CircleCheck, FlaskConical, Info } from "lucide-react";
import { ManageButton, UpgradeButton } from "@/components/billing/billing-buttons";
import { PageHeader } from "@/components/app/page-header";
import { Stamp } from "@/components/disputes/parts";
import { requireOrgContext } from "@/lib/auth/session";
import { monthStartUtc, nextMonthStartUtc } from "@/lib/db/repositories/shared";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import type { Plan } from "@/lib/db/types";
import { formatDate } from "@/lib/format";
import { requestTime } from "@/lib/request-time";
import { FREE_DISPUTES_PER_MONTH, limitsFor, PRO_PRICE_USD } from "@/lib/services/plan-limits";
import { isBillingConfigured, isPortalConfigured } from "@/lib/stripe/billing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const PLANS: { id: Plan; name: string; price: string; blurb: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "Build the packet; submit it yourself in Stripe.",
    features: [
      `${FREE_DISPUTES_PER_MONTH} disputes a month`,
      "Evidence packet and PDF",
      "Reason-code playbooks",
      "Fact-checked statement",
      "Manual submit in your Stripe Dashboard",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: `$${PRO_PRICE_USD}`,
    blurb: "Flat fee. Never a cut of what you recover.",
    features: [
      "Unlimited disputes",
      "One-click submit through Stripe",
      "Saved policy library and product-line templates",
      "Deadline reminders by email",
      "Win-rate analytics",
    ],
  },
];

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { org, role } = await requireOrgContext();
  const { checkout } = await searchParams;
  const now = requestTime();
  const used = await disputesRepo.countBillableThisMonth(org.id, now);
  const limits = limitsFor(org.plan);
  const isPro = org.plan === "pro";
  const isOwner = role === "owner";
  const configured = isBillingConfigured();
  const portalAvailable = Boolean(isPortalConfigured() && org.stripeCustomerId);
  const limit = limits.disputesPerMonth;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <>
      <PageHeader title="Billing" description="Your plan, this month's disputes and payments through Stripe." actions={isPro ? <Stamp tone="steel">Pro</Stamp> : null} />
      <div className="grid gap-8">
        {checkout === "success" ? (
          <p role="status" className="flex items-start gap-2.5 rounded-lg bg-olive/10 px-4 py-3 text-sm ring-1 ring-olive/30">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-olive" aria-hidden />
            {isPro ? "Payment received. You're on Pro." : "Payment received; your plan updates when Stripe confirms, usually within a few seconds. Refresh to check."}
          </p>
        ) : checkout === "cancelled" ? (
          <p role="status" className="flex items-start gap-2.5 rounded-lg bg-muted px-4 py-3 text-sm text-foreground/85">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Checkout cancelled. Nothing was charged and your plan is unchanged.
          </p>
        ) : null}

        <aside aria-label="Test mode" className="flex items-start gap-3 rounded-lg border border-dashed border-steel/50 bg-steel/8 px-4 py-3 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
          <p>
            <span className="font-semibold">Test mode.</span> Stripe runs in its sandbox here, so no real payments are taken. Pay
            with card <span className="font-mono whitespace-nowrap">4242 4242 4242 4242</span>, any future expiry and any CVC.
          </p>
        </aside>

        <section aria-labelledby="usage-heading" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="usage-heading" className="text-xl">
              This month
            </h2>
            <p className="text-sm text-muted-foreground">
              Resets <span className="font-mono text-foreground">{formatDate(nextMonthStartUtc(now), "UTC")}</span> (UTC)
            </p>
          </div>
          <div className="grid gap-3 rounded-lg bg-card p-5 shadow-card ring-1 ring-foreground/10 sm:p-6">
            <p className="text-xs font-semibold text-foreground/70">Disputes opened since {formatDate(monthStartUtc(now), "UTC")}</p>
            <p className="flex items-baseline gap-2">
              <span className={cn("countdown text-5xl leading-none", limit !== null && used >= limit ? "text-oxide-ink" : "text-foreground")}>{used}</span>
              <span className="text-sm text-muted-foreground">{limit === null ? "no limit on Pro" : `of ${limit} on Free`}</span>
            </p>
            {limit !== null ? (
              <div
                role="progressbar"
                aria-valuenow={used}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-label={`Disputes this month: ${used} of ${limit}`}
                className="hatch h-2 overflow-hidden rounded-[2px] bg-secondary"
              >
                <div className={cn("h-full", used >= limit ? "bg-oxide-ink" : "bg-foreground/75")} style={{ width: `${pct}%` }} />
              </div>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {limit === null
                ? "Every dispute Stripe opens is covered."
                : used > limit
                  ? `Free covers the first ${limit} disputes Stripe opens each month; the others stay listed but need Pro for a packet.`
                  : `${Math.max(0, limit - used)} left this month.`}{" "}
              Demo disputes never count.
            </p>
          </div>
        </section>

        <section aria-labelledby="plans-heading" className="grid gap-4">
          <h2 id="plans-heading" className="text-xl">
            Plans
          </h2>
          <ul className="grid gap-5 md:grid-cols-2">
            {PLANS.map((plan) => {
              const current = plan.id === org.plan;
              const pro = plan.id === "pro";
              return (
                <li
                  key={plan.id}
                  aria-current={current ? "true" : undefined}
                  className={cn("flex flex-col rounded-xl bg-card p-6 shadow-card ring-1 sm:p-8", current ? "ring-2 ring-oxide-ink" : "ring-foreground/10")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-2xl">{plan.name}</h3>
                    {current ? <Stamp tone="steel">Current plan</Stamp> : null}
                  </div>
                  <p className="mt-5 flex items-baseline gap-2">
                    <span className="countdown text-5xl leading-none">{plan.price}</span>
                    <span className="text-sm text-foreground/75">a month</span>
                  </p>
                  <p className="mt-4 text-[0.9375rem] leading-relaxed text-foreground/80">{plan.blurb}</p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-[0.9375rem]">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-3">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-oxide-ink" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {pro ? (
                    <div className="mt-8 grid gap-3">
                      {isPro ? (
                        portalAvailable ? (
                          <ManageButton disabled={!isOwner} />
                        ) : (
                          <p className="text-sm text-muted-foreground">Subscription management opens once Stripe has linked a customer to this workspace.</p>
                        )
                      ) : (
                        <UpgradeButton disabled={!configured || !isOwner} />
                      )}
                      {!configured && !isPro ? <p className="text-xs text-muted-foreground">Billing is not configured on this deployment.</p> : null}
                      {!isOwner ? <p className="text-xs text-muted-foreground">Only the workspace owner can change the plan.</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
