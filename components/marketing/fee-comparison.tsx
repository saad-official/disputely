import { cn } from "@/lib/utils";
import { feeExample, usd } from "./site";

const { recovered, vendorRate, flat } = feeExample;
const vendorFee = recovered * vendorRate;
const breakEven = Math.ceil(flat / vendorRate);
const pct = (n: number) => `${((n / recovered) * 100).toFixed(3)}%`;

const rows = [
  {
    key: "recovered",
    label: "Recovered from won disputes",
    note: "example month",
    amount: recovered,
    bar: "bg-olive",
  },
  {
    key: "vendor",
    label: "25% of recoveries, uncapped",
    note: "the leading automation vendor’s fee",
    amount: vendorFee,
    bar: "bg-foreground",
  },
  {
    key: "flat",
    label: "Disputely Pro, flat",
    note: "the same every month",
    amount: flat,
    bar: "bg-foreground",
  },
];

/**
 * Both fees drawn to one scale, where the full track is the example month's
 * recoveries. At that scale $29 is 0.6% of the width: a sliver, on purpose.
 */
export function FeeComparison({ className, headingLevel = "h3" }: { className?: string; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <figure className={cn("min-w-0 rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10 sm:p-6", className)}>
      <Heading className="sr-only">Fees on an example month with {usd(recovered)} recovered</Heading>
      <dl className="space-y-6">
        {rows.map((r) => (
          <div key={r.key} className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt className="min-w-0">
                <span className="text-sm font-semibold text-foreground">{r.label}</span>
                <span className="ml-2 text-xs text-foreground/75">{r.note}</span>
              </dt>
              <dd className="tabular font-mono text-2xl leading-none font-semibold text-foreground sm:text-3xl">
                {usd(r.amount)}
              </dd>
            </div>
            <div aria-hidden="true" className="hatch mt-2.5 h-5 overflow-hidden rounded-[3px] bg-secondary ring-1 ring-border ring-inset">
              <div className={cn("h-full min-w-[3px]", r.bar)} style={{ width: pct(r.amount) }} />
            </div>
          </div>
        ))}
      </dl>

      <div className="mt-7 grid gap-px overflow-hidden rounded-md bg-border ring-1 ring-border sm:grid-cols-2">
        <div className="bg-card p-4">
          <p className="text-xs font-semibold text-foreground/75">You keep, on a percentage</p>
          <p className="tabular mt-1 font-mono text-xl text-foreground">{usd(recovered - vendorFee)}</p>
          <p className="mt-1 text-xs text-foreground/75">
            {usd(vendorFee * 12)} a year in fees at this rate
          </p>
        </div>
        <div className="bg-card p-4">
          <p className="text-xs font-semibold text-foreground/75">You keep, on Disputely Pro</p>
          <p className="tabular mt-1 font-mono text-xl text-foreground">{usd(recovered - flat)}</p>
          <p className="mt-1 text-xs text-foreground/75">{usd(flat * 12)} a year, whatever you win</p>
        </div>
      </div>

      <figcaption className="mt-5 space-y-2 text-xs leading-relaxed text-foreground/75">
        <p>
          Drawn to scale: the full track is {usd(recovered)}. {usd(recovered)} is an example month, not a customer
          result. 25% of recoveries with no cap is the fee the leading automation vendor takes.
        </p>
        <p>
          In fairness to percentages: one costs nothing in a month you win nothing, and $29 does not. The flat fee is
          the cheaper of the two once you recover more than {usd(breakEven)} in a month, and Free costs nothing for up
          to three disputes a month.
        </p>
      </figcaption>
    </figure>
  );
}
