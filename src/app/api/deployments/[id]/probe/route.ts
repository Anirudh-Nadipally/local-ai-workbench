import { apiError, apiGuard } from "@/lib/api";
import { probeRegisteredDeployment } from "@/lib/deployment-probes";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request, true);
    const { id } = await context.params;
    return Response.json(await probeRegisteredDeployment(id));
  } catch (error) { return apiError(error); }
}
