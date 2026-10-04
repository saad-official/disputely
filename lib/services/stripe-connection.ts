import "server-only";
import Stripe from "stripe";
import { decryptSecret, encryptSecret, maskKey, SecretboxError } from "@/lib/crypto/secretbox";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import type { Organization } from "@/lib/db/types";
import { optionalEnv } from "@/lib/env";
import { NotFoundError, ServiceError } from "./errors";
import { audit, errorText, stripeErrorType, type MerchantStripe, type ServiceDeps } from "./shared";

/**
 * The merchant's Stripe connection (spec 3.1): a restricted key (rk_...)
 * pasted in Settings, verified with one read call, stored encrypted per org
 * (lib/crypto/secretbox.ts). Secret keys (sk_...) are refused: they grant
 * far more than Disputely needs. Live keys are refused unless the deployment
 * sets ALLOW_LIVE_STRIPE_KEYS=true.
 *
 * A client is built per call from the decrypted key and never cached beyond
 * the service call that made it, so a disconnect takes effect immediately.
 */

export type KeyMode = "test" | "live";

/**
 * Restricted-key permissions to grant, as Stripe's dashboard names them
 * (Developers > API keys > Create restricted key). Shown in Settings.
 */
export const REQUIRED_KEY_PERMISSIONS: { resource: string; access: "Read" | "Write"; why: string }[] = [
  { resource: "Disputes", access: "Write", why: "list disputes and submit evidence" },
  { resource: "Files", access: "Write", why: "upload evidence files (purpose dispute_evidence)" },
  { resource: "Charges", access: "Read", why: "amount, card checks, receipt and shipping on the disputed charge" },
  { resource: "Customers", access: "Read", why: "customer name and email" },
  { resource: "PaymentIntents", access: "Write", why: "read the payment; Write only creates demo disputes in test mode" },
  { resource: "Checkout Sessions", access: "Read", why: "line items and the shipping address collected at checkout" },
];

const KEY_PATTERN = /^rk_(test|live)_[A-Za-z0-9]{10,}$/;

export function liveKeysAllowed(): boolean {
  return optionalEnv("ALLOW_LIVE_STRIPE_KEYS") === "true";
}

/** Validates the pasted key's shape and returns its mode. Throws ServiceError with a message to show. */
export function validateKeyFormat(raw: string): { key: string; mode: KeyMode } {
  const key = raw.trim();
  if (!key) throw new ServiceError("invalid_input", "Paste your Stripe restricted key.");
  if (/^sk_(test|live)_/.test(key)) {
    throw new ServiceError(
      "invalid_input",
      "That is a secret key, which can do anything on your Stripe account. Create a restricted key (rk_...) with only the permissions listed below and paste that instead.",
    );
  }
  if (/^pk_(test|live)_/.test(key)) {
    throw new ServiceError("invalid_input", "That is a publishable key. Disputely needs a restricted key (rk_...).");
  }
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new ServiceError("invalid_input", "That doesn't look like a Stripe restricted key (it starts with rk_test_ or rk_live_).");
  const mode = match[1] as KeyMode;
  if (mode === "live" && !liveKeysAllowed()) {
    throw new ServiceError(
      "invalid_input",
      "This deployment runs in Stripe test mode only. Paste a test-mode restricted key (rk_test_...).",
    );
  }
  return { key, mode };
}

export function keyMode(key: string): KeyMode {
  return key.startsWith("rk_live_") ? "live" : "test";
}

function defaultClient(apiKey: string): MerchantStripe {
  return new Stripe(apiKey, {
    appInfo: { name: "Disputely", url: "https://github.com/saad-official/disputely" },
    maxNetworkRetries: 1,
    timeout: 20_000,
  });
}

export function clientForKey(apiKey: string, deps?: ServiceDeps): MerchantStripe {
  return (deps?.stripeClient ?? defaultClient)(apiKey);
}

