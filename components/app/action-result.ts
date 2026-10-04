/**
 * What the Server Actions of the signed-in screens return to the UI. Errors
 * are messages that are safe to show; `upgradeUrl` is set when a plan limit
 * was hit, so the UI can link to /billing.
 */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; upgradeUrl?: string };

/** State for `useActionState` forms. */
export type FormActionState = { ok?: boolean; error?: string; upgradeUrl?: string; message?: string };

export const initialFormState: FormActionState = {};

/** JSON error body from app/api routes. */
export type ApiError = { error?: string; code?: string; upgradeUrl?: string };

/** Reads a fetch Response from an app/api route into ok/error. */
export async function readApiResult<T = unknown>(response: Response): Promise<{ ok: true; data: T } | { ok: false; error: string; upgradeUrl?: string }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return { ok: true, data: body as T };
  const e = (body ?? {}) as ApiError;
  return {
    ok: false,
    error: e.error ?? (response.status === 401 ? "Your session expired. Sign in again." : "Something went wrong. Please try again."),
    upgradeUrl: e.upgradeUrl,
  };
}
