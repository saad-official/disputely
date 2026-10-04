import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { links, textLink } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using the Disputely demo: what it is, what it is not, and what you are responsible for.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage label="Terms" title="Terms of use" updated="2026-10-04">
      <h2>What Disputely is</h2>
      <p>
        Disputely is a portfolio project, part of the{" "}
        <a href={links.series} className={textLink}>
          Vibe Build Series
        </a>
        , built in public on free tiers. It helps a Stripe merchant assemble and submit evidence for card disputes. It
        is offered as is, without warranties, and may change or go offline at any time.
      </p>

      <h2>Use test data</h2>
      <ul>
        <li>Connect a Stripe sandbox key. The demo disputes are created with Stripe&rsquo;s dispute test cards.</li>
        <li>Billing runs in Stripe test mode. Checkout accepts only Stripe&rsquo;s test cards and no money moves.</li>
        <li>Please do not upload real customer records, real policies you are not allowed to share, or secrets.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <p>
        You are responsible for the evidence you submit and for its accuracy. Disputely checks that every date, amount,
        name and tracking number in its narrative appears in the packet, but it cannot know whether your own records
        are true. Read the packet before you confirm a submission: Stripe accepts one submission per dispute and the
        evidence cannot be edited afterwards.
      </p>

      <h2>No guarantee of outcome</h2>
      <p>
        The cardholder&rsquo;s bank decides every dispute. Disputely does not promise that any dispute will be won, and
        nothing on this site is legal or financial advice. Deadlines shown come from Stripe; reminders are a
        convenience, not a guarantee that you will be notified.
      </p>

      <h2>Your Stripe key</h2>
      <p>
        You choose what the restricted key can do and you can revoke it in Stripe at any time. Disputely uses it only
        to read your disputes and related records and to submit evidence you have confirmed.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not use Disputely to submit evidence you know to be false, to attack the service, or to process data you
        have no right to process. Accounts used that way may be removed.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, bugs and deletion requests go to the{" "}
        <a href={links.repo} className={textLink}>
          GitHub repository
        </a>
        . How data is handled is described in the{" "}
        <Link href={links.privacy} className={textLink}>
          privacy notes
        </Link>
        .
      </p>
    </LegalPage>
  );
}
