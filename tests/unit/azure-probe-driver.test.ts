import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const responsesModel = { adapter: "responses" };
  const provider = Object.assign(vi.fn(() => responsesModel), {
    chat: vi.fn(() => ({ adapter: "chat" })),
    deepseek: vi.fn(() => ({ adapter: "deepseek" })),
  });
  return {
    createAzure: vi.fn((options: unknown) => {
      void options;
      return provider;
    }),
    generateText: vi.fn(),
    provider,
    responsesModel,
    streamText: vi.fn(),
  };
});

vi.mock("@ai-sdk/azure", () => ({ createAzure: mocks.createAzure }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => ({ messages: vi.fn(() => ({ adapter: "anthropic" })) })),
}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: mocks.generateText, streamText: mocks.streamText };
});
vi.mock("@/lib/config", () => ({
  getApiKey: () => "test-key",
  readConfig: () => ({ endpoint: "https://foundry.example/project", endpointKind: "foundry-project" }),
  redactSecrets: (value: string) => value,
}));
vi.mock("@/lib/endpoint", () => ({
  detectEndpointKind: () => "foundry-project",
  getAzureAnthropicBaseUrl: () => "https://foundry.example/v1",
  getAzureBaseUrl: () => "https://foundry.example/v1",
  normalizeEndpoint: (value: string) => value,
}));

import { createAzureProbeDriver, getAzureProvider } from "@/lib/azure";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.createAzure.mockClear();
  mocks.generateText.mockReset();
  mocks.provider.mockClear();
  mocks.provider.chat.mockClear();
  mocks.provider.deepseek.mockClear();
  mocks.streamText.mockReset();
});

describe("Foundry Azure transport", () => {
  it("normalizes only Responses request bodies in the configured custom fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    getAzureProvider();
    const options = mocks.createAzure.mock.calls[0]?.[0] as { fetch?: typeof fetch };
    expect(options.fetch).toBeTypeOf("function");

    const responsesBody = JSON.stringify({ input: [{ role: "developer", content: "System" }] });
    await options.fetch?.("https://foundry.example/v1/responses?api-version=v1", {
      method: "POST",
      body: responsesBody,
    });
    const [responsesUrl, responsesInit] = fetchSpy.mock.calls[0];
    expect(responsesUrl.toString()).toBe("https://foundry.example/v1/responses");
    expect(JSON.parse(String(responsesInit?.body)).input[0]).toMatchObject({
      role: "developer",
      type: "message",
    });

    const chatBody = JSON.stringify({ messages: [{ role: "user", content: "Hello" }] });
    await options.fetch?.("https://foundry.example/v1/chat/completions?api-version=v1", {
      method: "POST",
      body: chatBody,
    });
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toBe(chatBody);
  });
});

describe("Azure probe driver", () => {
  it("uses a production-shaped system plus user message for streaming", async () => {
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "STREAM_OK" };
      })(),
      text: Promise.resolve("STREAM_OK"),
      reasoningText: Promise.resolve(""),
    });

    const result = await createAzureProbeDriver("gpt-5.6-sol").stream("responses");

    expect(result).toEqual({ text: "STREAM_OK", hadDelta: true });
    expect(mocks.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: mocks.responsesModel,
      system: expect.any(String),
      messages: [{ role: "user", content: "Reply with exactly: STREAM_OK" }],
    }));
    expect(mocks.streamText.mock.calls[0]?.[0]).not.toHaveProperty("prompt");
  });

  it("sends a valid red PNG through the selected adapter for image probing", async () => {
    mocks.generateText.mockResolvedValue({ text: "  red\n", reasoningText: null });

    await expect(createAzureProbeDriver("gpt-5.6-sol").image("responses")).resolves.toBe(true);

    const request = mocks.generateText.mock.calls[0]?.[0];
    expect(request.model).toBe(mocks.responsesModel);
    const imagePart = request.messages[0].content[1];
    expect(imagePart).toMatchObject({ type: "image", mediaType: "image/png" });
    expect(imagePart.image).toBeInstanceOf(Uint8Array);
    expect(Array.from(imagePart.image.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(Array.from(imagePart.image.slice(-8))).toEqual([73, 69, 78, 68, 174, 66, 96, 130]);
  });

  it("does not verify vision when a model ignores or misreads the image", async () => {
    const driver = createAzureProbeDriver("gpt-5.6-sol");
    mocks.generateText.mockResolvedValueOnce({ text: "IMAGE_OK", reasoningText: null });
    await expect(driver.image("responses")).resolves.toBe(false);
    mocks.generateText.mockResolvedValueOnce({ text: "BLUE", reasoningText: null });
    await expect(driver.image("responses")).resolves.toBe(false);
  });
});
