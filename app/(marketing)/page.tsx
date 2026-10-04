import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CtaLink } from "@/components/marketing/cta-link";
import { Faq } from "@/components/marketing/faq";
import { FeeComparison } from "@/components/marketing/fee-comparison";
import { HeroMock } from "@/components/marketing/mocks/hero-mock";
import { NarrativeMock } from "@/components/marketing/mocks/narrative-mock";
import { OutcomesMock } from "@/components/marketing/mocks/outcomes-mock";
import { Countdown } from "@/components/marketing/mocks/parts";
import { AssembleMock, ConnectMock, SubmitMock, SyncMock } from "@/components/marketing/mocks/step-mocks";
import { PlaybookStrip } from "@/components/marketing/playbook-strip";
import { SectionHeading, SectionLabel } from "@/components/marketing/section-heading";
import { container, links, textLink } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: { absolute: "Disputely · Every chargeback, answered before the deadline" },
  description:
    "Disputely lists your open Stripe disputes by deadline, assembles the evidence each reason code asks for, writes a narrative that states only facts in the packet, and submits through Stripe when you confirm. $29 a month, flat; free for 3 disputes a month.",
  alternates: { canonical: "/" },
};

const docket = [
  {
    figure: "7–21",
    unit: "days",
    text: "to answer a dispute with an evidence packet the bank can read. Stripe gives the exact due date on each one.",
    deadline: true,
  },
  {
    figure: "~12",
    unit: "%",
    text: "Manual representment wins roughly 12% of the time.",
    source: "Vendor-published figure.",
  },
  {
    figure: "25",
    unit: "%",
    text: "of everything recovered, with no cap, is what the leading automation vendor takes.",
  },
];

const steps = [
  {
    id: "connect",
    title: "Connect Stripe with a restricted key",
    call: "rk_test_… · 4 read, 1 write",
    body: (
      <>
        Create a restricted key in your Stripe Dashboard with read access to disputes, charges, customers and payment
        intents, and write access to disputes. Paste it into Settings. Disputely encrypts it at rest with a key derived
        for your organisation and never shows it in full again.
      </>
    ),
    visual: <ConnectMock />,
  },
  {
    id: "sync",
    title: "Sync disputes with their deadlines",
    call: "disputes.list · charge.dispute.*",
    body: (
      <>
        A sync lists your disputes and pulls the charge, payment intent, customer and receipt, plus the shipping address
        and line items where Stripe Checkout was used. Stripe&rsquo;s dispute webhooks keep it current between syncs.
        Open disputes sort by due date, with the time left in days and hours.
      </>
    ),
    visual: <SyncMock />,
  },
  {
    id: "assemble",
    title: "Assemble the packet by reason code",
    call: "playbook: product_not_received",
    body: (
      <>
        Each reason code has a playbook: the evidence fields the bank looks for, and which of your records fill them.
        Disputely fills what it can from Stripe and your library (policies and where customers saw them, product
        descriptions, message logs, tracking numbers), scores completeness, and lists what is still missing.
      </>
    ),
    visual: <AssembleMock />,
  },
  {
    id: "submit",
    title: "Review, submit, track",
    call: "disputes.update(id, { evidence, submit: true })",
    body: (
      <>
        One page holds the countdown, the playbook, every field with its source, the checked narrative and a PDF
        preview. When you confirm, Pro submits through the Stripe Disputes API; on Free you submit from the PDF.
        Webhooks mark the outcome won or lost.
      </>
    ),
    visual: <SubmitMock />,
  },
];

const rules = ["Facts from the packet only", "Under 2,500 characters", "No guesses about motive, no legal threats"];

