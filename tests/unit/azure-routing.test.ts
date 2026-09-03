import { describe, expect, it } from "vitest";
import {
  inferAdapterCandidates,
  normalizeFoundryResponsesRequestBody,
  probeAzureDeployment,
  type DeploymentProbeDriver,
} from "@/lib/azure";

describe("Foundry Responses request normalization", () => {
  it("adds message discriminators only to role-bearing items with a missing or empty type", () => {
    const body = JSON.stringify({
      model: "gpt-5.6-sol",
      input: [
        { role: "developer", content: "System prompt" },
        { role: "user", type: "", content: [{ type: "input_text", text: "Hello" }] },
        { role: "assistant", type: null, content: [{ type: "output_text", text: "Hi" }] },
        { type: "reasoning", id: "reasoning-1", summary: [] },
        { type: "function_call", call_id: "call-1", name: "lookup", arguments: "{}" },
      ],
    });

    const normalized = normalizeFoundryResponsesRequestBody("/v1/responses", body);
    expect(typeof normalized).toBe("string");
    const parsed = JSON.parse(normalized as string);

    expect(parsed.input.slice(0, 3).map((item: { type: string }) => item.type)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(parsed.input[3]).toEqual({ type: "reasoning", id: "reasoning-1", summary: [] });
    expect(parsed.input[4]).toEqual({ type: "function_call", call_id: "call-1", name: "lookup", arguments: "{}" });
  });

  it("leaves non-Responses, non-JSON, and non-string bodies untouched", () => {
    const body = JSON.stringify({ input: [{ role: "user", content: "Hello" }] });
    const bytes = new Uint8Array([1, 2, 3]);

    expect(normalizeFoundryResponsesRequestBody("/v1/chat/completions", body)).toBe(body);
    expect(normalizeFoundryResponsesRequestBody("/v1/responses", "not-json")).toBe("not-json");
    expect(normalizeFoundryResponsesRequestBody("/v1/responses", bytes)).toBe(bytes);
  });
});

describe("Azure adapter routing", () => {
  it("uses Azure's model identity instead of a stale deployment-slot name", () => {
    expect(inferAdapterCandidates("claude-old-slot", "gpt-5.6-sol", "auto")).toEqual(["responses", "chat"]);
    expect(inferAdapterCandidates("old-luna-slot", "claude-sonnet-5", "auto")).toEqual(["anthropic"]);
  });

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

  it("tries the Anthropic adapter first for Claude deployments", () => {
    expect(inferAdapterCandidates("claude-sonnet", "Claude Sonnet", "auto")).toEqual(["anthropic"]);
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
      async image(protocol) {
        calls.push(`image:${protocol}`);
        return true;
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
      imageInput: true,
      vision: true,
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
      "image:chat",
      "structured:chat",
      "reasoning:chat:false",
      "reasoning:chat:true",
    ]);
  });

  it("keeps the Claude probe to generation, streaming, and image input", async () => {
    const calls: string[] = [];
    const driver: DeploymentProbeDriver = {
      async generate(protocol) {
        calls.push(`generate:${protocol}`);
        return { text: "OK" };
      },
      async stream(protocol) {
        calls.push(`stream:${protocol}`);
        return { text: "STREAM_OK", hadDelta: true };
      },
      async image(protocol) {
        calls.push(`image:${protocol}`);
        return true;
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

    const result = await probeAzureDeployment("claude-sonnet", "anthropic", "Claude Sonnet", driver);

    expect(calls).toEqual(["generate:anthropic", "stream:anthropic", "image:anthropic"]);
    expect(result.capabilities).toMatchObject({
      textGeneration: true,
      streaming: true,
      structuredOutput: false,
      reasoning: true,
      reasoningEffort: true,
      imageInput: true,
      adapter: "anthropic",
    });
  });

  it("reports every attempted adapter when no protocol works", async () => {
    const calls: string[] = [];
    const driver: DeploymentProbeDriver = {
      async generate(protocol) {
        calls.push(protocol);
        throw new Error(`${protocol} unavailable`);
      },
      async stream() { throw new Error("unreachable"); },
      async image() { throw new Error("unreachable"); },
      async structured() { throw new Error("unreachable"); },
      async reasoning() { throw new Error("unreachable"); },
    };

    const result = await probeAzureDeployment("Kimi-K2.6", "auto", null, driver);

    expect(calls).toEqual(["chat", "responses"]);
    expect(result).toMatchObject({ ok: false, protocol: null, latencyMs: null });
    expect(result.capabilities).toMatchObject({
      textGeneration: false,
      streaming: false,
      imageInput: false,
      vision: false,
      structuredOutput: false,
      lastProbeOk: false,
      contextWindow: null,
    });
    expect(result.capabilities.lastProbeError).toContain("chat: chat unavailable");
    expect(result.capabilities.lastProbeError).toContain("responses: responses unavailable");
  });

  it("persists an explicit false when the selected adapter rejects image input", async () => {
    const driver: DeploymentProbeDriver = {
      async generate() { return { text: "OK" }; },
      async stream() { return { text: "STREAM_OK", hadDelta: true }; },
      async image() { throw new Error("image input is not supported"); },
      async structured() { return true; },
      async reasoning() { return { reasoning: false }; },
    };

    const result = await probeAzureDeployment("text-only", "responses", null, driver);

    expect(result.capabilities).toMatchObject({ imageInput: false, vision: false });
  });
});
