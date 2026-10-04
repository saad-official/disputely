import { cn } from "@/lib/utils";
import { SourceTag } from "./parts";

/**
 * The narrative (Stripe's `uncategorized_text`) for the synthetic dispute on
 * this page, as the packet page shows it after the guardrail pass: verified
 * facts highlighted, one unverifiable claim struck out and flagged.
 */

type Segment =
  | { text: string }
  | { fact: string; n: number }
  | { removed: string };

const narrative: Segment[] = [
  { text: "On " },
  { fact: "9 September 2026", n: 1 },
  { text: ", " },
  { fact: "Mara Okafor", n: 2 },
  { text: " ordered a linen duvet cover (queen, oat) from Larkspur Goods for " },
  { fact: "$184.00", n: 3 },
  { text: ", order " },
  { fact: "LG-20417", n: 4 },
  { text: ". The order shipped with " },
  { fact: "USPS", n: 5 },
  { text: " on " },
  { fact: "12 September 2026", n: 6 },
  { text: " under tracking number " },
  { fact: "9400 1112 0261 7840 2210 55", n: 7 },
  { text: " and was delivered on " },
  { fact: "16 September 2026", n: 8 },
  { text: " to " },
  { fact: "14 Alder Lane, Portland, OR 97211", n: 9 },
  { text: ", the shipping address given at checkout. " },
  { removed: "The customer confirmed receipt by email on 17 September 2026." },
  { text: " On " },
  { fact: "18 September 2026", n: 10 },
  { text: " the customer emailed to ask how returns work, and Larkspur Goods replied the same day with its " },
  { fact: "30-day", n: 11 },
  {
    text: " return policy, which was shown at checkout above the Pay button. The carrier record shows delivery to the address the customer provided, which does not support the claim that the order was not received.",
  },
];

/** Characters actually sent to Stripe: removed claims are not part of the narrative. */
export const narrativeLength = narrative.reduce(
  (sum, s) => sum + ("text" in s ? s.text.length : "fact" in s ? s.fact.length : 0),
  0,
);

const ledger: { n: number; fact: string; source: string; field: string }[] = [
  { n: 1, fact: "9 September 2026", source: "Stripe charge", field: "created" },
  { n: 2, fact: "Mara Okafor", source: "Stripe customer", field: "name" },
  { n: 3, fact: "$184.00", source: "Stripe charge", field: "amount" },
  { n: 4, fact: "LG-20417", source: "Stripe charge", field: "metadata.order_id" },
  { n: 5, fact: "USPS", source: "Shipment record", field: "carrier" },
  { n: 6, fact: "12 September 2026", source: "Shipment record", field: "shipped_at" },
  { n: 7, fact: "9400 1112 …2210 55", source: "Shipment record", field: "tracking_number" },
  { n: 8, fact: "16 September 2026", source: "Shipment record", field: "delivered_at" },
  { n: 9, fact: "14 Alder Lane …", source: "Checkout session", field: "shipping_details" },
  { n: 10, fact: "18 September 2026", source: "Message log", field: "occurred_at" },
  { n: 11, fact: "30-day", source: "Policy library", field: "refund_policy" },
];

export function NarrativeMock({ className }: { className?: string }) {
  return (
    <figure className={cn("grid min-w-0 gap-4 lg:grid-cols-12 lg:gap-6", className)}>
      {/* The narrative itself, on a sheet with a margin rule. */}
      <div className="min-w-0 rounded-lg bg-card shadow-card ring-1 ring-foreground/10 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 sm:px-5">
          <span className="font-mono text-xs font-medium text-foreground/80">uncategorized_text</span>
          <span className="tabular font-mono text-[0.6875rem] text-foreground/70">
            {narrativeLength.toLocaleString("en-US")} / 2,500 chars
          </span>
        </div>
        <div className="relative px-4 py-5 sm:py-6 sm:pr-6 sm:pl-10">
          <span aria-hidden="true" className="absolute inset-y-0 left-6 hidden w-px bg-(--oxide-ink)/30 sm:block" />
          <p className="text-[0.9375rem] leading-[1.85] text-foreground">
            {narrative.map((s, i) => {
              if ("fact" in s) {
                return (
                  <mark key={i} className="fact rounded-[2px] text-foreground">
                    {s.fact}
                    <sup className="ml-0.5 font-mono text-[0.625rem] text-foreground/75">{s.n}</sup>
                  </mark>
                );
              }
              if ("removed" in s) {
                return (
                  <del
                    key={i}
                    className="decoration-(--oxide-ink) decoration-2 text-foreground/70"
                  >
                    <span className="sr-only">Removed claim: </span>
                    {s.removed}
                  </del>
                );
              }
              return <span key={i}>{s.text}</span>;
            })}
          </p>
        </div>
      </div>

      {/* The check: every fact traced to the field it came from. */}
      <div className="min-w-0 rounded-lg bg-card shadow-card ring-1 ring-foreground/10 lg:col-span-5">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="text-xs font-semibold text-foreground/75">Fact check</span>
          <span className="font-mono text-[0.6875rem] text-olive">11 verified</span>
        </div>
        <ol className="divide-y divide-border">
          {ledger.map((l) => (
            <li key={l.n} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 px-4 py-2">
              <span className="pt-px font-mono text-[0.6875rem] text-foreground/70">{l.n}</span>
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] text-foreground">{l.fact}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <SourceTag>{l.source}</SourceTag>
                  <span className="font-mono text-[0.6875rem] break-all text-foreground/70">{l.field}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="border-t-2 border-(--oxide-ink)/70 bg-accent/60 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-(--oxide-ink)">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Removed and flagged
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/85">
            <span className="font-mono">17 September 2026</span> does not appear anywhere in the packet. The message log
            has one email from the customer, dated 18 September. The sentence is left out of what Stripe receives and kept here so you can see what was cut.
          </p>
        </div>
      </div>

      <figcaption className="text-xs text-foreground/70 lg:col-span-12">
        Highlighted: a date, amount, name, address or tracking number that matched a field in the assembled evidence.
        Struck through: a claim the check could not match. Synthetic demo dispute.
      </figcaption>
    </figure>
  );
}