/** Turns a Stripe SDK error from a merchant-key call into a message the merchant can act on. */
export function stripeFailure(error: unknown, action: string): ServiceError {
  const type = stripeErrorType(error);
  const detail = errorText(error);
  if (type === "StripeAuthenticationError") {
    return new ServiceError("stripe_error", `Stripe rejected the connected key while trying to ${action}. Reconnect Stripe in Settings.`, { cause: error });
  }
  if (type === "StripePermissionError") {
    return new ServiceError(
      "stripe_error",
      `The connected key lacks a permission needed to ${action}. Edit the restricted key in Stripe to grant the permissions listed in Settings. (${detail})`,
      { cause: error },
    );
  }
  if (type === "StripeInvalidRequestError" || type === "StripeCardError") {
    return new ServiceError("stripe_error", `Stripe refused to ${action}: ${detail}`, { cause: error });
  }
  if (type === "StripeRateLimitError") {
    return new ServiceError("stripe_error", "Stripe is rate-limiting requests. Try again in a minute.", { cause: error });
  }
  return new ServiceError("stripe_error", `Stripe could not ${action} right now. Try again in a moment.`, { cause: error });
}

export type ConnectResult = { label: string; mode: KeyMode; connectedAt: Date };

/**
 * Validates, verifies (one `disputes.list({ limit: 1 })` with the key) and
 * stores the key encrypted. The plaintext key is never logged or returned.
 */
export async function connectStripeKey(
  orgId: string,
  rawKey: string,
  label?: string | null,
  deps?: ServiceDeps,
): Promise<ConnectResult> {
  const { key, mode } = validateKeyFormat(rawKey);
  const org = await organizationsRepo.getById(orgId);
  if (!org) throw new NotFoundError("Organization");

  try {
    await clientForKey(key, deps).disputes.list({ limit: 1 });
  } catch (error) {
    const type = stripeErrorType(error);
    await audit({
      orgId,
      actor: "user",
      type: "stripe.connect_failed",
      entityType: "organization",
      entityId: orgId,
      input: { key: maskKey(key) },
      output: { errorType: type },
    });
    if (type === "StripeAuthenticationError") {
      throw new ServiceError("invalid_input", "Stripe didn't accept that key. Check you copied all of it, and that it hasn't been rolled or deleted.");
    }
    if (type === "StripePermissionError") {
      throw new ServiceError(
        "invalid_input",
        "Stripe accepted the key but it can't read disputes. Edit the restricted key in Stripe and grant the permissions listed below.",
      );
    }
    throw stripeFailure(error, "verify the key");
  }

  const masked = maskKey(key);
  const cleanLabel = label?.trim().slice(0, 80);
  const displayLabel = cleanLabel ? `${cleanLabel} · ${masked}` : masked;
  const updated = await organizationsRepo.setStripeKey(orgId, encryptSecret(orgId, key), displayLabel);
  if (!updated) throw new NotFoundError("Organization");
  await audit({
    orgId,
    actor: "user",
    type: "stripe.connected",
    entityType: "organization",
    entityId: orgId,
    output: { label: displayLabel, mode },
  });
  return { label: displayLabel, mode, connectedAt: updated.stripeKeyConnectedAt ?? new Date() };
}

export async function disconnectStripe(orgId: string): Promise<void> {
  await organizationsRepo.clearStripeKey(orgId);
  await audit({ orgId, actor: "user", type: "stripe.disconnected", entityType: "organization", entityId: orgId });
}

type KeyedOrg = Pick<Organization, "id" | "stripeRestrictedKeyCiphertext">;

/** The decrypted restricted key. Throws ServiceError("stripe_not_connected") when none is usable. */
function merchantKey(org: KeyedOrg): string {
  if (!org.stripeRestrictedKeyCiphertext) {
    throw new ServiceError("stripe_not_connected", "Connect your Stripe account in Settings first.");
  }
  try {
    return decryptSecret(org.id, org.stripeRestrictedKeyCiphertext);
  } catch (error) {
    if (error instanceof SecretboxError) {
      throw new ServiceError(
        "stripe_not_connected",
        "The stored Stripe key can no longer be read (the server's encryption key changed). Reconnect Stripe in Settings.",
        { cause: error },
      );
    }
    throw error;
  }
}

/** A Stripe client authenticated with the org's restricted key, for one service call. */
export function getMerchantStripe(org: KeyedOrg, deps?: ServiceDeps): MerchantStripe {
  return clientForKey(merchantKey(org), deps);
}

/** "test" / "live" for the connected key, or null when none is connected or it cannot be read. */
export function connectedKeyMode(org: KeyedOrg): KeyMode | null {
  try {
    return keyMode(merchantKey(org));
  } catch {
    return null;
  }
}
