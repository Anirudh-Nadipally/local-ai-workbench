import { apiError, apiGuard } from "@/lib/api";
import { discoverDeployments } from "@/lib/azure";
import { getApiKey, readConfig } from "@/lib/config";
import { deploymentModelNameChanged, getDeploymentProfile } from "@/lib/deployment-profile";
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
      const discoveredModelName = item.modelName?.trim() || null;
      const profile = getDeploymentProfile(item.name, discoveredModelName ?? existing?.modelName);
      const modelChanged = Boolean(existing && discoveredModelName && deploymentModelNameChanged(existing.modelName, discoveredModelName));
      upsertDeployment({
        name: item.name,
        modelName: discoveredModelName ?? undefined,
        protocol: (!existing || existing.protocol === "auto" || modelChanged)
          ? profile.defaultProtocol ?? "auto"
          : undefined,
        enabled: existing ? undefined : profile.enabledByDefault,
      });
    }
    return Response.json({ deployments: listDeployments(true), discovered: discovered.length });
  } catch (error) { return apiError(error); }
}
