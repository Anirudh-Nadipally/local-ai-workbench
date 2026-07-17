import { describe, expect, it } from "vitest";
import { inferAdapterCandidates, probeAzureDeployment, type DeploymentProbeDriver } from "@/lib/azure";

describe("Azure adapter routing", () => {
  it("tries the DeepSeek adapter before generic chat surfaces", () => {
    expect(inferAdapterCandidates("DeepSeek-V4-Flash", "DeepSeek-V4-Flash", "auto")).toEqual([
      "deepseek",
      "chat",
      "responses",
    ]);
  });

  it("tries Kimi on Chat Completions before Responses", () => {
    expect(inferAdapterCandidates("Kimi-K2.6", "Kimi-K2.6", "auto")).toEqual([
      "chat",
      "responses",
    ]);
  });

  it("uses Responses then Chat for an unknown model", () => {
    expect(inferAdapterCandidates("custom-deployment", null, "auto")).toEqual([
      "responses",
      "chat",
    ]);
  });

  it("honors a manually selected adapter without fallback probing", () => {
    expect(inferAdapterCandidates("Kimi-K2.6", "Kimi-K2.6", "responses")).toEqual(["responses"]);
    expect(inferAdapterCandidates("DeepSeek-V4-Pro", null, "deepseek")).toEqual(["deepseek"]);
  });

  it("falls back between adapters and records measured capability flags", async () => {
    const calls: string[] = [];
    const driver: DeploymentProbeDriver = {
      async generate(protocol) {
        calls.push(`generate:${protocol}`);
        if (protocol === "deepseek") throw new Error("not supported on this deployment");
        return { text: "OK" };
      },
      async stream(protocol) {
        calls.push(`stream:${protocol}`);
        return { text: "streamed", hadDelta: true };
      },
      async structured(protocol) {
        calls.push(`structured:${protocol}`);
        return true;
      },
      async reasoning(protocol, withEffort) {
        calls.push(`reasoning:${protocol}:${withEffort}`);
        return { reasoning: true };
      },
    };

    const result = await probeAzureDeployment("DeepSeek-V4-Pro", "auto", null, driver);

    expect(result.ok).toBe(true);
    expect(result.protocol).toBe("chat");
    expect(result.errors.deepseek).toMatch(/not supported/);
    expect(result.capabilities).toMatchObject({
      textGeneration: true,
      streaming: true,
      structuredOutput: true,
      reasoning: true,
      reasoningEffort: true,
      contextWindow: null,
      adapter: "chat",
      lastProbeOk: true,
    });
    expect(calls).toEqual([
      "generate:deepseek",
      "generate:chat",
      "stream:chat",
      "structured:chat",
      "reasoning:chat:false",
      "reasoning:chat:true",
    ]);
  });

  it("reports every attempted adapter when no protocol works", async () => {
    const calls: string[] = [];
    const driver: DeploymentProbeDriver = {
      async generate(protocol) {
        calls.push(protocol);
        throw new Error(`${protocol} unavailable`);
      },
      async stream() { throw new Error("unreachable"); },
      async structured() { throw new Error("unreachable"); },
      async reasoning() { throw new Error("unreachable"); },
    };

    const result = await probeAzureDeployment("Kimi-K2.6", "auto", null, driver);

    expect(calls).toEqual(["chat", "responses"]);
    expect(result).toMatchObject({ ok: false, protocol: null, latencyMs: null });
    expect(result.capabilities).toMatchObject({
      textGeneration: false,
      streaming: false,
      structuredOutput: false,
      lastProbeOk: false,
      contextWindow: null,
    });
    expect(result.capabilities.lastProbeError).toContain("chat: chat unavailable");
    expect(result.capabilities.lastProbeError).toContain("responses: responses unavailable");
  });
});
