import { cn } from "@/lib/utils";
import { DisputeRow, MockCard, type Reason, Stamp } from "./parts";

const open: { d: number; h: number; customer: string; reason: Reason; amount: number; ready: string }[] = [
  { d: 2, h: 5, customer: "Theo Lindqvist", reason: "fraudulent", amount: 62.5, ready: "4 of 6" },
  { d: 6, h: 14, customer: "Mara Okafor", reason: "product_not_received", amount: 184, ready: "6 of 7" },
  { d: 9, h: 20, customer: "Jonah Adeyemi", reason: "product_unacceptable", amount: 210, ready: "2 of 5" },
  { d: 13, h: 2, customer: "Priya Nair", reason: "subscription_canceled", amount: 24, ready: "5 of 5" },
];

const byReason: { reason: Reason; won: number; decided: number }[] = [
  { reason: "product_not_received", won: 5, decided: 6 },
  { reason: "subscription_canceled", won: 3, decided: 4 },
  { reason: "fraudulent", won: 2, decided: 5 },
  { reason: "product_unacceptable", won: 1, decided: 3 },
];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const atStake = open.reduce((s, o) => s + o.amount, 0);
const won = byReason.reduce((s, r) => s + r.won, 0);
const decided = byReason.reduce((s, r) => s + r.decided, 0);

/** The outcomes dashboard as the app shows it, filled with synthetic numbers from the demo store. */
export function OutcomesMock({ className }: { className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-12">
        <MockCard label="Open, by deadline" meta={`${money(atStake)} at stake`} className="lg:col-span-7" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {open.map((o) => (
              <li key={o.customer} className="px-4 py-3">
                <DisputeRow
                  days={o.d}
                  hours={o.h}
                  customer={o.customer}
                  reason={o.reason}
                  amount={money(o.amount)}
                  extra={<span className="font-mono text-[0.6875rem] text-foreground/75">packet {o.ready}</span>}
                />
              </li>
            ))}
          </ul>
        </MockCard>

        <div className="grid min-w-0 gap-4 lg:col-span-5">
          <MockCard label="Win rate by reason" meta="last 90 days">
            <ul className="space-y-3.5">
              {byReason.map((r) => (
                <li key={r.reason} className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[0.6875rem] text-foreground/80">{r.reason}</span>
                    <span className="tabular shrink-0 font-mono text-xs text-foreground">
                      {r.won} of {r.decided}
                    </span>
                  </div>
                  <div aria-hidden="true" className="hatch mt-1.5 h-2 overflow-hidden rounded-[2px] bg-secondary">
                    <div className="h-full bg-olive" style={{ width: `${(r.won / r.decided) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </MockCard>

          <MockCard label="Recovered" meta="last 90 days">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="tabular font-mono text-3xl leading-none font-semibold text-foreground">$2,318.40</p>
                <p className="mt-2 text-xs text-foreground/75">
                  {won} won &middot; {decided - won} lost &middot; median packet 93% complete
                </p>
              </div>
              <Stamp tone="olive">Won &times; {won}</Stamp>
            </div>
          </MockCard>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-foreground/70">
        Example workspace for the fictional Larkspur Goods. Synthetic data, not a customer result.
      </figcaption>
    </figure>
  );
}
