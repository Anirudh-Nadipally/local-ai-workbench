import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { probeRegisteredDeployment } from "@/lib/deployment-probes";
import { listDeployments, upsertDeployment } from "@/lib/repository";

export const runtime = "nodejs";

const DeploymentSchema = z.object({
  name: z.string().trim().min(1), modelName: z.string().trim().nullable().optional(), protocol: z.enum(["auto", "responses", "chat", "deepseek"]).default("auto"), probe: z.boolean().default(false),
});

export async function GET(request: Request) {
  try { apiGuard(request); return Response.json({ deployments: listDeployments(true) }); }
  catch (error) { return apiError(error, 500); }
}

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = DeploymentSchema.parse(await request.json());
    let deployment = upsertDeployment({ ...input, enabled: true });
    let probe = null;
    if (input.probe) {
      const result = await probeRegisteredDeployment(deployment.id);
      deployment = result.deployment;
      probe = result.probe;
    }
    return Response.json({ deployment, probe });
  } catch (error) { return apiError(error); }
}
