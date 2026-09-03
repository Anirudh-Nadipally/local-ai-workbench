import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Output, generateText, streamText } from "ai";
import { z } from "zod";
import { getApiKey, readConfig, redactSecrets } from "@/lib/config";
import { detectEndpointKind, getAzureAnthropicBaseUrl, getAzureBaseUrl, normalizeEndpoint } from "@/lib/endpoint";
import type { DeploymentProtocol, EndpointKind } from "@/lib/types";

export function getAzureProvider() {
  const config = readConfig();
  const apiKey = getApiKey();
  if (!config.endpoint || !apiKey) throw new Error("Azure is not configured yet.");
  const endpoint = normalizeEndpoint(config.endpoint);
  const endpointKind = detectEndpointKind(endpoint);
  if (endpointKind !== config.endpointKind) throw new Error("The saved Azure endpoint type does not match its host.");
  const foundryFetch = endpointKind === "foundry-project"
    ? async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        // Foundry's OpenAI-compatible `/v1` surface rejects Azure OpenAI's
        // legacy `api-version` query parameter.
        url.searchParams.delete("api-version");
        return globalThis.fetch(url, init);
      }
    : undefined;
  return createAzure({ baseURL: getAzureBaseUrl(endpoint, endpointKind), apiKey, fetch: foundryFetch });
}

export function getAzureModel(deployment: string, protocol: DeploymentProtocol = "responses") {
  if (!deployment) throw new Error("Choose an Azure deployment first.");
  if (protocol === "auto") throw new Error(`Probe ${deployment} before using it. Auto is not a runnable adapter.`);
  if (protocol === "anthropic") {
    const config = readConfig();
    const apiKey = getApiKey();
    if (!config.endpoint || !apiKey) throw new Error("Azure is not configured yet.");
    const endpoint = normalizeEndpoint(config.endpoint);
    const endpointKind = detectEndpointKind(endpoint);
    return createAnthropic({
      // @ai-sdk/anthropic appends `/messages`; Azure requires `/v1/messages`.
      baseURL: getAzureAnthropicBaseUrl(endpoint, endpointKind),
      apiKey,
    }).messages(deployment);
  }
  const provider = getAzureProvider();
  if (protocol === "deepseek") return provider.deepseek(deployment);
  return protocol === "chat" ? provider.chat(deployment) : provider(deployment);
}

export type ConcreteDeploymentProtocol = Exclude<DeploymentProtocol, "auto">;

export function inferAdapterCandidates(deploymentName: string, modelName?: string | null, requestedProtocol: DeploymentProtocol = "auto"): ConcreteDeploymentProtocol[] {
  if (requestedProtocol !== "auto") return [requestedProtocol];
  const identity = `${deploymentName} ${modelName ?? ""}`;
  if (/claude|anthropic/i.test(identity)) return ["anthropic"];
  if (/deepseek/i.test(identity)) return ["deepseek", "chat", "responses"];
  if (/kimi/i.test(identity)) return ["chat", "responses"];
  return ["responses", "chat"];
}

