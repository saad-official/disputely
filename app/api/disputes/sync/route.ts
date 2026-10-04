import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { syncDisputes } from "@/lib/services/sync";

/** POST: pull the newest disputes from the merchant's Stripe account. */
export const maxDuration = 60;

export async function POST() {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  try {
    return Response.json(await syncDisputes(ctx.org.id, { actor: "user" }));
  } catch (error) {
    return errorResponse(error, "dispute sync");
  }
}
