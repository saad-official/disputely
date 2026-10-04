/**
 * Encryption at rest for per-organization secrets (the merchant's Stripe
 * restricted key, spec 3.1). SERVER SIDE ONLY: it reads APP_ENCRYPTION_KEY
 * and must never be imported from a client component. (No `server-only`
 * import so it stays unit-testable under plain Node.)
 *
 * - Master key: APP_ENCRYPTION_KEY, 32 random bytes, base64.
 * - Per-org key: HKDF-SHA256(master, salt = fixed app label, info = org id),
 *   so a ciphertext copied to another org's row never decrypts.
 * - Cipher: AES-256-GCM with a random 96-bit IV; the org id is also bound as
 *   additional authenticated data.
 * - Format: "v1." + base64url(iv | ciphertext | tag). The version prefix lets
 *   a future scheme coexist with stored v1 values.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { APP_ENCRYPTION_KEY, appEncryptionKey } from "@/lib/env";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from("disputely.secretbox.v1", "utf8");

/** The key is missing or malformed, or a ciphertext cannot be decrypted. Messages never include secrets. */
export class SecretboxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretboxError";
  }
}

function masterKey(): Buffer {
  const raw = appEncryptionKey();
  if (!raw) {
    throw new SecretboxError(
      `${APP_ENCRYPTION_KEY} is not set. Generate one with \`openssl rand -base64 32\` and add it to .env.local.`,
    );
  }
  const trimmed = raw.trim();
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) ? Buffer.from(trimmed, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new SecretboxError(
      `${APP_ENCRYPTION_KEY} must be ${KEY_BYTES} bytes encoded as base64 (got ${key.length} bytes). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

function orgKey(orgId: string): Buffer {
  if (!orgId) throw new SecretboxError("An organization id is required to derive its key.");
  return Buffer.from(hkdfSync("sha256", masterKey(), HKDF_SALT, Buffer.from(orgId, "utf8"), KEY_BYTES));
}

/** Encrypts `plaintext` for one organization. Returns "v1.<base64url>". */
export function encryptSecret(orgId: string, plaintext: string): string {
  const key = orgKey(orgId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(orgId, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, body, tag]).toString("base64url")}`;
}

/**
 * Decrypts a value from `encryptSecret` for the same organization. Throws
 * SecretboxError when the format is unknown, the value was tampered with,
 * it belongs to another organization, or APP_ENCRYPTION_KEY changed.
 */
export function decryptSecret(orgId: string, ciphertext: string): string {
  const [version, payload, extra] = ciphertext.split(".");
  if (version !== VERSION || !payload || extra !== undefined) {
    throw new SecretboxError("Unrecognised encrypted value format.");
  }
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new SecretboxError("Encrypted value is truncated.");
  const key = orgKey(orgId);
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  const body = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(orgId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new SecretboxError(
      "Could not decrypt the stored secret (wrong organization, tampered value, or APP_ENCRYPTION_KEY changed).",
      { cause: error },
    );
  }
}

/**
 * Display form of an API key: its Stripe-style prefix plus the last 4
 * characters, e.g. "rk_test_…a1B2". Keys too short to mask safely show only
 * the prefix.
 */
export function maskKey(key: string): string {
  const value = key.trim();
  const prefix = /^(?:rk|sk|pk)_(?:test|live)_/.exec(value)?.[0] ?? "";
  const rest = value.slice(prefix.length);
  if (rest.length < 8) return `${prefix}…`;
  return `${prefix}…${rest.slice(-4)}`;
}
