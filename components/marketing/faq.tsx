import { cn } from "@/lib/utils";
import { focusRing } from "./site";

const items: { q: string; a: React.ReactNode }[] = [
  {
    q: "Will this win my disputes?",
    a: (
      <>
        <p>
          Nobody can promise that: the cardholder&rsquo;s bank decides. What Disputely changes is what the bank receives.
          Every packet is built for its reason code, says plainly what is missing, and goes in before the deadline
          rather than not at all.
        </p>
        <p>
          For context, manual representment wins roughly 12% of the time (vendor-published figure). Disputely does not
          publish a win rate of its own; the dashboard shows yours, by reason code, from Stripe&rsquo;s outcomes.
        </p>
      </>
    ),
  },
  {
    q: "Does it submit anything without me?",
    a: (
      <p>
        No. Submitting calls the Stripe Disputes API only after you confirm on the packet page, because Stripe accepts
        one submission per dispute and the evidence cannot be edited afterwards. Disputely keeps a snapshot of exactly
        what was sent. On Free you submit the packet yourself from the PDF; Pro submits it in one click once you have
        reviewed it.
      </p>
    ),
  },
  {
    q: "Can the narrative make things up?",
    a: (
      <p>
        It is written from the assembled evidence only, kept under 2,500 characters, and told not to speculate about
        the cardholder or make legal threats. Then every date, amount, name and tracking number in it is checked against
        the packet. Anything the check cannot match is removed and flagged on the packet page, so you see what was cut
        and why.
      </p>
    ),
  },
  {
    q: "Why a restricted key instead of signing in with Stripe?",
    a: (
      <p>
        A restricted key lets you grant exactly what is needed (read disputes, charges, customers and payment intents;
        write disputes) and nothing else, and you can revoke it in Stripe at any time. It is stored encrypted with a key
        derived for your organisation. Stripe Connect sign-in is planned for later.
      </p>
    ),
  },
  {
    q: "What if I am missing evidence?",
    a: (
      <p>
        The packet page shows a completeness score and lists each missing field with what would fill it, such as a
        carrier delivery scan or the page where your refund policy was shown. You can add it from your policy library,
        paste a message log, enter tracking by hand, or upload a file. You can also submit an incomplete packet; it
        just tells you what the bank will not see.
      </p>
    ),
  },
  {
    q: "Does it work with Shopify Payments?",
    a: <p>Not yet. Disputely works with Stripe today; Shopify Payments is on the list for later.</p>,
  },
  {
    q: "Can I try it without a real dispute?",
    a: (
      <p>
        Yes. Connect a Stripe sandbox key and press Create demo disputes: Disputely makes test charges with
        Stripe&rsquo;s dispute test cards and loads a policy library and message logs for a fictional store, Larkspur
        Goods, so the whole flow runs against real Stripe test-mode disputes.
      </p>
    ),
  },
];

/** Native disclosure list: works without JavaScript and with find-in-page. */
export function Faq({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div className="border-t border-foreground/20">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-foreground/20">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-start justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden",
              focusRing,
            )}
          >
            <Heading className="text-lg leading-snug sm:text-xl">{item.q}</Heading>
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm border border-foreground/25 font-mono text-base leading-none group-open:border-foreground group-open:bg-foreground group-open:text-background"
            >
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">&minus;</span>
            </span>
          </summary>
          <div className="max-w-2xl space-y-3 pb-6 text-[0.9375rem] leading-relaxed text-foreground/85">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
