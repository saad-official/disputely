import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskKey, SecretboxError } from "@/lib/crypto/secretbox";

const ORG_A = "6f1c2a52-6c43-4a7e-9a8f-1f6d2b3c4d5e";
const ORG_B = "0b9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const KEY = Buffer.alloc(32, 0x2a).toString("base64");
const STRIPE_KEY = "rk_test_FixtureKey0002";

let previous: string | undefined;

beforeEach(() => {
  previous = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = previous;
});

/** Flips one bit of the decoded payload at `index` and re-encodes it. */
function tamper(ciphertext: string, index: number): string {
  const bytes = Buffer.from(ciphertext.slice(3), "base64url");
  bytes[index] ^= 0x01;
  return `v1.${bytes.toString("base64url")}`;
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const a = encryptSecret(ORG_A, STRIPE_KEY);
    const b = encryptSecret(ORG_A, STRIPE_KEY);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("rk_test");
    expect(decryptSecret(ORG_A, a)).toBe(STRIPE_KEY);
    expect(decryptSecret(ORG_A, b)).toBe(STRIPE_KEY);
    expect(decryptSecret(ORG_A, encryptSecret(ORG_A, ""))).toBe("");
    expect(decryptSecret(ORG_A, encryptSecret(ORG_A, "ünïcødé ✓"))).toBe("ünïcødé ✓");
  });

  it("fails to decrypt with another organization's id", () => {
    const sealed = encryptSecret(ORG_A, STRIPE_KEY);
    expect(() => decryptSecret(ORG_B, sealed)).toThrow(SecretboxError);
  });

  it("detects tampering with the IV, ciphertext or tag, and bad formats", () => {
    const sealed = encryptSecret(ORG_A, STRIPE_KEY);
    const length = Buffer.from(sealed.slice(3), "base64url").length;
    for (const index of [0, 12, length - 1]) {
      expect(() => decryptSecret(ORG_A, tamper(sealed, index))).toThrow(/Could not decrypt/);
    }
    expect(() => decryptSecret(ORG_A, sealed.replace(/^v1\./, "v2."))).toThrow(/format/);
    expect(() => decryptSecret(ORG_A, "v1.AAAA")).toThrow(/truncated/);
    expect(() => decryptSecret(ORG_A, STRIPE_KEY)).toThrow(SecretboxError);
  });

  it("fails when APP_ENCRYPTION_KEY changes", () => {
    const sealed = encryptSecret(ORG_A, STRIPE_KEY);
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 0x2b).toString("base64");
    expect(() => decryptSecret(ORG_A, sealed)).toThrow(/APP_ENCRYPTION_KEY changed/);
  });

  it("throws a clear error when the key is missing or malformed", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptSecret(ORG_A, STRIPE_KEY)).toThrow(/APP_ENCRYPTION_KEY is not set.*openssl rand -base64 32/);

    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret(ORG_A, STRIPE_KEY)).toThrow(/must be 32 bytes.*got 16 bytes/);

    process.env.APP_ENCRYPTION_KEY = "not base64 at all!";
    expect(() => encryptSecret(ORG_A, STRIPE_KEY)).toThrow(/must be 32 bytes/);

    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(() => encryptSecret("", STRIPE_KEY)).toThrow(/organization id/);
  });
});

describe("maskKey", () => {
  it("shows the Stripe prefix and the last 4 characters", () => {
    expect(maskKey(STRIPE_KEY)).toBe("rk_test_…0002");
    expect(maskKey("  sk_live_abcdefghijklmnopWXYZ ")).toBe("sk_live_…WXYZ");
    expect(maskKey("whsec_abcdefghij9876")).toBe("…9876");
  });

  it("hides everything after the prefix for short keys", () => {
    expect(maskKey("rk_test_abc")).toBe("rk_test_…");
    expect(maskKey("short")).toBe("…");
  });
});
