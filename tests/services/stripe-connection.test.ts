import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptSecret, encryptSecret } from "@/lib/crypto/secretbox";
import type { DbHandle } from "@/lib/db/client";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import { ServiceError } from "@/lib/services/errors";
import {
  connectStripeKey,
  connectedKeyMode,
  disconnectStripe,
  getMerchantStripe,
  validateKeyFormat,
} from "@/lib/services/stripe-connection";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { fakeStripe, stripeError, TEST_KEY, useEncryptionKey } from "./helpers";

let handle: DbHandle;
let restoreKey: () => void;

beforeAll(async () => {
  restoreKey = useEncryptionKey();
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
  restoreKey();
});

describe("validateKeyFormat", () => {
  it("refuses secret and publishable keys with a reason", () => {
    expect(() => validateKeyFormat("sk_test_FixtureSk001")).toThrow(/secret key/);
    expect(() => validateKeyFormat("pk_test_51AbCdEfGhIjKlMnOp")).toThrow(/publishable key/);
    expect(() => validateKeyFormat("hello")).toThrow(/rk_test_/);
  });

  it("accepts a test restricted key and refuses live keys unless allowed", () => {
    expect(validateKeyFormat(`  ${TEST_KEY} `)).toEqual({ key: TEST_KEY, mode: "test" });
    const live = "rk_live_FixtureLive01";
    expect(() => validateKeyFormat(live)).toThrow(/test mode only/);
    process.env.ALLOW_LIVE_STRIPE_KEYS = "true";
    try {
      expect(validateKeyFormat(live).mode).toBe("live");
    } finally {
      delete process.env.ALLOW_LIVE_STRIPE_KEYS;
    }
  });
});

describe("connectStripeKey", () => {
  it("rejects sk_ keys without calling Stripe", async () => {
    const org = await insertOrg(handle);
    const fake = fakeStripe();
    await expect(connectStripeKey(org.id, "sk_test_FixtureSk001", null, fake.deps)).rejects.toBeInstanceOf(ServiceError);
    expect(fake.calls.list).toHaveLength(0);
    expect((await organizationsRepo.getById(org.id))?.stripeRestrictedKeyCiphertext).toBeNull();
  });

  it("verifies with one disputes.list call, then stores the key encrypted with a masked label", async () => {
    const org = await insertOrg(handle);
    const fake = fakeStripe();
    const result = await connectStripeKey(org.id, TEST_KEY, "Larkspur sandbox", fake.deps);

    expect(fake.keys).toEqual([TEST_KEY]);
    expect(fake.calls.list).toEqual([{ limit: 1 }]);
    expect(result.mode).toBe("test");
    expect(result.label).toBe(`Larkspur sandbox · rk_test_…${TEST_KEY.slice(-4)}`);

    const stored = await organizationsRepo.getById(org.id);
    expect(stored?.stripeRestrictedKeyCiphertext).toMatch(/^v1\./);
    expect(stored?.stripeRestrictedKeyCiphertext).not.toContain(TEST_KEY);
    expect(decryptSecret(org.id, stored!.stripeRestrictedKeyCiphertext!)).toBe(TEST_KEY);
    expect(stored?.stripeAccountLabel).not.toContain(TEST_KEY);
    expect(stored?.stripeKeyConnectedAt).toBeInstanceOf(Date);
    expect(connectedKeyMode(stored!)).toBe("test");

    // A merchant client gets the decrypted key.
    getMerchantStripe(stored!, fake.deps);
    expect(fake.keys.at(-1)).toBe(TEST_KEY);
  });

  it("explains an authentication or permission failure and stores nothing", async () => {
    const org = await insertOrg(handle);
    const fake = fakeStripe();
    fake.failNextList = stripeError("StripeAuthenticationError", "Invalid API Key provided");
    await expect(connectStripeKey(org.id, TEST_KEY, null, fake.deps)).rejects.toThrow(/didn't accept that key/);
    fake.failNextList = stripeError("StripePermissionError", "The provided key does not have the required permissions");
    await expect(connectStripeKey(org.id, TEST_KEY, null, fake.deps)).rejects.toThrow(/can't read disputes/);
    expect((await organizationsRepo.getById(org.id))?.stripeRestrictedKeyCiphertext).toBeNull();
  });

  it("disconnect clears the key; a client then needs a reconnect", async () => {
    const org = await insertOrg(handle);
    await organizationsRepo.setStripeKey(org.id, encryptSecret(org.id, TEST_KEY), "label");
    await disconnectStripe(org.id);
    const stored = await organizationsRepo.getById(org.id);
    expect(stored?.stripeRestrictedKeyCiphertext).toBeNull();
    expect(() => getMerchantStripe(stored!)).toThrow(/Connect your Stripe account/);
    expect(connectedKeyMode(stored!)).toBeNull();
  });

  it("a ciphertext from another org cannot be used", async () => {
    const a = await insertOrg(handle);
    const b = await insertOrg(handle);
    await organizationsRepo.setStripeKey(b.id, encryptSecret(a.id, TEST_KEY), "copied");
    const stored = await organizationsRepo.getById(b.id);
    expect(() => getMerchantStripe(stored!)).toThrow(/Reconnect Stripe/);
  });
});
