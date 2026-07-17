import { apiError, apiGuard } from "@/lib/api";
import { getJob } from "@/lib/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { apiGuard(request); const { id } = await context.params; const job = getJob(id); return job ? Response.json({ job }) : apiError(new Error("Job not found."), 404); }
  catch (error) { return apiError(error, 500); }
}
