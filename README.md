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
