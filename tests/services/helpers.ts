/**
 * Shared fakes for the service tests: an in-memory Stripe (only the calls
 * the services make with a merchant key) and a stub model. Each test file
 * calls `vi.mock("server-only")` itself and uses tests/db/helpers.ts for the
 * PGlite database.
 */
import type Stripe from "stripe";
import { vi } from "vitest";
import type { CallMeta } from "@/lib/ai/generate";
import type { MerchantStripe, ServiceDeps } from "@/lib/services/shared";

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
export const TEST_KEY = "rk_test_FixtureKey0001";

export function useEncryptionKey(): () => void {
  const previous = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  return () => {
    if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previous;
  };
}

const DAY_S = 24 * 60 * 60;

export type FakeDisputeInput = {
  id: string;
  chargeId: string;
  paymentIntentId?: string | null;
  amount?: number;
  currency?: string;
  reason?: string;
  status?: Stripe.Dispute.Status;
  created?: number;
  dueInDays?: number | null;
  livemode?: boolean;
  metadata?: Record<string, string>;
  customerName?: string | null;
  email?: string | null;
  billingAddress?: Stripe.Address | null;
  shipping?: Stripe.Charge.Shipping | null;
  description?: string | null;
};

/** A Stripe dispute with `charge` expanded, as `disputes.list({ expand })` returns it. */
export function fakeDispute(input: FakeDisputeInput): Stripe.Dispute {
  const created = input.created ?? Math.floor(Date.now() / 1000) - 3600;
  const due = input.dueInDays === null ? null : created + (input.dueInDays ?? 10) * DAY_S;
  const charge = {
    id: input.chargeId,
    object: "charge",
    created: created - 86_400,
    customer: null,
    description: input.description ?? "Larkspur Goods order",
    receipt_email: input.email ?? "jordan.ellis@example.com",
    receipt_url: null,
    receipt_number: null,
    amount_refunded: 0,
    metadata: input.metadata ?? {},
    billing_details: {
      name: input.customerName ?? null,
      email: null,
      phone: null,
      address: input.billingAddress ?? null,
    },
    shipping: input.shipping ?? null,
    payment_method_details: {
      type: "card",
      card: { brand: "visa", last4: "0259", exp_month: 12, exp_year: 2030, checks: { cvc_check: "pass" } },
    },
  };
  return {
    id: input.id,
    object: "dispute",
    amount: input.amount ?? 12_900,
    currency: input.currency ?? "usd",
    reason: input.reason ?? "fraudulent",
    status: input.status ?? "needs_response",
    created,
    livemode: input.livemode ?? false,
    is_charge_refundable: true,
    charge,
    payment_intent: input.paymentIntentId ?? null,
    evidence_details: { due_by: due, has_evidence: false, past_due: false, submission_count: 0 },
    enhanced_eligibility_types: [],
  } as unknown as Stripe.Dispute;
}

function list<T>(data: T[]) {
  return Promise.resolve({ object: "list", data, has_more: false, url: "/v1/x" });
}

export type FakeStripe = {
  client: MerchantStripe;
  /** Disputes the account "has"; tests mutate this between calls. */
  disputes: Stripe.Dispute[];
  keys: string[];
  calls: {
    list: unknown[];
    retrieve: string[];
    update: Array<{ id: string; params: Stripe.DisputeUpdateParams }>;
    files: Stripe.FileCreateParams[];
    paymentIntents: Stripe.PaymentIntentCreateParams[];
  };
  deps: ServiceDeps;
  /** Make the next `disputes.list` throw this. */
  failNextList?: unknown;
  /** Called on paymentIntents.create; return the charge id, or throw. */
  onPaymentIntent?: (params: Stripe.PaymentIntentCreateParams, n: number) => string;
};

export function fakeStripe(initial: Stripe.Dispute[] = []): FakeStripe {
  const fake: FakeStripe = {
    disputes: [...initial],
    keys: [],
    calls: { list: [], retrieve: [], update: [], files: [], paymentIntents: [] },
    client: undefined as unknown as MerchantStripe,
    deps: {},
  };
  let fileN = 0;
  let piN = 0;
  const client = {
    disputes: {
      list: vi.fn((params?: unknown) => {
        fake.calls.list.push(params);
        if (fake.failNextList) {
          const error = fake.failNextList;
          fake.failNextList = undefined;
          return Promise.reject(error);
        }
        return list(fake.disputes);
      }),
      retrieve: vi.fn((id: string) => {
        fake.calls.retrieve.push(id);
        const found = fake.disputes.find((d) => d.id === id);
        if (!found) return Promise.reject(Object.assign(new Error(`No such dispute: ${id}`), { type: "StripeInvalidRequestError" }));
        return Promise.resolve(found);
      }),
      update: vi.fn((id: string, params: Stripe.DisputeUpdateParams) => {
        fake.calls.update.push({ id, params });
        const found = fake.disputes.find((d) => d.id === id);
        if (!found) return Promise.reject(Object.assign(new Error(`No such dispute: ${id}`), { type: "StripeInvalidRequestError" }));
        const trigger = params.evidence?.uncategorized_text;
        const status: Stripe.Dispute.Status =
          trigger === "winning_evidence" ? "won" : trigger === "losing_evidence" ? "lost" : "under_review";
        Object.assign(found, {
          status,
          evidence_details: { ...found.evidence_details, has_evidence: true, submission_count: 1 },
        });
        return Promise.resolve({ ...found, charge: typeof found.charge === "string" ? found.charge : found.charge.id });
      }),
    },
    customers: { retrieve: vi.fn(() => Promise.reject(new Error("no customer"))) },
    checkout: {
      sessions: {
        list: vi.fn(() => list([])),
        listLineItems: vi.fn(() => list([])),
      },
    },
    files: {
      create: vi.fn((params: Stripe.FileCreateParams) => {
        fake.calls.files.push(params);
        fileN += 1;
        return Promise.resolve({ id: `file_test${fileN}`, object: "file", purpose: params.purpose });
      }),
    },
    paymentIntents: {
      create: vi.fn((params: Stripe.PaymentIntentCreateParams) => {
        fake.calls.paymentIntents.push(params);
        piN += 1;
        const chargeId = fake.onPaymentIntent ? fake.onPaymentIntent(params, piN) : `ch_demo${piN}`;
        return Promise.resolve({ id: `pi_demo${piN}`, object: "payment_intent", status: "succeeded", latest_charge: chargeId });
      }),
    },
  };
  fake.client = client as unknown as MerchantStripe;
  fake.deps = {
    stripeClient: (key: string) => {
      fake.keys.push(key);
      return fake.client;
    },
    sleep: async () => {},
  };
  return fake;
}

export function stubMeta(overrides: Partial<CallMeta> = {}): CallMeta {
  return { model: "stub-model", promptVersion: "narrative/v1", tokensIn: 100, tokensOut: 50, latencyMs: 5, attempts: 1, ...overrides };
}

/** A `generate` stub that returns this narrative. */
export function stubGenerate(narrative: string, confidence = 0.9): NonNullable<ServiceDeps["generate"]> {
  return (async () => ({ object: { narrative, factsUsed: [], confidence }, meta: stubMeta() })) as unknown as NonNullable<
    ServiceDeps["generate"]
  >;
}

export function stripeError(type: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { type, ...extra });
}
