import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { CtaLink } from "@/components/marketing/cta-link";
import { FeeComparison } from "@/components/marketing/fee-comparison";
import { PricingPlans, testModeNote } from "@/components/marketing/pricing-plans";
import { SectionHeading, SectionLabel } from "@/components/marketing/section-heading";
import { container, links } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free for 3 disputes a month with manual submit, a PDF packet and reason-code playbooks. Pro is $29 a month, flat: unlimited disputes, policy library, templates per product line, one-click submit, win-rate analytics and deadline reminders.",
  alternates: { canonical: "/pricing" },
};

type Cell = string | boolean;

const rows: { feature: string; free: Cell; pro: Cell; note?: string }[] = [
  { feature: "Disputes a month", free: "3", pro: "Unlimited" },
  { feature: "Stripe sync with deadlines", free: true, pro: true },
  { feature: "Reason-code playbooks", free: true, pro: true },
  { feature: "Evidence assembly and completeness score", free: true, pro: true },
  {
    feature: "Fact-checked narrative",
    free: true,
    pro: true,
    note: "Every date, amount, name and tracking number checked against the packet.",
  },
  { feature: "PDF evidence packet", free: true, pro: true },
  {
    feature: "Submission",
    free: "Manual",
    pro: "One click",
    note: "Pro submits through the Stripe Disputes API after you confirm.",
  },
  { feature: "Saved policy library", free: false, pro: true },
  { feature: "Templates per product line", free: false, pro: true },
  { feature: "Win-rate analytics by reason code", free: false, pro: true },
  { feature: "Deadline reminders by email", free: false, pro: true, note: "At 7, 3 and 1 day before the due date." },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 text-olive">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden="true" className="text-foreground/60">
          &ndash;
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="font-mono text-[0.8125rem]">{value}</span>;
}

const billing = [
  {
    q: "Is this a real subscription?",
    a: `Not on this demo. ${testModeNote} Stripe accepts only its published test cards in test mode, and no money moves.`,
  },
  {
    q: "Why not charge a percentage of recoveries?",
    a: "Because the work of building a packet is the same whether the dispute is for $24 or $2,400. A percentage makes your best months the most expensive ones. A flat price is easier to plan around, and Free covers the months with only a dispute or two.",
  },
  {
    q: "How do I cancel Pro?",
    a: "From Billing in the app, which opens Stripe’s customer portal. Cancelling there moves your workspace back to Free when Stripe reports the change.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section aria-labelledby="pricing-title" className="border-b border-border">
        <div className={cn(container, "py-14 sm:py-20")}>
          <SectionLabel>Pricing</SectionLabel>
          <h1
            id="pricing-title"
            className="mt-4 max-w-3xl text-4xl leading-[1.05] tracking-[-0.04em] text-balance sm:text-5xl lg:text-6xl"
          >
            One flat price. What you recover stays yours.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-foreground/80">
            Both plans build the full packet: deadline, playbook, evidence with sources and a fact-checked narrative.
            Pro takes off the monthly cap, remembers your policies, and submits for you.
          </p>
          <div className="mt-10">
            <PricingPlans headingLevel="h2" />
          </div>
        </div>
      </section>

      <section aria-labelledby="compare-title">
        <div className={cn(container, "py-16 sm:py-20")}>
          <h2 id="compare-title" className="text-3xl tracking-[-0.035em]">
            Compare plans
          </h2>
          <div className="mt-8 overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
            <table className="w-full table-fixed border-collapse text-left text-sm sm:text-[0.9375rem]">
              <caption className="sr-only">Features included in the Free and Pro plans</caption>
              <colgroup>
                <col />
                <col className="w-20 sm:w-36" />
                <col className="w-24 sm:w-36" />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-3 font-semibold sm:px-5">
                    Feature
                  </th>
                  <th scope="col" className="px-2 py-3 font-semibold sm:px-5">
                    Free
                  </th>
                  <th scope="col" className="px-2 py-3 font-semibold sm:px-5">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feature} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-3 align-top font-normal break-words sm:px-5">
                      {r.feature}
                      {r.note ? <span className="mt-1 block text-xs text-foreground/75">{r.note}</span> : null}
                    </th>
                    <td className="px-2 py-3 align-top sm:px-5">
                      <CellValue value={r.free} />
                    </td>
                    <td className="px-2 py-3 align-top sm:px-5">
                      <CellValue value={r.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="fees-title" className="hatch border-y border-border">
        <div className={cn(container, "grid gap-10 py-16 sm:py-20 lg:grid-cols-12 lg:gap-12")}>
          <SectionHeading
            id="fees"
            label="Flat versus a percentage"
            title="The same month, priced both ways."
            intro="An example month with $4,800 recovered from won disputes, drawn to one scale."
            className="lg:col-span-5"
          />
          <FeeComparison className="lg:col-span-7" />
        </div>
      </section>

      <section aria-labelledby="billing-title">
        <div className={cn(container, "grid gap-10 py-16 sm:py-20 lg:grid-cols-12")}>
          <h2 id="billing-title" className="text-3xl tracking-[-0.035em] lg:col-span-4">
            Billing questions
          </h2>
          <dl className="space-y-8 lg:col-span-8">
            {billing.map((b) => (
              <div key={b.q}>
                <dt className="font-heading text-xl font-semibold tracking-[-0.02em]">{b.q}</dt>
                <dd className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-foreground/80">{b.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="pricing-cta-title" className="bg-slate text-linen">
        <div className={cn(container, "flex flex-col gap-6 py-14 sm:flex-row sm:items-center sm:justify-between")}>
          <h2 id="pricing-cta-title" className="max-w-lg text-2xl leading-snug tracking-[-0.03em] sm:text-3xl">
            Build your first packet on the demo disputes.
          </h2>
          <CtaLink href={links.signUp} tone="linen">
            Start free
          </CtaLink>
        </div>
      </section>
    </>
  );
}
