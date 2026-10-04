import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { writeNarrative } from "@/lib/services/packets";

/** POST: write (or rewrite) the statement with the model, under the guardrails. */
export const maxDuration = 60;

export async function POST(_request: Request, { params }: RouteContext<"/api/disputes/[id]/narrative">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const result = await writeNarrative(ctx.org.id, id);
    return Response.json({
      chars: result.packet.narrative.length,
      verified: result.verifiedCount,
      removed: result.removedCount,
      ok: result.ok,
    });
  } catch (error) {
    return errorResponse(error, "narrative");
  }
}
