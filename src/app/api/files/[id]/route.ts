import fs from "node:fs/promises";
import { apiError, apiGuard } from "@/lib/api";
import { resolveStoredUploadPath } from "@/lib/paths";
import { deleteFile, getFile, getFileChunks } from "@/lib/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request); const { id } = await context.params; const file = getFile(id);
    if (!file) return apiError(new Error("File not found."), 404);
    const url = new URL(request.url);
    if (url.searchParams.get("content") === "1") {
      if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(file.mimeType)) {
        return apiError(new Error("Inline preview is unavailable for this file type."), 415);
      }
      const bytes = await fs.readFile(resolveStoredUploadPath(file.storedName));
      return new Response(bytes, { headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      } });
    }
    return Response.json({ file, chunks: getFileChunks(id, 250) });
  } catch (error) { return apiError(error, 500); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request, true); const { id } = await context.params; const file = getFile(id);
    if (!file) return Response.json({ deleted: false });
    const deleted = deleteFile(id);
    if (deleted) await fs.unlink(resolveStoredUploadPath(file.storedName)).catch(() => undefined);
    return Response.json({ deleted });
  } catch (error) { return apiError(error); }
}
