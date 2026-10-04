import "server-only";
import type Stripe from "stripe";
import type { generateStructured } from "@/lib/ai/generate";
import { logAgentEvent, type AgentEventInput } from "@/lib/ai/log";
import { getDb } from "@/lib/db/client";
import type { EmailProvider } from "@/lib/email/provider";
import { publicEnv } from "@/lib/env";

/**
 * The slice of the Stripe client the services call with a merchant's
 * restricted key. Tests pass a stub with the same shape (cast), so nothing
 * touches the network.
 */
export type MerchantStripe = {
  disputes: Pick<Stripe["disputes"], "list" | "retrieve" | "update">;
  customers: Pick<Stripe["customers"], "retrieve">;
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "list" | "listLineItems"> };
  files: Pick<Stripe["files"], "create">;
  paymentIntents: Pick<Stripe["paymentIntents"], "create">;
};

/**
 * Injectable dependencies shared by the services. Production leaves them
 * unset (a real Stripe client per key, Groq/Gemini, the configured email
 * provider, the wall clock); tests pass stubs.
 */
export type ServiceDeps = {
  /** Builds a Stripe client for an API key (the merchant's decrypted restricted key). */
  stripeClient?: (apiKey: string) => MerchantStripe;
  /** Structured model call (lib/ai/generate.ts). */
  generate?: typeof generateStructured;
  emailProvider?: EmailProvider;
  now?: () => Date;
  /** Waits between polls (demo); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
};

export function nowFrom(deps?: ServiceDeps): Date {
  return deps?.now ? deps.now() : new Date();
}

export function sleepFrom(deps?: ServiceDeps): (ms: number) => Promise<void> {
  return deps?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

/** Append-only audit log; never throws. */
export async function audit(event: AgentEventInput): Promise<void> {
  await logAgentEvent(await getDb(), event);
}

/** Absolute app origin without a trailing slash. */
export function appOrigin(): string {
  return publicEnv.appUrl.replace(/\/+$/, "");
}

/** Plain text -> minimal HTML: every character escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${escapeHtml(para).replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stripe SDK errors carry `type` (StripeAuthenticationError, StripePermissionError, ...). */
export function stripeErrorType(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const type = (error as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}
