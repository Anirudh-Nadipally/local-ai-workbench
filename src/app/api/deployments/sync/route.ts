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
      const identity = `${item.name} ${item.modelName ?? ""}`;
      const claudeDeployment = /claude|anthropic/i.test(identity);
      const lunaDeployment = /gpt[- ]?5\.6[- ]?luna/i.test(identity);
      upsertDeployment({
        name: item.name,
        modelName: item.modelName ?? undefined,
        protocol: claudeDeployment && (!existing || existing.protocol === "auto") ? "anthropic" : lunaDeployment && (!existing || existing.protocol === "auto") ? "responses" : undefined,
        capabilities: lunaDeployment ? { imageInput: true, vision: true, reasoning: true, reasoningEffort: true } : undefined,
        enabled: existing ? undefined : /deepseek|kimi|claude|anthropic/i.test(identity) || lunaDeployment,
      });
    }
    return Response.json({ deployments: listDeployments(true), discovered: discovered.length });
  } catch (error) { return apiError(error); }
}
