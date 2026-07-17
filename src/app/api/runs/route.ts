import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { assertFilesBelongToProject, assertProjectThread } from "@/lib/integrity";
import { buildSynthesisRoutingSnapshot } from "@/lib/model-routing";
import { createSynthesisJob, createSynthesisRun, listSynthesisRuns, saveMessage } from "@/lib/repository";

const Schema = z.object({
  projectId: z.string(), threadId: z.string(), question: z.string().min(1).max(30_000),
  branchDeployment: z.string().optional(), criticDeployment: z.string().optional(), synthesisDeployment: z.string().optional(),
  maxBranches: z.number().int().min(1).max(5).default(4), refinementRounds: z.number().int().min(0).max(1).default(1),
  fileIds: z.array(z.string()).max(10).default([]),
});

export async function GET(request: Request) {
  try { apiGuard(request); const id = new URL(request.url).searchParams.get("threadId"); if (!id) throw new Error("threadId is required."); return Response.json({ runs: listSynthesisRuns(id) }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    apiGuard(request, true); const input = Schema.parse(await request.json());
    assertProjectThread(input.projectId, input.threadId);
    assertFilesBelongToProject(input.fileIds, input.projectId);
    saveMessage({ threadId: input.threadId, role: "user", content: input.question });
    const routingSnapshot = buildSynthesisRoutingSnapshot();
    const run = createSynthesisRun({
      ...input,
      branchDeployment: routingSnapshot.lanes.mapper.name,
      criticDeployment: routingSnapshot.lanes.critic.name,
      synthesisDeployment: routingSnapshot.lanes.synthesis.name,
      routingSnapshot,
    });
    const job = createSynthesisJob(run.id); return Response.json({ run, job });
  } catch (error) { return apiError(error); }
}
