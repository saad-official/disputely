import { cn } from "@/lib/utils";
import { CtaLink } from "./cta-link";
import { links } from "./site";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "a month",
    blurb: "For the occasional dispute. Build the packet here, submit it yourself.",
    features: ["3 disputes a month", "Manual submit", "PDF evidence packet", "Reason-code playbooks"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "a month, flat",
    blurb: "For stores with disputes every week. Never a share of what you recover.",
    features: [
      "Unlimited disputes",
      "Saved policy library",
      "Templates per product line",
      "One-click submit through Stripe",
      "Win-rate analytics by reason code",
      "Deadline reminders by email",
    ],
    cta: "Start free, upgrade later",
    featured: true,
  },
];

export const testModeNote = "Checkout runs in Stripe test mode; use card 4242 4242 4242 4242.";

export function PricingPlans({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <div>
      <ul className="grid gap-5 md:grid-cols-2">
        {plans.map((p) => (
          <li
            key={p.name}
            className={cn(
              "relative flex flex-col rounded-lg p-6 sm:p-8",
              p.featured ? "bg-slate text-linen" : "bg-card shadow-card ring-1 ring-foreground/10",
            )}
          >
            <Heading className="text-2xl">{p.name}</Heading>
            <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="countdown text-5xl leading-none">{p.price}</span>
              <span className={cn("text-sm", p.featured ? "text-linen/80" : "text-foreground/75")}>{p.period}</span>
            </p>
            <p className={cn("mt-4 text-[0.9375rem] leading-relaxed", p.featured ? "text-linen/85" : "text-foreground/80")}>
              {p.blurb}
            </p>
            <ul className="mt-6 flex-1 space-y-2.5 text-[0.9375rem]">
              {p.features.map((f) => (
                <li key={f} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={cn("mt-[0.55rem] h-px w-3 shrink-0", p.featured ? "bg-linen/70" : "bg-foreground/60")}
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <CtaLink
              href={links.signUp}
              tone={p.featured ? "linen" : "outline"}
              className="mt-8 w-full text-center whitespace-normal"
            >
              {p.cta}
            </CtaLink>
          </li>
        ))}
      </ul>
      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-foreground/80">
        <span className="font-semibold text-foreground">Test mode.</span> {testModeNote} No real payment is taken.
      </p>
    </div>
  );
}
