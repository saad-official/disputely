# Disputely — product and technical spec

Status: approved design, 2026-10-04. App 6 of the [Vibe Build Series](https://github.com/saad-official/vibe-build-series).

## 1. Problem

A card dispute gives a small online merchant 7–21 days to submit a bank-readable evidence packet. Assembling one (order details, shipping proof, customer communication, the policy the customer accepted, a narrative that matches the reason code) takes the better part of an hour, so merchants skip it or submit generic proof; manual representment wins roughly 12% of the time (vendor figure). The leading automation vendor takes 25% of recovered amounts with no cap, and its Trustpilot reviews (Feb–May 2026) complain about win rates and fees.

Disputely connects to the merchant's Stripe account, lists open disputes with their deadlines, assembles the evidence packet per reason code from Stripe data plus the merchant's own records (tracking numbers, policies, message logs), writes the narrative with a model under strict rules, lets the merchant review and submit through the Stripe Disputes API, and tracks outcomes. Flat monthly price.

## 2. Users and plans

- Owner / ops person at a Stripe-using merchant doing $5k–$500k a month (Shopify Payments later).
- Free: up to 3 disputes a month, manual submit, packet PDF, reason-code playbook.
- Pro ($29/month): unlimited disputes, saved policy library, templates per product line, one-click submit, win-rate analytics, deadline reminders by email.

## 3. Core flows

### 3.1 Connect Stripe
v1 uses a **restricted API key** the merchant creates in Stripe (read disputes, charges, customers, payment intents; write disputes) and pastes into Settings (stored encrypted at rest with a per-org key derived from `APP_ENCRYPTION_KEY`). Stripe Connect OAuth is a later step. In the demo, the user connects a sandbox key; test disputes are created with Stripe's dispute test cards (`4000000000000259` creates a dispute that can be won with the `winning_evidence` text).

### 3.2 Sync
A sync job lists disputes (`stripe.disputes.list`) and pulls the related charge, payment intent, customer, invoice/receipt, and (if a Stripe Checkout session exists) the shipping address and line items. Stored locally with the `due_by` deadline, `reason`, `status`, amount, and `evidence_details`. Webhooks `charge.dispute.created|updated|closed` keep it current between syncs.

### 3.3 Evidence assembly (per reason code, deterministic structure)
Playbooks keyed by Stripe reason: `fraudulent`, `product_not_received`, `product_unacceptable`, `subscription_canceled`, `duplicate`, `credit_not_processed`, `unrecognized`, `general`. Each playbook lists the Stripe evidence fields that matter (`customer_name`, `customer_email_address`, `billing_address`, `shipping_address`, `shipping_carrier`, `shipping_tracking_number`, `shipping_date`, `shipping_documentation`, `customer_communication`, `refund_policy`, `refund_policy_disclosure`, `cancellation_policy`, `access_activity_log`, `service_date`, `uncategorized_text`…) and which merchant inputs are required. The assembler fills fields from synced data and the merchant's library (policies with a `disclosure` statement of where the customer saw them, product descriptions, message logs pasted or uploaded, tracking entered by hand or pulled from a shipment record), computes a **completeness score** and lists what is missing.

### 3.4 Narrative (model, constrained)
`uncategorized_text` is written by the model from the assembled facts only: a structured, bank-reader-friendly summary (what was bought, when, how it was delivered or accessed, what the customer agreed to, what communication happened, why the dispute is invalid), under 2,500 characters, no speculation about the cardholder's motives, no legal threats. Guardrails verify every date, amount, tracking number and name in the narrative appears in the assembled facts; any that does not is removed and flagged. Supporting files (PDFs/images up to Stripe's 5 MB per file) are uploaded as Stripe `File` objects with `purpose: dispute_evidence`.

### 3.5 Review and submit
A packet page shows: deadline countdown, reason-code playbook, completeness, each evidence field with its source, the narrative with highlighted verified facts, attachments, and a preview of the PDF packet (`@react-pdf/renderer`). Submit calls `stripe.disputes.update(id, { evidence, submit: true })` after the owner confirms; Disputely stores the submitted snapshot. Everything is logged to `agent_events`.

### 3.6 Outcomes and analytics
Webhooks mark `won` / `lost`; the dashboard shows open disputes by deadline, amount at stake, win rate by reason code, median completeness of submitted packets, and dollars recovered. Deadline reminders at 7, 3 and 1 day (Outbox provider).

### 3.7 Demo
"Create demo disputes" uses the connected sandbox key to create three test charges with dispute-triggering cards and seeds a policy library and message logs for a fictional store "Larkspur Goods", so the full flow runs against real Stripe test disputes.

## 4. Data model (schema `disputely`)

```
organizations(..., stripe_restricted_key_ciphertext, stripe_account_label), memberships, auth tables
disputes(id, org_id, stripe_dispute_id, charge_id, payment_intent_id, amount_cents, currency, reason, status,
         due_by, customer jsonb, charge jsonb, shipping jsonb, evidence_details jsonb, synced_at)
packets(id, dispute_id, org_id, playbook, fields jsonb, narrative, narrative_meta jsonb, completeness,
        missing jsonb, status: draft|ready|submitted, submitted_at, stripe_response jsonb, pdf bytea)
attachments(id, packet_id, org_id, file_name, mime_type, bytes bytea, stripe_file_id, field)
library_items(id, org_id, kind: refund_policy|cancellation_policy|terms|product_description|shipping_policy|
              disclosure, title, text, url, updated_at)
message_logs(id, org_id, dispute_id null, customer_email, channel, occurred_at, direction, body)
shipments(id, org_id, charge_id, carrier, tracking_number, shipped_at, delivered_at, proof_url)
reminders(id, org_id, dispute_id, kind, sent_at), outbox, agent_events
```

## 5. Identity

Calm under deadline. Type: **Sora** (headings) + **Inter** (body) + **IBM Plex Mono** (ids, amounts). Palette: slate `#1B2430`, linen `#F8F6F1`, **oxide red** `#B4452E` for deadlines and primary actions, steel `#4A6FA5` (submitted), olive `#6B7F3A` (won), grey `#6B7280`. Deadline countdowns in large mono.

## 6. Tests

Playbook field selection per reason code, completeness scoring, narrative guardrails (fact verification), Stripe evidence payload building (unit, with recorded fixtures), PDF packet rendering, reminder scheduling, encryption round-trip for the key.
