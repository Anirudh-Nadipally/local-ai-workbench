import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { all, dataDir, db, put } from "./db";
import {
  normalizeEndpoint,
  detectEndpointKind,
  getAzureBaseUrl,
  getAzureAnthropicBaseUrl,
} from "./endpoint";
import type { Model } from "@/domain/types";
const configPath = () => path.join(dataDir, "connection.json");
export function connection() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as {
      endpoint: string;
      encrypted: string;
    };
  } catch {
    return null;
  }
}
export function secret() {
  const c = connection();
  if (!c) return "";
  try {
    const packed = Buffer.from(c.encrypted, "base64");
    const key = fs.readFileSync(path.join(dataDir, ".key"));
    const d = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    d.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([d.update(packed.subarray(28)), d.final()]).toString();
  } catch {
    throw new Error(
      "The local credential could not be opened. Reconnect in Settings.",
    );
  }
}
export function saveConnection(endpoint: string, key: string) {
  endpoint = normalizeEndpoint(endpoint);
  detectEndpointKind(endpoint);
  db();
  const old = connection();
  const actual = key.trim() || secret();
  if (!actual) throw new Error("Enter an API key.");
  const keyFile = path.join(dataDir, ".key");
  const encryptionKey = fs.existsSync(keyFile)
      ? fs.readFileSync(keyFile)
      : randomBytes(32),
    iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const bytes = Buffer.concat([c.update(actual, "utf8"), c.final()]);
  fs.writeFileSync(path.join(dataDir, ".key"), encryptionKey, { mode: 0o600 });
  fs.writeFileSync(
    configPath() + ".tmp",
    JSON.stringify({
      endpoint,
      encrypted: Buffer.concat([iv, c.getAuthTag(), bytes]).toString("base64"),
    }),
    { mode: 0o600 },
  );
  fs.renameSync(configPath() + ".tmp", configPath());
  if (old?.endpoint !== endpoint) {
    for (const model of all("model"))
      put("model", { ...model, verifiedAt: null, image: false, pdf: false });
  }
}
export function redact(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  try {
    const key = secret();
    if (key) message = message.split(key).join("[redacted]");
  } catch {}
  return message
    .replace(/(api[-_ ]?key["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]")
    .slice(0, 1800);
}
export function modelFor(model: Model) {
  const c = connection();
  if (!c) throw new Error("Connect a model in Settings first.");
  const endpoint = normalizeEndpoint(c.endpoint),
    kind = detectEndpointKind(endpoint),
    apiKey = secret();
  if (model.protocol === "anthropic")
    return createAnthropic({
      baseURL: getAzureAnthropicBaseUrl(endpoint, kind),
      apiKey,
      fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
    }).messages(model.name);
  const provider = createAzure({
    baseURL: getAzureBaseUrl(endpoint, kind),
    apiKey,
    fetch:
      kind === "foundry-project"
        ? async (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
            );
            url.searchParams.delete("api-version");
            let body = init?.body;
            if (
              typeof body === "string" &&
              url.pathname.endsWith("/responses")
            ) {
              const json = JSON.parse(body);
              if (Array.isArray(json.input))
                json.input = json.input.map((item: Record<string, unknown>) =>
                  item.role && !item.type ? { ...item, type: "message" } : item,
                );
              body = JSON.stringify(json);
            }
            return fetch(url, { ...init, body, redirect: "error" });
          }
        : async (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
  return model.protocol === "chat"
    ? provider.chat(model.name)
    : model.protocol === "deepseek"
      ? provider.deepseek(model.name)
      : provider.responses(model.name);
}
export async function probe(model: Model) {
  const result = await generateText({
    model: modelFor(model),
    prompt: "Reply with OK.",
    maxOutputTokens: 256,
    abortSignal: AbortSignal.timeout(45_000),
    maxRetries: 0,
  });
  if (!result.text.trim())
    throw new Error("No text was returned. Check deployment and protocol.");
  return put("model", { ...model, verifiedAt: new Date().toISOString() });
}
