import { apiError, apiGuard } from "@/lib/api";
import { restoreBackupArchive } from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    apiGuard(request, true); const form = await request.formData(); const file = form.get("backup");
    if (!(file instanceof File)) throw new Error("Choose a backup ZIP.");
    if (file.size > 1024 * 1024 * 1024) throw new Error("Backups may not exceed 1 GB.");
    return Response.json({ restored: await restoreBackupArchive(Buffer.from(await file.arrayBuffer())) });
  } catch (error) { return apiError(error); }
}
