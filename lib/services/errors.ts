import { NotFoundError } from "@/lib/db/repositories/shared";

/**
 * Service-layer error vocabulary shared by API routes (app/api/_lib/respond.ts)
 * and Server Actions (app/(app)/_lib/action-errors.ts).
 */
export { NotFoundError };
export { PlanLimitError, isPlanLimitError } from "./plan-limits";

export type ServiceErrorCode =
  | "invalid_input"
  | "conflict"
  | "unsupported_file"
  | "too_large"
  /** No Stripe key connected (or it can no longer be decrypted). */
  | "stripe_not_connected"
  /** Stripe refused or failed the call; `message` says what to do. */
  | "stripe_error"
  /** A dependency (the model) failed; retry later. */
  | "unavailable";

const STATUS: Record<ServiceErrorCode, number> = {
  invalid_input: 400,
  conflict: 409,
  unsupported_file: 415,
  too_large: 413,
  stripe_not_connected: 409,
  stripe_error: 502,
  unavailable: 503,
};

/**
 * A request the service refuses for a reason the user can fix (bad input,
 * wrong state, unsupported file). `message` is safe to show in the UI.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  constructor(code: ServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError || (error instanceof Error && error.name === "NotFoundError");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a repository call whose validation throws plain `Error`s with
 * user-facing messages, and turns those into ServiceError("invalid_input").
 * Driver and Drizzle errors (other names) pass through untouched.
 */
export async function asInvalidInput<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === "Error" && !isServiceError(error)) {
      throw new ServiceError("invalid_input", error.message, { cause: error });
    }
    throw error;
  }
}
