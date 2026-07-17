import { apiError, apiGuard } from "@/lib/api";
import { createBackupArchive } from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    apiGuard(request); const buffer = await createBackupArchive(); const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="local-ai-workbench-${stamp}.zip"` } });
  } catch (error) { return apiError(error, 500); }
}
