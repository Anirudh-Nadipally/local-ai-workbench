import fs from "node:fs/promises";
import { apiError, apiGuard } from "@/lib/api";
import { resolveStoredUploadPath } from "@/lib/paths";
import { deleteFile, getFile, getFileChunks } from "@/lib/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request); const { id } = await context.params; const file = getFile(id);
    if (!file) return apiError(new Error("File not found."), 404);
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
