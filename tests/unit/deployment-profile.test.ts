import { describe, expect, it } from "vitest";
import { declaredDeploymentCapabilities, deploymentSupportsVisualInput, getDeploymentProfile, reconcileDeploymentCapabilities } from "@/lib/deployment-profile";

describe("deployment profiles", () => {
  it("registers GPT-5.6 visual families as Responses deployments", () => {
    expect(getDeploymentProfile("luna-prod", "GPT-5.6-Luna")).toMatchObject({
      family: "gpt-5.6-luna",
      defaultProtocol: "responses",
      enabledByDefault: true,
      declaredVisualInput: true,
    });
    expect(getDeploymentProfile("sol-prod", "gpt_5.6_sol")).toMatchObject({
      family: "gpt-5.6-sol",
      defaultProtocol: "responses",
      enabledByDefault: true,
      declaredVisualInput: true,
    });
  });

  it("keeps visual declarations separate from measured probe flags", () => {
    const profile = getDeploymentProfile("gpt-5.6-sol");
    expect(declaredDeploymentCapabilities(profile)).toEqual({
      declaredVisualInput: true,
      declaredVisualInputSource: "model-profile",
    });
    expect(declaredDeploymentCapabilities(getDeploymentProfile("generic"))).toEqual({
      declaredVisualInput: false,
      declaredVisualInputSource: null,
    });
  });

  it("treats a nonempty Azure model name as authoritative over the deployment slot name", () => {
    expect(getDeploymentProfile("old-luna-slot", "gpt-5.6-sol").family).toBe("gpt-5.6-sol");
    expect(getDeploymentProfile("sol-prod", "text-only-v2").family).toBe("generic");
  });

  it("clears measured evidence when a deployment identity changes", () => {
    expect(reconcileDeploymentCapabilities({
      current: { declaredVisualInput: true, imageInput: true, vision: true, streaming: true, lastProbeOk: true, adapter: "responses" },
      profile: getDeploymentProfile("sol-prod", "text-only-v2"),
      identityChanged: true,
    })).toEqual({
      declaredVisualInput: false,
      declaredVisualInputSource: null,
      probeRequired: true,
    });
  });

  it("does not let incoming discovery metadata override the effective model declaration", () => {
    expect(reconcileDeploymentCapabilities({
      current: {},
      incoming: { declaredVisualInput: true, declaredVisualInputSource: "stale-discovery" },
      profile: getDeploymentProfile("gpt-5.6-sol", "text-only-v2"),
      identityChanged: false,
    })).toEqual({ declaredVisualInput: false, declaredVisualInputSource: null });
  });

  it("lets an explicit failed visual probe override the model declaration", () => {
    expect(deploymentSupportsVisualInput({
      name: "sol-prod",
      modelName: "gpt-5.6-sol",
      protocol: "responses",
      enabled: true,
      capabilities: { declaredVisualInput: true, imageInput: false, vision: false },
    })).toBe(false);
  });
});
