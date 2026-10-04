import { attachment, errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { renderPdf } from "@/lib/services/packets";

/** GET: the packet PDF, inline (preview) or `?download=1` as a file. Signed-in org members only. */
export const maxDuration = 60;

export async function GET(request: Request, { params }: RouteContext<"/api/disputes/[id]/pdf">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  try {
    const { bytes, fileName } = await renderPdf(ctx.org.id, id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": download ? attachment(fileName) : `inline; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "packet pdf");
  }
}
