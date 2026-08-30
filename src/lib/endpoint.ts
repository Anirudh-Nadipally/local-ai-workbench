import type { EndpointKind } from "@/lib/types";

export function normalizeEndpoint(input: string) {
  const url = new URL(input.trim());
  if (url.protocol !== "https:") throw new Error("Azure endpoints must use HTTPS.");
  if (url.username || url.password) throw new Error("Azure endpoints must not contain embedded credentials.");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function detectEndpointKind(input: string): EndpointKind {
  const url = new URL(normalizeEndpoint(input));
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".services.ai.azure.com")) {
    if (!/^\/api\/projects\/[^/]+\/?$/i.test(url.pathname)) {
      throw new Error("Foundry project endpoints must include /api/projects/<project>.");
    }
    return "foundry-project";
  }
  if (host.endsWith(".openai.azure.com")) return "azure-openai";
  throw new Error("This does not look like a Foundry project or Azure OpenAI endpoint.");
}

export function getAzureBaseUrl(endpoint: string, kind: EndpointKind) {
  const normalized = normalizeEndpoint(endpoint);
  if (detectEndpointKind(normalized) !== kind) throw new Error("The Azure endpoint type does not match its host.");
  // createAzure adds `/v1` itself. Accept Azure's copy-paste-ready `/openai/v1`
  // endpoint without accidentally producing `/openai/v1/openai/v1/...`.
  const withoutV1 = normalized.replace(/\/v1$/i, "");
  if (withoutV1.endsWith("/openai")) return withoutV1;
  if (kind === "foundry-project" || kind === "azure-openai") return `${withoutV1}/openai`;
  return withoutV1;
}

/**
 * Azure Foundry exposes Claude through Anthropic's Messages API, which is a
 * separate surface from the OpenAI-compatible endpoint used by other models.
 * The saved connection is normally a Foundry project URL, so derive the
 * resource-level Anthropic base URL from its origin.
 */
export function getAzureAnthropicBaseUrl(endpoint: string, kind: EndpointKind) {
  const normalized = normalizeEndpoint(endpoint);
  if (kind !== "foundry-project" || detectEndpointKind(normalized) !== kind) {
    throw new Error("Azure Claude deployments require a Foundry services.ai.azure.com endpoint.");
  }
  const url = new URL(normalized);
  return `${url.origin}/anthropic/v1`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertLocalRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error("Local access only.");
  if (!mutation) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const originUrl = new URL(origin);
  if (!LOOPBACK_HOSTS.has(originUrl.hostname) || originUrl.protocol !== url.protocol || originUrl.port !== url.port) {
    throw new Error("Cross-origin changes are not allowed.");
  }
}
