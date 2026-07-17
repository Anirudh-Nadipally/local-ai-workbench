import { apiError, apiGuard } from "@/lib/api";
import { getSqlite } from "@/lib/db";
import { listThreads } from "@/lib/repository";

export async function GET(request: Request) {
  try {
    apiGuard(request); const url = new URL(request.url); const q = url.searchParams.get("q")?.trim() ?? ""; const projectId = url.searchParams.get("projectId") ?? undefined;
    if (!q) return Response.json({ threads: [], files: [] });
    const files = getSqlite().prepare("SELECT id,original_name AS name,status,summary FROM files WHERE (? IS NULL OR project_id=?) AND (original_name LIKE ? OR summary LIKE ?) ORDER BY updated_at DESC LIMIT 20")
      .all(projectId ?? null, projectId ?? null, `%${q}%`, `%${q}%`);
    return Response.json({ threads: listThreads(projectId, q).slice(0, 20), files });
  } catch (error) { return apiError(error); }
}
