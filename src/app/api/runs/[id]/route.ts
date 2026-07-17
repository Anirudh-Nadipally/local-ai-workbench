import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { cancelSynthesisJobs, createSynthesisJob, getSynthesisRun, listRunSteps, updateSynthesisRun } from "@/lib/repository";

const Schema = z.object({ action: z.enum(["cancel", "retry"]) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { apiGuard(request); const { id } = await context.params; const run = getSynthesisRun(id); return run ? Response.json({ run, steps: listRunSteps(id) }) : apiError(new Error("Run not found."), 404); }
  catch (error) { return apiError(error, 500); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request, true); const { id } = await context.params; const { action } = Schema.parse(await request.json());
    const current = getSynthesisRun(id);
    if (!current) return apiError(new Error("Run not found."), 404);
    if (action === "cancel" && !["queued", "running"].includes(current.status)) {
      return apiError(new Error(`A ${current.status} run cannot be cancelled.`), 409);
    }
    if (action === "retry" && !["failed", "cancelled"].includes(current.status)) {
      return apiError(new Error(`A ${current.status} run cannot be retried.`), 409);
    }
    const run = updateSynthesisRun(id, { status: action === "cancel" ? "cancelled" : "queued", error: null });
    if (action === "cancel") cancelSynthesisJobs(id);
    const job = action === "retry" ? createSynthesisJob(id) : null;
    return Response.json({ run, job });
  }
  catch (error) { return apiError(error); }
}
