import { describe, expect, it } from "vitest";
import { assertLocalRequest, detectEndpointKind, getAzureAnthropicBaseUrl, getAzureBaseUrl, normalizeEndpoint } from "@/lib/endpoint";

describe("Azure endpoint handling", () => {
  it("detects both endpoint families", () => {
    expect(detectEndpointKind("https://demo.services.ai.azure.com/api/projects/alpha")).toBe("foundry-project");
    expect(detectEndpointKind("https://demo.openai.azure.com/")).toBe("azure-openai");
    expect(detectEndpointKind("https://example-resource.services.ai.azure.com/api/projects/example-project")).toBe("foundry-project");
    expect(detectEndpointKind("https://example-resource.openai.azure.com/openai/v1")).toBe("azure-openai");
  });
  it("normalizes and builds the provider base URL", () => {
    expect(normalizeEndpoint("https://demo.openai.azure.com///")).toBe("https://demo.openai.azure.com");
    expect(getAzureBaseUrl("https://demo.openai.azure.com", "azure-openai")).toBe("https://demo.openai.azure.com/openai");
    expect(getAzureBaseUrl("https://demo.openai.azure.com/openai/v1", "azure-openai")).toBe("https://demo.openai.azure.com/openai");
    expect(getAzureBaseUrl("https://demo.services.ai.azure.com/api/projects/one", "foundry-project")).toBe("https://demo.services.ai.azure.com/api/projects/one/openai");
    expect(getAzureBaseUrl(
      "https://example-resource.services.ai.azure.com/api/projects/example-project",
      "foundry-project",
    )).toBe("https://example-resource.services.ai.azure.com/api/projects/example-project/openai");
    expect(getAzureBaseUrl(
      "https://example-resource.openai.azure.com/openai/v1",
      "azure-openai",
    )).toBe("https://example-resource.openai.azure.com/openai");
    expect(getAzureAnthropicBaseUrl(
      "https://example-resource.services.ai.azure.com/api/projects/example-project",
      "foundry-project",
    )).toBe("https://example-resource.services.ai.azure.com/anthropic/v1");
  });
  it("rejects insecure endpoints and non-local requests", () => {
    expect(() => normalizeEndpoint("http://demo.openai.azure.com")).toThrow(/HTTPS/);
    expect(() => normalizeEndpoint("https://user:secret@demo.openai.azure.com")).toThrow(/embedded credentials/i);
    expect(() => detectEndpointKind("https://evil.example/openai/v1")).toThrow(/does not look/i);
    expect(() => detectEndpointKind("https://evil.example/api/projects/example")).toThrow(/does not look/i);
    expect(() => detectEndpointKind("https://demo.services.ai.azure.com")).toThrow(/api\/projects/i);
    expect(() => getAzureAnthropicBaseUrl("https://demo.openai.azure.com", "azure-openai")).toThrow(/Foundry services\.ai\.azure\.com/);
    expect(() => assertLocalRequest(new Request("http://192.168.1.5:3000/api/setup"), true)).toThrow(/Local/);
    expect(() => assertLocalRequest(new Request("http://127.0.0.1:3000/api/setup", { headers: { origin: "https://evil.example" } }), true)).toThrow(/Cross-origin/);
    expect(() => assertLocalRequest(new Request("http://127.0.0.1:3000/api/setup", { headers: { origin: "https://127.0.0.1:3000" } }), true)).toThrow(/Cross-origin/);
    expect(() => assertLocalRequest(new Request("http://127.0.0.1:3000/api/setup", { headers: { origin: "http://127.0.0.1:3001" } }), true)).toThrow(/Cross-origin/);
    expect(() => assertLocalRequest(new Request("http://[::1]:3000/api/setup", { headers: { origin: "http://[::1]:3000" } }), true)).not.toThrow();
  });
});
