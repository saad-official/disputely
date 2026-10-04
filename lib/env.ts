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