export async function discoverDeployments(endpoint: string, endpointKind: EndpointKind, apiKey: string) {
  const normalized = normalizeEndpoint(endpoint);
  if (detectEndpointKind(normalized) !== endpointKind) throw new Error("The Azure endpoint type does not match its host.");
  const candidates = endpointKind === "foundry-project"
    ? [
        `${normalized}/deployments?api-version=v1`,
        `${normalized}/openai/deployments?api-version=2024-10-21`,
      ]
    : [`${getAzureBaseUrl(normalized, endpointKind)}/deployments?api-version=2024-10-21`];

  let lastError = "Deployment discovery is not available for this endpoint.";
  for (const url of candidates) {
    const response = await fetch(url, { headers: { "api-key": apiKey }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      lastError = `Azure returned ${response.status} while discovering deployments.`;
      continue;
    }
    const json = await response.json() as { data?: Array<Record<string, unknown>>; value?: Array<Record<string, unknown>> };
    const rows = json.data ?? json.value ?? [];
    return rows.map((row) => ({
      name: String(row.name ?? row.id ?? ""),
      modelName: String((row.model as Record<string, unknown> | undefined)?.name ?? row.model ?? "") || null,
    })).filter((item) => item.name);
  }
  throw new Error(lastError);
}

export type DeploymentProbeDriver = {
  generate(protocol: ConcreteDeploymentProtocol): Promise<{ text: string }>;
  stream(protocol: ConcreteDeploymentProtocol): Promise<{ text: string; hadDelta: boolean }>;
  structured(protocol: ConcreteDeploymentProtocol): Promise<boolean>;
  reasoning(protocol: ConcreteDeploymentProtocol, withEffort: boolean): Promise<{ reasoning: boolean }>;
};

export type DeploymentProbeResult = {
  ok: boolean;
  protocol: ConcreteDeploymentProtocol | null;
  latencyMs: number | null;
  capabilities: Record<string, boolean | number | string | null>;
  errors: Partial<Record<ConcreteDeploymentProtocol, string>>;
};

export async function probeAzureDeployment(
  deployment: string,
  protocol: DeploymentProtocol = "auto",
  modelName?: string | null,
  driver: DeploymentProbeDriver = createAzureProbeDriver(deployment),
): Promise<DeploymentProbeResult> {
  const candidates = inferAdapterCandidates(deployment, modelName, protocol);
  const errors: Partial<Record<ConcreteDeploymentProtocol, string>> = {};
  let selected: ConcreteDeploymentProtocol | null = null;
  let latencyMs: number | null = null;

  for (const candidate of candidates) {
    const started = Date.now();
    try {
      const result = await driver.generate(candidate);
      if (!result.text.trim()) throw new Error("The deployment returned no text.");
      selected = candidate;
      latencyMs = Date.now() - started;
      break;
    } catch (error) {
      errors[candidate] = errorMessage(error);
    }
  }

  const at = new Date().toISOString();
  if (!selected) {
    const lastProbeError = candidates.map((candidate) => `${candidate}: ${errors[candidate] ?? "failed"}`).join("; ");
    return {
      ok: false,
      protocol: null,
      latencyMs: null,
      errors,
      capabilities: {
        textGeneration: false,
        streaming: false,
        structuredOutput: false,
        reasoning: false,
        reasoningMetadata: false,
        reasoningEffort: false,
        contextWindow: null,
        lastProbeOk: false,
        lastProbeAt: at,
        lastProbeLatencyMs: null,
        lastProbeError,
        adapterErrors: JSON.stringify(errors),
      },
    };
  }

  const streaming = await probeFlag(() => driver.stream(selected!), (value) => value.hadDelta && Boolean(value.text.trim()));
  if (selected === "anthropic") {
    return {
      ok: true,
      protocol: selected,
      latencyMs,
      errors,
      capabilities: {
        textGeneration: true,
        streaming,
        structuredOutput: false,
        reasoning: true,
        reasoningMetadata: false,
        reasoningEffort: true,
        imageInput: true,
        vision: true,
        contextWindow: null,
        lastProbeOk: true,
        lastProbeAt: at,
        lastProbeLatencyMs: latencyMs,
        lastProbeError: null,
        adapter: selected,
        adapterErrors: Object.keys(errors).length ? JSON.stringify(errors) : "",
        probeRequired: false,
      },
    };
  }
  const structuredOutput = await probeFlag(() => driver.structured(selected!), Boolean);
  const reasoning = await probeFlag(() => driver.reasoning(selected!, false), (value) => value.reasoning);
  const reasoningEffort = await probeFlag(() => driver.reasoning(selected!, true), () => true);
  return {
    ok: true,
    protocol: selected,
    latencyMs,
    errors,
    capabilities: {
      textGeneration: true,
      streaming,
      structuredOutput,
      reasoning,
      reasoningMetadata: reasoning,
      reasoningEffort,
      contextWindow: null,
      lastProbeOk: true,
      lastProbeAt: at,
      lastProbeLatencyMs: latencyMs,
      lastProbeError: null,
      adapter: selected,
      adapterErrors: Object.keys(errors).length ? JSON.stringify(errors) : "",
      probeRequired: false,
    },
  };
}

function probeText(result: { text: string; reasoningText?: string | null }) {
  return (result.text || result.reasoningText || "").trim();
}

function createAzureProbeDriver(deployment: string): DeploymentProbeDriver {
  return {
    async generate(protocol) {
      const result = await generateText({
        model: getAzureModel(deployment, protocol),
        prompt: "Reply with exactly: OK",
        maxOutputTokens: 96,
      });
      return { text: probeText(result) };
    },
    async stream(protocol) {
      const result = streamText({
        model: getAzureModel(deployment, protocol),
        prompt: "Reply with exactly: STREAM_OK",
        maxOutputTokens: 96,
      });
      let hadDelta = false;
      for await (const part of result.fullStream) {
        if ((part.type === "text-delta" || part.type === "reasoning-delta") && part.text.length > 0) hadDelta = true;
      }
      const text = probeText({ text: await result.text, reasoningText: await result.reasoningText });
      return { text, hadDelta };
    },
    async structured(protocol) {
      const result = await generateText({
        model: getAzureModel(deployment, protocol),
        output: Output.object({ schema: z.object({ ok: z.literal(true) }), name: "capability_probe" }),
        prompt: "Return an object with ok set to true.",
        maxOutputTokens: 64,
      });
      return result.output.ok;
    },
    async reasoning(protocol, withEffort) {
      const result = await generateText({
        model: getAzureModel(deployment, protocol),
        prompt: "Determine whether 17 is prime, then answer PRIME or NOT PRIME.",
        maxOutputTokens: 64,
        providerOptions: withEffort ? { azure: { reasoningEffort: "low", store: false } } : undefined,
      });
      return { reasoning: Boolean(result.reasoningText?.trim()) };
    },
  };
}

async function probeFlag<T>(run: () => Promise<T>, validate: (value: T) => boolean) {
  try { return validate(await run()); }
  catch { return false; }
}

function errorMessage(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : "Probe failed.");
}
