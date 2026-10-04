import { NotFoundError } from "@/lib/db/repositories/shared";

/**
 * Service-layer error vocabulary shared by API routes (app/api/_lib/respond.ts).
 * Minimal module created with the data layer; the services layer owns it.
 */
export { NotFoundError };
export { PlanLimitError, isPlanLimitError } from "./plan-limits";

export type ServiceErrorCode = "invalid_input" | "conflict" | "unsupported_file" | "too_large";

const STATUS: Record<ServiceErrorCode, number> = {
  invalid_input: 400,
  conflict: 409,
  unsupported_file: 415,
  too_large: 413,
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
