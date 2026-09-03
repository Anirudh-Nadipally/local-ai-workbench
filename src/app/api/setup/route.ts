import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { discoverDeployments } from "@/lib/azure";
import { getApiKey, getSafeConfig, saveConnection } from "@/lib/config";
import { detectEndpointKind, normalizeEndpoint } from "@/lib/endpoint";
import { applyModelRoleOverrides, defaultModelRolesForDeployments } from "@/lib/model-routing";
import { getDeployment, listDeployments, upsertDeployment } from "@/lib/repository";
import { MODEL_ROLE_KEYS } from "@/lib/types";

export const runtime = "nodejs";

const RoleOverridesSchema = z.object({
  ...Object.fromEntries(MODEL_ROLE_KEYS.map((role) => [role, z.string().trim().optional()])),
  branchDeployment: z.string().trim().optional(),
});

const SetupSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  manualDeployments: z.array(z.string().min(1)).max(30).default([]),
  roles: RoleOverridesSchema.default({}),
});

export async function GET(request: Request) {
  try { apiGuard(request); return Response.json({ config: getSafeConfig(), deployments: listDeployments(true) }); }
  catch (error) { return apiError(error, 500); }
}

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = SetupSchema.parse(await request.json());
    const endpoint = normalizeEndpoint(input.endpoint);
    const endpointKind = detectEndpointKind(endpoint);
    const apiKey = input.apiKey?.trim() || getApiKey();
    if (!apiKey) throw new Error("Enter an Azure API key.");

    let discovered: Array<{ name: string; modelName: string | null }> = [];
    let discoveryWarning = "";
    try { discovered = await discoverDeployments(endpoint, endpointKind, apiKey); }
    catch (error) { discoveryWarning = error instanceof Error ? error.message : "Automatic discovery is unavailable."; }
    const all = [...discovered, ...input.manualDeployments.map((name) => ({ name: name.trim(), modelName: null }))]
      .filter((item, index, rows) => item.name && rows.findIndex((row) => row.name === item.name) === index);
    if (!all.length) throw new Error(`${discoveryWarning || "No deployments were returned."} Add at least one deployment name manually.`);
    all.forEach((deployment) => {
      const existing = getDeployment(deployment.name);
      const manuallyRegistered = input.manualDeployments.some((name) => name.trim() === deployment.name);
      const claudeDeployment = /claude|anthropic/i.test(`${deployment.name} ${deployment.modelName ?? ""}`);
      upsertDeployment({
        name: deployment.name,
        modelName: deployment.modelName ?? undefined,
        protocol: existing ? undefined : claudeDeployment ? "anthropic" : undefined,
        enabled: existing ? undefined : (manuallyRegistered || /deepseek|kimi|claude|anthropic/i.test(`${deployment.name} ${deployment.modelName ?? ""}`)),
      });
    });
    const roles = applyModelRoleOverrides(defaultModelRolesForDeployments(all.map((deployment) => deployment.name)), input.roles);
    saveConnection({
      endpoint,
      endpointKind,
      apiKey,
      deployments: {
        ...roles,
        branchDeployment: roles.alternativeDeployment,
      },
    });
    return Response.json({ config: getSafeConfig(), deployments: listDeployments(true), discoveryWarning });
  } catch (error) { return apiError(error); }
}
