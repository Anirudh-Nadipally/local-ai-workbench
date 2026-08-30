import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { deleteThread, getDeployment, getLatestReceipt, getThread, listGenerations, listMemoryCandidates, listMemories, listMessages, listRunSteps, listSynthesisRuns, updateThread } from "@/lib/repository";

const UpdateSchema = z.object({ title: z.string().min(1).max(120).optional(), summary: z.string().max(4_000).optional(), deploymentId: z.string().nullable().optional() });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request); const { id } = await context.params; const thread = getThread(id);
    if (!thread) return apiError(new Error("Conversation not found."), 404);
    const runs = listSynthesisRuns(id);
    return Response.json({ thread, messages: listMessages(id), memories: listMemories(thread.projectId, id), candidates: listMemoryCandidates(thread.projectId, id), generations: listGenerations(id), receipt: getLatestReceipt(id) ?? null, runs: runs.map((run) => ({ ...run, steps: listRunSteps(run.id) })) });
  } catch (error) { return apiError(error, 500); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request, true);
    const { id } = await context.params;
    if (!getThread(id)) return apiError(new Error("Conversation not found."), 404);
    const input = UpdateSchema.parse(await request.json());
    if (input.deploymentId) {
      const deployment = getDeployment(input.deploymentId);
      if (!deployment || !deployment.enabled) throw new Error("Choose an enabled deployment.");
    }
    return Response.json({ thread: updateThread(id, input) });
  }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { apiGuard(request, true); const { id } = await context.params; return Response.json({ deleted: deleteThread(id) }); }
  catch (error) { return apiError(error); }
}
