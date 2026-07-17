import { describe, expect, it } from "vitest";
import { parseConfigWithLegacyFallback } from "@/lib/config";
import { applyModelRoleOverrides, defaultModelRolesForDeployments, reasoningProviderOptions } from "@/lib/model-routing";
import type { DeploymentRecord } from "@/lib/types";

function deployment(partial: Partial<DeploymentRecord> & Pick<DeploymentRecord, "name">): DeploymentRecord {
  return {
    id: "d1",
    modelName: null,
    protocol: "chat",
    capabilities: { reasoningEffort: true },
    enabled: true,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("reasoning provider options", () => {
  it("skips reasoning effort for Flash-tier deployments", () => {
    expect(reasoningProviderOptions(deployment({ name: "DeepSeek-V4-Flash" }), "medium")).toBeUndefined();
  });

  it("skips reasoning effort for Kimi on chat completions", () => {
    expect(reasoningProviderOptions(deployment({ name: "Kimi-K2.6", protocol: "chat" }), "high")).toBeUndefined();
  });

  it("passes reasoning effort for Pro deepseek when supported", () => {
    expect(reasoningProviderOptions(deployment({ name: "DeepSeek-V4-Pro", protocol: "deepseek" }), "medium")).toEqual({
      azure: { reasoningEffort: "medium", store: false },
    });
  });
});

describe("model role configuration migration", () => {
  it("uses legacy branch and critic assignments only when per-lane values are absent", () => {
    const config = parseConfigWithLegacyFallback({
      branchDeployment: "legacy-branch",
      criticDeployment: "legacy-critic",
      mapperDeployment: "explicit-mapper",
    });

    expect(config).toMatchObject({
      mapperDeployment: "explicit-mapper",
      alternativeDeployment: "legacy-branch",
      adversarialDeployment: "legacy-branch",
      evidenceDeployment: "legacy-branch",
      criticDeployment: "legacy-critic",
      refinementDeployment: "legacy-critic",
    });
  });

  it("uses the quality-first route for a new configuration", () => {
    const config = parseConfigWithLegacyFallback({});
    expect(config).toMatchObject({
      chatDeployment: "DeepSeek-V4-Pro",
      memoryDeployment: "DeepSeek-V4-Flash",
      mapperDeployment: "Kimi-K2.6",
      alternativeDeployment: "DeepSeek-V4-Flash",
      adversarialDeployment: "DeepSeek-V4-Pro",
      evidenceDeployment: "Kimi-K2.6",
      criticDeployment: "DeepSeek-V4-Pro",
      refinementDeployment: "DeepSeek-V4-Pro",
      synthesisDeployment: "Kimi-K2.6",
    });
  });

  it("builds setup defaults from the available Azure deployments", () => {
    expect(defaultModelRolesForDeployments(["DeepSeek-V4-Pro", "DeepSeek-V4-Flash", "Kimi-K2.6"])).toMatchObject({
      chatDeployment: "DeepSeek-V4-Pro",
      memoryDeployment: "DeepSeek-V4-Flash",
      mapperDeployment: "Kimi-K2.6",
      alternativeDeployment: "DeepSeek-V4-Flash",
      adversarialDeployment: "DeepSeek-V4-Pro",
      evidenceDeployment: "Kimi-K2.6",
      criticDeployment: "DeepSeek-V4-Pro",
      refinementDeployment: "DeepSeek-V4-Pro",
      synthesisDeployment: "Kimi-K2.6",
    });
  });

  it("keeps setup usable when only one deployment is available", () => {
    expect(defaultModelRolesForDeployments(["DeepSeek-V4-Pro"])).toMatchObject({
      chatDeployment: "DeepSeek-V4-Pro",
      memoryDeployment: "DeepSeek-V4-Pro",
      mapperDeployment: "DeepSeek-V4-Pro",
      synthesisDeployment: "DeepSeek-V4-Pro",
    });
  });

  it("applies legacy setup role overrides before explicit per-lane overrides", () => {
    const base = defaultModelRolesForDeployments(["DeepSeek-V4-Pro", "DeepSeek-V4-Flash", "Kimi-K2.6"]);
    expect(applyModelRoleOverrides(base, {
      branchDeployment: "legacy-branch",
      criticDeployment: "legacy-critic",
      synthesisDeployment: "legacy-final",
      mapperDeployment: "explicit-mapper",
    })).toMatchObject({
      mapperDeployment: "explicit-mapper",
      alternativeDeployment: "legacy-branch",
      adversarialDeployment: "legacy-branch",
      evidenceDeployment: "legacy-branch",
      criticDeployment: "legacy-critic",
      refinementDeployment: "legacy-critic",
      synthesisDeployment: "legacy-final",
    });
  });
});
