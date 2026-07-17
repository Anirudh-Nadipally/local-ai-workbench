import { apiError, apiGuard } from "@/lib/api";
import { discoverDeployments } from "@/lib/azure";
import { getApiKey, readConfig } from "@/lib/config";
import { getDeployment, listDeployments, upsertDeployment } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const config = readConfig();
    const apiKey = getApiKey();
    if (!config.endpoint || !apiKey) throw new Error("Configure Azure before synchronizing deployments.");
    const discovered = await discoverDeployments(config.endpoint, config.endpointKind, apiKey);
    for (const item of discovered) {
      const existing = getDeployment(item.name);
      upsertDeployment({
        name: item.name,
        modelName: item.modelName ?? undefined,
        enabled: existing ? undefined : /deepseek|kimi/i.test(`${item.name} ${item.modelName ?? ""}`),
      });
    }
    return Response.json({ deployments: listDeployments(true), discovered: discovered.length });
  } catch (error) { return apiError(error); }
}
