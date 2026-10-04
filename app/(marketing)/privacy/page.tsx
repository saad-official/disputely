import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { links, textLink } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the Disputely demo stores, how the Stripe restricted key is protected, what the narrative model sees, and the services it relies on.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage label="Privacy" title="What the demo keeps, and why" updated="2026-10-04">
      <h2>The short version</h2>
      <ul>
        <li>
          Disputely is a portfolio demo. Please connect a Stripe sandbox key and use the demo disputes, not live
          customer data.
        </li>
        <li>Your Stripe restricted key is encrypted at rest with a key derived for your organisation.</li>
        <li>Disputely never sees full card numbers, and no model is ever sent one.</li>
        <li>It does not sell data, show ads, or train models on what you enter.</li>
      </ul>

      <h2>What is stored</h2>
      <p>
        For your account: your name, email address, organisation name, and a session cookie that keeps you signed in.
        For your workspace: the label of the connected Stripe account, the encrypted restricted key, and your library
        (refund, cancellation and shipping policies with a note of where customers saw them, terms, product
        descriptions), message logs you paste or upload, and shipment records you enter.
      </p>
      <p>
        For each dispute: what Stripe returns about it and the related charge, payment intent, customer and, where
        Stripe Checkout was used, the shipping address and line items. That includes the customer&rsquo;s name, email
        and addresses, the amount, the reason code, the deadline and the evidence details. Each evidence packet stores
        its fields, the narrative and its check results, attachments you add, the PDF, and a snapshot of what was
        submitted. Everything is scoped to your organisation in the app&rsquo;s Postgres database, hosted on Neon.
      </p>

      <h2>Your Stripe key</h2>
      <p>
        Disputely asks for a <strong>restricted</strong> key: read access to disputes, charges, customers and payment
        intents, and write access to disputes. It is encrypted with AES-256-GCM under a key derived for your
        organisation from the app&rsquo;s master key, so a stored value copied to another organisation will not decrypt.
        It is decrypted only on the server, when Disputely calls Stripe for you. You can revoke it in your Stripe
        Dashboard at any time.
      </p>

      <h2>Card numbers</h2>
      <p>
        Stripe&rsquo;s API returns a card&rsquo;s brand and last four digits, not the full number, so Disputely never
        receives one and cannot pass one on.
      </p>

      <h2>Model providers</h2>
      <p>
        The narrative is written by a hosted language model (Groq, with Google Gemini as a fallback). The model is sent
        the facts assembled for that packet (what was bought, when, how it was delivered or accessed, what the customer
        agreed to and what was said) and nothing else from your workspace. Gemini may also be used to read a document
        you upload as evidence. Free tiers of these services may use inputs to improve their products, which is another
        reason the demo asks for test data only. Model calls are logged in your workspace.
      </p>

      <h2>Stripe</h2>
      <p>
        Disputes are read from and submitted to Stripe with your key. Billing for Pro uses Stripe Checkout and the
        customer portal in test mode, so no real card data reaches this app and no money moves.
      </p>

      <h2>Email and analytics</h2>
      <p>
        Deadline reminders go to an in-app outbox by default and are not delivered. Where delivery is switched on,
        mail is sent through Resend; in demo mode every message goes to the operator&rsquo;s own address, labelled with
        the intended recipient. The site uses Vercel Analytics for aggregate page views, without advertising cookies.
      </p>

      <h2>Deleting your data</h2>
      <p>
        To have your account and workspace removed, open an issue on the{" "}
        <a href={links.repo} className={textLink}>
          GitHub repository
        </a>{" "}
        and it will be deleted. See also the{" "}
        <Link href={links.terms} className={textLink}>
          terms
        </Link>
        .
      </p>
    </LegalPage>
  );
}
