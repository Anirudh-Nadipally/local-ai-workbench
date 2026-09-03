import type { DeploymentProtocol, DeploymentRecord } from "@/lib/types";

export type KnownModelFamily = "gpt-5.6-luna" | "gpt-5.6-sol" | "claude" | "deepseek" | "kimi" | "generic";

export type DeploymentProfile = {
  family: KnownModelFamily;
  defaultProtocol: Exclude<DeploymentProtocol, "auto"> | null;
  enabledByDefault: boolean;
  declaredVisualInput: boolean;
  visualPreparationPriority: number;
};

/**
 * Deployment names are user-defined, while Azure's model name is optional.
 * Keep model-family knowledge in one place so setup, sync, and attachment
 * routing agree without treating declared support as a successful probe.
 */
export function getDeploymentProfile(deploymentName: string, modelName?: string | null): DeploymentProfile {
  // Azure's model name identifies what is actually behind a user-defined
  // deployment slot. Use the slot name only when Azure does not provide one.
  const identity = normalizeIdentity(modelName?.trim() || deploymentName);
  if (identity.includes("gpt56luna")) {
    return { family: "gpt-5.6-luna", defaultProtocol: "responses", enabledByDefault: true, declaredVisualInput: true, visualPreparationPriority: 0 };
  }
  if (identity.includes("gpt56sol")) {
    return { family: "gpt-5.6-sol", defaultProtocol: "responses", enabledByDefault: true, declaredVisualInput: true, visualPreparationPriority: 1 };
  }
  if (identity.includes("claude") || identity.includes("anthropic")) {
    return { family: "claude", defaultProtocol: "anthropic", enabledByDefault: true, declaredVisualInput: true, visualPreparationPriority: 2 };
  }
  if (identity.includes("deepseek")) {
    return { family: "deepseek", defaultProtocol: null, enabledByDefault: true, declaredVisualInput: false, visualPreparationPriority: 3 };
  }
  if (identity.includes("kimi")) {
    return { family: "kimi", defaultProtocol: null, enabledByDefault: true, declaredVisualInput: false, visualPreparationPriority: 3 };
  }
  return { family: "generic", defaultProtocol: null, enabledByDefault: false, declaredVisualInput: false, visualPreparationPriority: 3 };
}

export function declaredDeploymentCapabilities(profile: DeploymentProfile) {
  return {
    declaredVisualInput: profile.declaredVisualInput,
    declaredVisualInputSource: profile.declaredVisualInput ? "model-profile" : null,
  };
}

const PROBE_CAPABILITY_KEYS = [
  "textGeneration",
  "streaming",
  "imageInput",
  "vision",
  "structuredOutput",
  "reasoning",
  "reasoningMetadata",
  "reasoningEffort",
  "thinkingObserved",
  "cacheObserved",
  "contextWindow",
  "lastProbeOk",
  "lastProbeAt",
  "lastProbeLatencyMs",
  "lastProbeError",
  "adapter",
  "adapterErrors",
] as const;

export function reconcileDeploymentCapabilities(input: {
  current: Record<string, boolean | number | string | null>;
  incoming?: Record<string, unknown>;
  profile: DeploymentProfile;
  identityChanged: boolean;
}) {
  const capabilities: Record<string, unknown> = { ...input.current };
  if (input.identityChanged) {
    for (const key of PROBE_CAPABILITY_KEYS) delete capabilities[key];
    capabilities.probeRequired = true;
  }
  return {
    ...capabilities,
    ...(input.incoming ?? {}),
    ...declaredDeploymentCapabilities(input.profile),
  };
}

export function deploymentIdentityChanged(
  current: { modelName: string | null; protocol: DeploymentProtocol },
  next: { modelName: string | null; protocol: DeploymentProtocol },
) {
  return deploymentModelNameChanged(current.modelName, next.modelName)
    || current.protocol !== next.protocol;
}

export function deploymentModelNameChanged(current: string | null, next: string | null) {
  return normalizeIdentity(current ?? "") !== normalizeIdentity(next ?? "");
}

export function deploymentSupportsVisualInput(deployment: Pick<DeploymentRecord, "name" | "modelName" | "protocol" | "enabled" | "capabilities"> | undefined) {
  if (!deployment || !deployment.enabled || deployment.protocol === "auto") return false;
  const measured = deployment.capabilities.imageInput ?? deployment.capabilities.vision;
  if (measured === true) return true;
  if (measured === false) return false;
  if (deployment.capabilities.declaredVisualInput === true) return true;
  return getDeploymentProfile(deployment.name, deployment.modelName).declaredVisualInput;
}

export function visualPreparationRank(deployment: Pick<DeploymentRecord, "name" | "modelName">) {
  return getDeploymentProfile(deployment.name, deployment.modelName).visualPreparationPriority;
}

function normalizeIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
