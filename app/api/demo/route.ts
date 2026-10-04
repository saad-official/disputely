import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { clearDemo, createDemoDisputes } from "@/lib/services/demo";

/**
 * POST: create the three Larkspur Goods test disputes in the connected
 * Stripe test account (idempotent). DELETE: remove the local demo rows.
 */
export const maxDuration = 60;

export async function POST() {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  try {
    return Response.json(await createDemoDisputes(ctx.org.id));
  } catch (error) {
    return errorResponse(error, "demo create");
  }
}

export async function DELETE() {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  if (ctx.role !== "owner") {
    return Response.json({ error: "Only the workspace owner can clear demo data.", code: "forbidden" }, { status: 403 });
  }
  try {
    return Response.json(await clearDemo(ctx.org.id));
  } catch (error) {
    return errorResponse(error, "demo clear");
  }
}
