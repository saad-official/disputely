import { z } from "zod";
import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { buildPacket, MAX_MANUAL_CHARS } from "@/lib/services/packets";

/**
 * POST: (re)assemble the dispute's packet. Optional JSON body
 * `{ manual: { [stripeEvidenceField]: value } }` sets merchant overrides;
 * an empty string clears one.
 */
export const maxDuration = 30;

const Body = z.object({ manual: z.record(z.string(), z.string().max(MAX_MANUAL_CHARS)).optional() }).strict();

export async function POST(request: Request, { params }: RouteContext<"/api/disputes/[id]/packet">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  let body: z.infer<typeof Body> = {};
  const raw = await request.text();
  if (raw.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Send a JSON body.", code: "invalid_input" }, { status: 400 });
    }
    const parsed = Body.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Unexpected packet fields.", code: "invalid_input" }, { status: 400 });
    body = parsed.data;
  }
  try {
    const { packet } = await buildPacket(ctx.org.id, id, { manual: body.manual, actor: "user" });
    return Response.json({ packetId: packet.id, completeness: packet.completeness, missing: packet.missing, status: packet.status });
  } catch (error) {
    return errorResponse(error, "packet build");
  }
}
