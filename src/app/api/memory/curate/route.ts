import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { assertProjectThread } from "@/lib/integrity";
import { resolveRoleDeployment } from "@/lib/model-routing";
import { createJob } from "@/lib/repository";

const Schema = z.object({ projectId: z.string(), threadId: z.string(), deployment: z.string().optional() });

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = Schema.parse(await request.json());
    assertProjectThread(input.projectId, input.threadId);
    const routing = resolveRoleDeployment("memoryDeployment");
    const job = createJob("curate-memory", { ...input, deployment: routing.deployment.name });
    return Response.json({ job, routing: {
      requestedDeployment: routing.requestedDeployment,
      deployment: routing.deployment.name,
      adjustmentReason: routing.adjustmentReason,
    } });
  }
  catch (error) { return apiError(error); }
}
