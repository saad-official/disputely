import "server-only";
import { MAX_UPLOAD_BYTES } from "@/lib/services/plan-limits";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export type UploadedFile = { fileName: string; mimeType: string; bytes: Uint8Array };

/**
 * Reads `multipart/form-data` with a `file` field. Returns a 400/413 Response
 * when the body is not a form or the file is missing or too large.
 */
export async function readUpload(request: Request): Promise<{ form: FormData; file: UploadedFile } | Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  // Multipart overhead is small; anything far above the file cap is refused before parsing.
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json({ error: `The file is larger than ${MAX_UPLOAD_MB} MB.`, code: "too_large" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send the file as multipart/form-data.", code: "invalid_input" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a file to upload.", code: "invalid_input" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `${file.name} is larger than ${MAX_UPLOAD_MB} MB.`, code: "too_large" }, { status: 413 });
  }
  return {
    form,
    file: { fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
  };
}

export function formText(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
