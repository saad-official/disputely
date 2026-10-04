import { z } from "zod";
import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { submitPacket } from "@/lib/services/packets";

/**
 * POST `{ confirm: true, testOutcome?: "winning_evidence" | "losing_evidence" }`:
 * submits the packet through the Stripe Disputes API with the merchant's key.
 */
export const maxDuration = 60;

const Body = z
  .object({
    confirm: z.literal(true),
    testOutcome: z.enum(["winning_evidence", "losing_evidence"]).nullish(),
  })
  .strict();

export async function POST(request: Request, { params }: RouteContext<"/api/disputes/[id]/submit">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  if (ctx.role !== "owner") {
    return Response.json({ error: "Only the workspace owner can submit evidence.", code: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "Confirm the submission first.", code: "invalid_input" }, { status: 400 });
  }
  try {
    const result = await submitPacket(ctx.org.id, id, { confirm: body.confirm, testOutcome: body.testOutcome ?? null });
    return Response.json({ status: result.dispute.status, packetStatus: result.packet.status, fields: Object.keys(result.payload) });
  } catch (error) {
    return errorResponse(error, "packet submit");
  }
}
