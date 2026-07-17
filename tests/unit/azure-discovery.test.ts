import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverDeployments } from "@/lib/azure";

describe("mocked Azure deployment discovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads Foundry's shared deployment surface", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ name: "gpt-main", model: { name: "gpt-5" } }, { name: "deepseek", model: "DeepSeek-R1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverDeployments("https://demo.services.ai.azure.com/api/projects/one", "foundry-project", "secret");
    expect(result.map((item) => item.name)).toEqual(["gpt-main", "deepseek"]);
    expect(fetchMock.mock.calls[0][1].headers["api-key"]).toBe("secret");
  });
  it("uses the Azure OpenAI deployment endpoint and reports failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    await expect(discoverDeployments("https://demo.openai.azure.com", "azure-openai", "secret")).rejects.toThrow(/429/);
  });
});
