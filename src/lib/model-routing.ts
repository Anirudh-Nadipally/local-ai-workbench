import { getAzureModel } from "@/lib/azure";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import { getModelRoles } from "@/lib/config";
import { nowIso } from "@/lib/ids";
import { getDeployment, listDeployments } from "@/lib/repository";
import { MODEL_ROLE_KEYS } from "@/lib/types";
import type {
  DeploymentRecord,
  ModelRoleKey,
  ModelRoleSettings,
  RoutingDeploymentSnapshot,
  SynthesisRoutingSnapshot,
} from "@/lib/types";

type CapabilityRequirement = "textGeneration" | "streaming" | "structuredOutput";

const ROLE_REQUIREMENTS: Record<ModelRoleKey, CapabilityRequirement[]> = {
  chatDeployment: ["textGeneration", "streaming"],
  memoryDeployment: ["textGeneration", "structuredOutput"],
  mapperDeployment: ["textGeneration"],
  alternativeDeployment: ["textGeneration"],
  adversarialDeployment: ["textGeneration"],
  evidenceDeployment: ["textGeneration"],
  criticDeployment: ["textGeneration"],
  refinementDeployment: ["textGeneration"],
  synthesisDeployment: ["textGeneration"],
};

export const ROLE_FALLBACKS: Record<ModelRoleKey, string[]> = {
  chatDeployment: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash", "Kimi-K2.6"],
  memoryDeployment: ["DeepSeek-V4-Flash", "Kimi-K2.6", "DeepSeek-V4-Pro"],
  mapperDeployment: ["Kimi-K2.6", "DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
  alternativeDeployment: ["DeepSeek-V4-Flash", "DeepSeek-V4-Pro", "Kimi-K2.6"],
  adversarialDeployment: ["DeepSeek-V4-Pro", "Kimi-K2.6", "DeepSeek-V4-Flash"],
  evidenceDeployment: ["Kimi-K2.6", "DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
  criticDeployment: ["DeepSeek-V4-Pro", "Kimi-K2.6", "DeepSeek-V4-Flash"],
  refinementDeployment: ["DeepSeek-V4-Pro", "Kimi-K2.6", "DeepSeek-V4-Flash"],
  synthesisDeployment: ["Kimi-K2.6", "DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
};

export const DEFAULT_MODEL_ROLES = Object.fromEntries(
  MODEL_ROLE_KEYS.map((role) => [role, ROLE_FALLBACKS[role][0]]),
) as ModelRoleSettings;

type LegacyRoleOverrides = {
  branchDeployment?: string;
  criticDeployment?: string;
  synthesisDeployment?: string;
};

export function defaultModelRolesForDeployments(availableDeploymentNames: string[] = []): ModelRoleSettings {
  const available = uniqueNonEmpty(availableDeploymentNames);
  const availableSet = new Set(available);
  return Object.fromEntries(MODEL_ROLE_KEYS.map((role) => {
    const preferred = ROLE_FALLBACKS[role].find((name) => availableSet.has(name));
    return [role, preferred ?? available[0] ?? DEFAULT_MODEL_ROLES[role]];
  })) as ModelRoleSettings;
}

export function applyModelRoleOverrides(
  base: ModelRoleSettings,
  overrides: Partial<ModelRoleSettings> & LegacyRoleOverrides = {},
): ModelRoleSettings {
  const next = { ...base };
  const branchDeployment = cleanRoleOverride(overrides.branchDeployment);
  const criticDeployment = cleanRoleOverride(overrides.criticDeployment);
  const synthesisDeployment = cleanRoleOverride(overrides.synthesisDeployment);
  if (branchDeployment) {
    next.mapperDeployment = branchDeployment;
    next.alternativeDeployment = branchDeployment;
    next.adversarialDeployment = branchDeployment;
    next.evidenceDeployment = branchDeployment;
  }
  if (criticDeployment) {
    next.criticDeployment = criticDeployment;
    next.refinementDeployment = criticDeployment;
  }
  if (synthesisDeployment) next.synthesisDeployment = synthesisDeployment;
  for (const role of MODEL_ROLE_KEYS) {
    const value = cleanRoleOverride(overrides[role]);
    if (value) next[role] = value;
  }
  return next;
}

export function resolveDeploymentRecord(
  identifier: string,
  requirements: CapabilityRequirement[] = ["textGeneration"],
  options: { requireVerified?: boolean } = {},
) {
  const deployment = getDeployment(identifier);
  if (!deployment) throw new Error(`Azure deployment "${identifier}" is not registered.`);
  if (!deployment.enabled) throw new Error(`Azure deployment "${deployment.name}" is disabled.`);
  if (deployment.protocol === "auto") throw new Error(`Probe ${deployment.name} before assigning or using it; Auto is not a runnable adapter.`);
  const kimiRequiresProbe = /kimi/i.test(`${deployment.name} ${deployment.modelName ?? ""}`) && deployment.capabilities.lastProbeOk !== true;
  assertCapabilities(deployment, requirements, Boolean(options.requireVerified) || kimiRequiresProbe);
  return deployment as DeploymentRecord & { protocol: Exclude<DeploymentRecord["protocol"], "auto"> };
}

export function resolveAzureDeployment(
  identifier: string,
  requirements: CapabilityRequirement[] = ["textGeneration"],
  options: { requireVerified?: boolean } = {},
) {
  const deployment = resolveDeploymentRecord(identifier, requirements, options);
  return { deployment, model: getAzureModel(deployment.name, deployment.protocol) };
}

export function validateModelRoles(roles: ModelRoleSettings) {
  for (const [role, deployment] of Object.entries(roles) as Array<[ModelRoleKey, string]>) {
    try {
      resolveDeploymentRecord(deployment, ROLE_REQUIREMENTS[role], { requireVerified: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The deployment is incompatible.";
      throw new Error(`${roleLabel(role)} cannot use "${deployment}": ${detail}`);
    }
  }
  return roles;
}

export function resolveRoleDeployment(role: ModelRoleKey, requestedDeployment = getModelRoles()[role]) {
  const requirements = ROLE_REQUIREMENTS[role];
  try {
    const deployment = resolveDeploymentRecord(requestedDeployment, requirements, { requireVerified: true });
    return { deployment, requestedDeployment, adjustmentReason: null as string | null };
  } catch (requestedError) {
    const candidates = orderedCandidates(role, requestedDeployment);
    for (const candidate of candidates) {
      try {
        const deployment = resolveDeploymentRecord(candidate, requirements, { requireVerified: true });
        return {
          deployment,
          requestedDeployment,
          adjustmentReason: `${requestedDeployment} was unavailable or incompatible for ${roleLabel(role)}; routed to ${deployment.name}.`,
        };
      } catch { /* try the next capability-verified deployment */ }
    }
    const detail = requestedError instanceof Error ? requestedError.message : "No compatible deployment is available.";
    throw new Error(`${roleLabel(role)} has no compatible probed deployment. ${detail}`);
  }
}

export function buildSynthesisRoutingSnapshot(): SynthesisRoutingSnapshot {
  const lane = (role: ModelRoleKey): RoutingDeploymentSnapshot => {
    const resolved = resolveRoleDeployment(role);
    const deployment = resolved.deployment;
    return {
      id: deployment.id,
      name: deployment.name,
      modelName: deployment.modelName,
      protocol: deployment.protocol,
      capabilities: deployment.capabilities,
      requestedDeployment: resolved.requestedDeployment,
      adjustmentReason: resolved.adjustmentReason,
    };
  };
  return {
    version: 1,
    createdAt: nowIso(),
    lanes: {
      mapper: lane("mapperDeployment"),
      alternative: lane("alternativeDeployment"),
      adversary: lane("adversarialDeployment"),
      evidence: lane("evidenceDeployment"),
      critic: lane("criticDeployment"),
      refinement: lane("refinementDeployment"),
      synthesis: lane("synthesisDeployment"),
    },
  };
}

export function reasoningProviderOptions(deployment: DeploymentRecord, effort: "none" | "low" | "medium" | "high"): SharedV3ProviderOptions | undefined {
  if (deployment.protocol === "anthropic") {
    const identity = `${deployment.name} ${deployment.modelName ?? ""}`;
    const supportsAdaptiveThinking = /claude[- ]?(?:fable|sonnet|opus)?[- ]?5/i.test(identity);
    return {
      anthropic: {
        cacheControl: { type: "ephemeral" },
        ...(supportsAdaptiveThinking
          ? effort === "none"
            ? { thinking: { type: "disabled" } }
            : { thinking: { type: "adaptive", display: "summarized" }, effort }
          : {}),
      },
    };
  }
  if (effort === "none" || deployment.capabilities.reasoningEffort !== true) return undefined;
  const identity = `${deployment.name} ${deployment.modelName ?? ""}`;
  // Flash-tier models on Foundry often accept chat but not Azure reasoning-effort knobs.
  if (/flash/i.test(identity)) return undefined;
  if (/kimi/i.test(identity) && deployment.protocol === "chat") return undefined;
  return { azure: { reasoningEffort: effort, store: false } };
}

export function getRoleRoutingStatus(roles = getModelRoles()) {
  const effective = {} as ModelRoleSettings;
  const adjustments: Array<{ role: ModelRoleKey; requestedDeployment: string; deployment: string; reason: string }> = [];
  const errors: Array<{ role: ModelRoleKey; requestedDeployment: string; reason: string }> = [];
  for (const role of Object.keys(roles) as ModelRoleKey[]) {
    try {
      const resolved = resolveRoleDeployment(role, roles[role]);
      effective[role] = resolved.deployment.name;
      if (resolved.adjustmentReason) adjustments.push({
        role,
        requestedDeployment: roles[role],
        deployment: resolved.deployment.name,
        reason: resolved.adjustmentReason,
      });
    } catch (error) {
      effective[role] = roles[role];
      errors.push({
        role,
        requestedDeployment: roles[role],
        reason: error instanceof Error ? error.message : "No compatible deployment is available.",
      });
    }
  }
  return {
    roles,
    effective,
    adjustments,
    errors,
    error: errors.length ? errors.map((item) => item.reason).join(" ") : undefined,
  };
}

function orderedCandidates(role: ModelRoleKey, requestedDeployment: string) {
  const available = listDeployments().map((deployment) => deployment.name);
  return [...ROLE_FALLBACKS[role], ...available].filter((name, index, rows) =>
    name !== requestedDeployment && rows.indexOf(name) === index,
  );
}

function assertCapabilities(deployment: DeploymentRecord, requirements: CapabilityRequirement[], requireVerified: boolean) {
  for (const capability of requirements) {
    const value = deployment.capabilities[capability];
    if (value === false) throw new Error(`${deployment.name} does not support ${capabilityLabel(capability)}.`);
    if (requireVerified && value !== true) throw new Error(`${deployment.name} has not verified ${capabilityLabel(capability)}; probe it first.`);
  }
}

function roleLabel(role: ModelRoleKey) {
  return role.replace(/Deployment$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function capabilityLabel(capability: CapabilityRequirement) {
  if (capability === "structuredOutput") return "structured output";
  if (capability === "textGeneration") return "text generation";
  return "streaming";
}

function uniqueNonEmpty(values: string[]) {
  return values.map(cleanRoleOverride).filter((value): value is string => Boolean(value))
    .filter((value, index, rows) => rows.indexOf(value) === index);
}

function cleanRoleOverride(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
