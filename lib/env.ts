/**
 * Environment access. Everything is optional at parse time so that builds
 * (CI, preview) succeed without secrets; `requireEnv` throws at the point of
 * use with a clear message instead of a vague undefined later on.
 */

const PUBLIC = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Disputely",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
} as const;

export const publicEnv = PUBLIC;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const isProduction = process.env.NODE_ENV === "production";

/**
 * Server only. Name of the variable holding the master key that encrypts each
 * organization's Stripe restricted key (lib/crypto/secretbox.ts): 32 random
 * bytes, base64 (`openssl rand -base64 32`). Read at the point of use so
 * builds never need it.
 */
export const APP_ENCRYPTION_KEY = "APP_ENCRYPTION_KEY";

/** The raw APP_ENCRYPTION_KEY value, or undefined when unset. Validated by secretbox. */
export function appEncryptionKey(): string | undefined {
  return optionalEnv(APP_ENCRYPTION_KEY);
}