const safeguards = [
  {
    title: "A restricted key, encrypted per organisation",
    body: "Disputely asks for the five permissions it uses and nothing more. The key is encrypted at rest with a key derived for your organisation, and you can revoke it in Stripe at any time.",
  },
  {
    title: "No model sees a card number",
    body: "Stripe’s API returns a card’s brand and last four digits, never the full number, so Disputely never holds one to pass on. The narrative model is given the assembled facts of the order and nothing else.",
  },
  {
    title: "Test mode in the demo",
    body: "The demo connects a Stripe sandbox key and creates disputes with Stripe’s dispute test cards, against a fictional store. Billing runs in test mode too, so no money moves.",
  },
  {
    title: "Nothing reaches the bank without you",
    body: "Submission waits for your confirmation, and the exact packet sent is kept as a snapshot. Every sync, draft, check and submission is written to an event log.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* a. Hero */}
      <section aria-labelledby="hero-title" className="border-b border-border">
        <div className={cn(container, "grid gap-12 pt-12 pb-16 sm:pt-16 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pb-24")}>
          <div className="min-w-0 lg:col-span-6">
            <SectionLabel>Chargeback evidence for Stripe merchants</SectionLabel>
            <h1
              id="hero-title"
              className="mt-5 text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.25rem]"
            >
              Every chargeback, answered before the deadline.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-foreground/85">
              Disputely lists your open Stripe disputes by due date, assembles the evidence each reason code asks for,
              writes a narrative that states only facts in the packet, and submits it through Stripe when you say so.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaLink href={links.signUp}>Start free</CtaLink>
              <CtaLink href="#how-it-works" tone="outline">
                See how it works
              </CtaLink>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-foreground/80">
              <span className="font-semibold text-foreground">$29 a month, flat.</span> Never a share of what you win.
              Free for 3 disputes a month.
            </p>
          </div>
          <HeroMock className="lg:col-span-6" />
        </div>
      </section>

      {/* b. The problem, in three figures */}
      <section aria-labelledby="docket-title" className="bg-slate text-linen">
        <div className={cn(container, "py-14 sm:py-16")}>
          <h2 id="docket-title" className="max-w-2xl text-2xl leading-snug tracking-[-0.03em] text-balance sm:text-3xl">
            A dispute is a deadline with paperwork attached, and the paperwork takes the better part of an hour.
          </h2>
          <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {docket.map((d) => (
              <li key={d.figure} className="border-t border-linen/25 pt-5">
                <p
                  aria-hidden="true"
                  className={cn("countdown flex items-baseline text-5xl leading-none sm:text-6xl", d.deadline && "text-(--oxide-glow)")}
                >
                  {d.figure}
                  <span className="ml-1.5 text-2xl font-medium sm:text-3xl">{d.unit}</span>
                </p>
                <p className="mt-4 text-[0.9375rem] leading-relaxed">
                  <span className="sr-only">
                    {d.figure.replace("~", "About ")} {d.unit === "%" ? "percent" : d.unit}:{" "}
                  </span>
                  {d.text}
                </p>
                {d.source ? <p className="mt-2 text-xs text-linen/75">{d.source}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* c. How it works */}
      <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="how-it-works"
            index="01"
            label="How it works"
            title="Four steps, with the deadline on screen the whole time."
            intro="Follow one synthetic dispute through: Mara Okafor says her $184.00 order never arrived, and Larkspur Goods has six days and fourteen hours to answer."
          />
          <ol className="mt-14 space-y-16 sm:space-y-20">
            {steps.map((s, i) => (
              <li key={s.id} className="grid gap-8 lg:grid-cols-12 lg:gap-10">
                <div className="min-w-0 lg:col-span-4">
                  <p className="flex items-center gap-3">
                    <span className="countdown grid size-9 place-items-center rounded-md bg-foreground text-sm text-background">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 font-mono text-xs leading-snug break-words text-foreground/75">{s.call}</span>
                  </p>
                  <h3 className="mt-4 text-2xl leading-tight tracking-[-0.03em] sm:text-[1.75rem]">{s.title}</h3>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-foreground/80">{s.body}</p>
                </div>
                <div className="min-w-0 rounded-lg bg-secondary p-3 sm:p-6 lg:col-span-8">{s.visual}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* d. The narrative rule */}
      <section aria-labelledby="narrative-title" className="border-y border-border bg-card">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="narrative"
            index="02"
            label="The narrative"
            title="The narrative never states a fact that isn’t in the packet."
            intro="A model writes the bank-facing summary from the assembled evidence. Then a check that has nothing to do with the model runs over it: every date, amount, name and tracking number must match a field in the packet. Anything that does not is removed, and flagged so you can see what was cut."
          />
          <ul className="mt-6 flex flex-wrap gap-2">
            {rules.map((r) => (
              <li key={r} className="rounded-sm border border-foreground/20 px-2.5 py-1 font-mono text-xs text-foreground/85">
                {r}
              </li>
            ))}
          </ul>
          <NarrativeMock className="mt-10" />
        </div>
      </section>

      {/* e. Playbooks */}
      <section aria-labelledby="playbooks-title">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="playbooks"
            index="03"
            label="Reason-code playbooks"
            title="Eight reason codes, eight different packets."
            intro="A bank reading a product_not_received dispute wants tracking and a delivery scan. One reading subscription_canceled wants the cancellation terms and proof of use. Each playbook names the Stripe evidence fields that matter and fills them from your records."
          />
          <PlaybookStrip className="mt-10" />
        </div>
      </section>

      {/* f. Honest pricing */}
      <section id="pricing" aria-labelledby="pricing-title" className="hatch scroll-mt-4 border-y border-border">
        <div className={cn(container, "grid gap-10 py-20 sm:py-24 lg:grid-cols-12 lg:gap-12")}>
          <div className="min-w-0 lg:col-span-5">
            <SectionHeading
              id="pricing"
              index="04"
              label="Pricing"
              title="$29 a month. Not a quarter of what you win."
              intro="Percentage pricing grows with your success and never stops. A flat fee does not care how much you recover."
            />
            <dl className="mt-8 divide-y divide-foreground/15 border-y border-foreground/15 text-[0.9375rem]">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt>
                  <span className="font-semibold">Free</span>
                  <span className="ml-2 text-foreground/75">3 disputes a month, manual submit</span>
                </dt>
                <dd className="tabular font-mono">$0</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt>
                  <span className="font-semibold">Pro</span>
                  <span className="ml-2 text-foreground/75">unlimited, one-click submit</span>
                </dt>
                <dd className="tabular font-mono">$29</dd>
              </div>
            </dl>
            <p className="mt-5 text-sm">
              <Link href={links.pricing} className={textLink}>
                Compare plans in detail
              </Link>
            </p>
          </div>
          <FeeComparison className="lg:col-span-7" />
        </div>
      </section>

      {/* g. Outcomes */}
      <section aria-labelledby="outcomes-title">
        <div className={cn(container, "py-20 sm:py-24")}>
          <SectionHeading
            id="outcomes"
            index="05"
            label="Outcomes"
            title="What is due next, and what you won."
            intro="The dashboard leads with open disputes by deadline and the amount at stake, then your win rate by reason code and the dollars recovered, from Stripe’s own outcomes."
          />
          <OutcomesMock className="mt-10" />
        </div>
      </section>

      {/* h. Security and privacy */}
      <section aria-labelledby="security-title" className="bg-slate text-linen">
        <div className={cn(container, "grid gap-10 py-20 sm:py-24 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <SectionHeading id="security" index="06" label="Security" title="Your Stripe key, your customers’ details." onDark />
          </div>
          <dl className="border-t border-linen/25 lg:col-span-8">
            {safeguards.map((s) => (
              <div key={s.title} className="grid gap-2 border-b border-linen/25 py-5 sm:grid-cols-12 sm:gap-6">
                <dt className="font-heading text-lg leading-snug font-semibold tracking-[-0.02em] sm:col-span-5">{s.title}</dt>
                <dd className="text-[0.9375rem] leading-relaxed text-linen/85 sm:col-span-7">{s.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* i. FAQ */}
      <section aria-labelledby="faq-title">
        <div className={cn(container, "grid gap-10 py-20 sm:py-24 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <SectionHeading id="faq" index="07" label="Questions" title="What merchants ask first." />
          </div>
          <div className="min-w-0 lg:col-span-8">
            <Faq />
          </div>
        </div>
      </section>

      {/* j. Final CTA */}
      <section aria-labelledby="cta-title" className="border-t border-border bg-card">
        <div className={cn(container, "flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-end lg:justify-between")}>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground/75">Evidence due in</p>
            <Countdown days={6} hours={14} size="xl" className="mt-2" />
            <h2 id="cta-title" className="mt-6 max-w-xl text-3xl leading-tight tracking-[-0.035em] text-balance sm:text-4xl">
              Spend the time on the packet, not on finding the paperwork.
            </h2>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-foreground/80">
              Free for 3 disputes a month. Connect a sandbox key, create the demo disputes, and watch a packet assemble
              itself.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <CtaLink href={links.signUp}>Start free</CtaLink>
            <CtaLink href={links.repo} tone="outline">
              Read the source
            </CtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
