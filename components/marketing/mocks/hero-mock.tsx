import { cn } from "@/lib/utils";
import { Completeness, Countdown, FauxButton, ReasonChip, StatusChip } from "./parts";

const facts = [
  { term: "Amount", value: "$184.00 USD", mono: true },
  { term: "Customer", value: "Mara Okafor" },
  { term: "Order", value: "LG-20417", mono: true },
  { term: "Charged", value: "9 Sep 2026", mono: true },
];

/**
 * The top of a packet page in the app, for one synthetic dispute: the
 * deadline first and largest, then what is at stake, then how close the
 * packet is to ready.
 */
export function HeroMock({ className }: { className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      <div className="relative min-w-0 overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
        {/* Oxide rule along the top edge: this dispute is open against a deadline. */}
        <div aria-hidden="true" className="h-1 bg-oxide" />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
          <span className="min-w-0 truncate font-mono text-xs text-foreground/75">du_1Q8xLmB2eZvKYlo2C0aTn3fP</span>
          <StatusChip status="needs_response" />
        </div>

        <div className="px-4 pt-5 pb-6 sm:px-6 sm:pt-6">
          <p className="text-xs font-semibold text-foreground/75">Evidence due in</p>
          <Countdown days={6} hours={14} size="xl" className="mt-2" />
          <p className="mt-3 font-mono text-xs text-foreground/75">
            Stripe <span className="text-foreground">due_by</span> 10 Oct 2026, 23:59 UTC
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-5 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.term} className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-foreground/70">{f.term}</dt>
                <dd className={cn("mt-1 truncate text-sm text-foreground", f.mono && "tabular font-mono")}>{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-[0.6875rem] font-semibold text-foreground/70">Reason</span>
            <ReasonChip reason="product_not_received" />
          </div>

          <div className="mt-6 grid gap-5 rounded-md bg-secondary p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <Completeness have={6} of={7} />
              <p className="mt-2.5 text-xs leading-relaxed text-foreground/80">
                Missing <span className="font-mono text-(--oxide-ink)">shipping_documentation</span>: upload the
                carrier&rsquo;s delivery scan.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                Narrative: <span className="font-semibold text-olive">11 facts verified</span>, 1 claim removed.
              </p>
            </div>
            <FauxButton>Review packet</FauxButton>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-foreground/70">
        A packet page in the demo. Larkspur Goods and Mara Okafor are synthetic; the dispute is a Stripe test-mode
        dispute.
      </figcaption>
    </figure>
  );
}
