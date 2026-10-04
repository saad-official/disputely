# Disputely

**Win more chargebacks, pay a flat fee.** Disputely connects to your Stripe account, shows every open dispute with its deadline, assembles the evidence packet each reason code calls for from Stripe data and your own records, writes a narrative that is verified against the facts, lets you review and submit through the Stripe Disputes API, and tracks what you win.

Part of the [Vibe Build Series](https://github.com/saad-official/vibe-build-series): real products for small businesses, built in public on free tiers.

## Why

A dispute gives a small merchant 7–21 days to submit a bank-readable evidence packet. Assembling one takes the better part of an hour, so merchants skip it or submit generic proof, and manual representment wins only around 12% of the time (vendor figure). The leading automation vendor takes 25% of recovered amounts with no cap. Disputely is a flat monthly price.

**The narrative never states a fact that is not in the packet.** Every date, amount, name and tracking number the model writes is checked against the assembled evidence; anything unverified is removed and flagged.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Neon Postgres · Drizzle ORM · Better Auth · Stripe Disputes API (test mode) · Vercel AI SDK 7 with Groq and Gemini · @react-pdf/renderer · Vitest · Vercel

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # leave DATABASE_URL empty to use embedded PGlite
pnpm dev
```

## Docs

- [Spec](docs/spec.md)

## Live demo

https://getdisputely.vercel.app · Stripe runs in test mode (card `4242 4242 4242 4242`).

1. Sign up (no card). In **Settings**, paste a Stripe **restricted** test key (`rk_test_…`) with the permissions listed on the page. Secret keys are refused; the key is verified with one read call and stored encrypted (AES-256-GCM, per-organisation key derived from `APP_ENCRYPTION_KEY`).
2. On the dashboard, click **Create demo disputes**: three test payments for the fictional store "Larkspur Goods" are made with Stripe's dispute-triggering test payment methods, synced back as real test-mode disputes, and seeded with policies, shipments and message logs.
3. Open a dispute: deadline countdown, the reason-code playbook, completeness with a *how to fix* list, every evidence field with its source, and the narrative with verified facts highlighted and removed claims struck through.
4. Download the PDF packet, upload supporting files (sent to Stripe as `dispute_evidence`), and **Submit** through the Disputes API; demo disputes can simulate a win or a loss with Stripe's `winning_evidence` / `losing_evidence` triggers.
5. Analytics: win rate by reason code, median completeness of submitted packets, recovered amounts by currency. Reminders at 7, 3 and 1 day go to the Outbox.

Verified end to end on 4 Oct 2026 against the production Neon database and a real Stripe test account: restricted key connected (secret keys refused), three test disputes created and synced, packets assembled at 93% completeness, statements written and fact-checked (one fabricated-looking sentence removed and shown), PDF rendered, two packets submitted through the Disputes API with Stripe's winning and losing triggers, outcomes (won $129.00, lost) arrived through the production webhook and the dashboard showed a 50% win rate and $129.00 recovered.

## Known gaps

- Merchant dispute webhooks arrive on the platform endpoint; disputes nobody has synced yet are ignored until the next sync. Per-org endpoints or Stripe Connect are the later fix.
- Demo product descriptions pick up every library item in the same product line, because demo charges carry no Checkout line items.
- No hand-editing of the narrative yet: regenerate it or add field overrides.
