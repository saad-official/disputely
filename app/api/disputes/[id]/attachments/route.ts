import { errorResponse, orgContextOr401 } from "@/app/api/_lib/respond";
import { formText, readUpload } from "@/app/api/_lib/upload";
import { removeAttachment, uploadAttachment } from "@/lib/services/packets";

/**
 * POST multipart/form-data `file` + `field` (a Stripe evidence file field):
 * stores the file on the packet and uploads it to Stripe (purpose
 * dispute_evidence). DELETE `?attachmentId=` removes one.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: RouteContext<"/api/disputes/[id]/attachments">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const upload = await readUpload(request);
  if (upload instanceof Response) return upload;
  try {
    const result = await uploadAttachment(ctx.org.id, id, upload.file, formText(upload.form, "field") ?? "");
    return Response.json(
      {
        id: result.attachment.id,
        fileName: result.attachment.fileName,
        field: result.attachment.field,
        stripeFileId: result.stripeFileId,
        warning: result.warning,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, "attachment upload");
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/disputes/[id]/attachments">) {
  const ctx = await orgContextOr401();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const attachmentId = new URL(request.url).searchParams.get("attachmentId") ?? "";
  try {
    await removeAttachment(ctx.org.id, id, attachmentId);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "attachment delete");
  }
}
