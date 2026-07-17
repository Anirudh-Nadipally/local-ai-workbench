import fs from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { CONFIG_PATH, DATA_DIR, SECRETS_KEY_PATH, SECRETS_PATH } from "@/lib/paths";
import { MODEL_ROLE_KEYS, type EndpointKind, type ModelRoleSettings, type SafeConfig } from "@/lib/types";
import { detectEndpointKind, normalizeEndpoint } from "@/lib/endpoint";

const ConfigSchema = z.object({
  configured: z.boolean().default(false),
  endpoint: z.string().default(""),
  endpointKind: z.enum(["foundry-project", "azure-openai"]).default("azure-openai"),
  defaultProjectId: z.string().default(""),
  chatDeployment: z.string().default("DeepSeek-V4-Pro"),
  memoryDeployment: z.string().default("DeepSeek-V4-Flash"),
  branchDeployment: z.string().default("DeepSeek-V4-Flash"),
  mapperDeployment: z.string().default("Kimi-K2.6"),
  alternativeDeployment: z.string().default("DeepSeek-V4-Flash"),
  adversarialDeployment: z.string().default("DeepSeek-V4-Pro"),
  evidenceDeployment: z.string().default("Kimi-K2.6"),
  criticDeployment: z.string().default("DeepSeek-V4-Pro"),
  refinementDeployment: z.string().default("DeepSeek-V4-Pro"),
  synthesisDeployment: z.string().default("Kimi-K2.6"),
  reasoningEffort: z.enum(["none", "low", "medium", "high"]).default("medium"),
});

export type LocalConfig = z.infer<typeof ConfigSchema>;

const defaults: LocalConfig = ConfigSchema.parse({});

export function readConfig(): LocalConfig {
  const envEndpoint = process.env.AZURE_AI_ENDPOINT ?? process.env.AZURE_OPENAI_ENDPOINT;
  if (!fs.existsSync(CONFIG_PATH)) {
    return ConfigSchema.parse({ ...defaults, endpoint: envEndpoint ?? "", configured: Boolean(envEndpoint && getApiKey()) });
  }
  try {
    const parsed = parseConfigWithLegacyFallback(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
    if (envEndpoint) parsed.endpoint = envEndpoint;
    parsed.configured = Boolean(parsed.endpoint && getApiKey());
    return parsed;
  } catch {
    return defaults;
  }
}

export function parseConfigWithLegacyFallback(value: unknown): LocalConfig {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const branch = typeof input.branchDeployment === "string" ? input.branchDeployment : "";
  const critic = typeof input.criticDeployment === "string" ? input.criticDeployment : "";
  return ConfigSchema.parse({
    ...input,
    ...(branch && input.mapperDeployment === undefined ? { mapperDeployment: branch } : {}),
    ...(branch && input.alternativeDeployment === undefined ? { alternativeDeployment: branch } : {}),
    ...(branch && input.adversarialDeployment === undefined ? { adversarialDeployment: branch } : {}),
    ...(branch && input.evidenceDeployment === undefined ? { evidenceDeployment: branch } : {}),
    ...(critic && input.refinementDeployment === undefined ? { refinementDeployment: critic } : {}),
  });
}

export function writeConfig(update: Partial<LocalConfig>) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const next = ConfigSchema.parse({ ...readConfig(), ...update });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(CONFIG_PATH, 0o600);
  return next;
}

export function writeApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("An Azure API key is required.");
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const key = getOrCreateEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  fs.writeFileSync(SECRETS_PATH, `AZURE_API_KEY_ENC=${payload}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(SECRETS_PATH, 0o600);
}

export function getApiKey() {
  const env = process.env.AZURE_AI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  if (env) return env;
  if (!fs.existsSync(SECRETS_PATH)) return "";
  const contents = fs.readFileSync(SECRETS_PATH, "utf8");
  const encrypted = contents.match(/^AZURE_API_KEY_ENC=(.+)$/m);
  if (encrypted && fs.existsSync(SECRETS_KEY_PATH)) {
    try {
      const packed = Buffer.from(encrypted[1], "base64");
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(fs.readFileSync(SECRETS_KEY_PATH, "utf8").trim(), "base64"), packed.subarray(0, 12));
      decipher.setAuthTag(packed.subarray(12, 28));
      return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
    } catch { return ""; }
  }
  const match = contents.match(/^AZURE_API_KEY_B64=(.+)$/m);
  if (!match) return "";
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return "";
  }
}

function getOrCreateEncryptionKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(SECRETS_KEY_PATH)) {
    fs.writeFileSync(SECRETS_KEY_PATH, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(SECRETS_KEY_PATH, 0o600);
  }
  const key = Buffer.from(fs.readFileSync(SECRETS_KEY_PATH, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("The local secret key is invalid.");
  return key;
}

export function getSafeConfig(): SafeConfig {
  const config = readConfig();
  const key = getApiKey();
  return { ...config, configured: Boolean(config.endpoint && key), hasCredential: Boolean(key) };
}

export function getModelRoles(): ModelRoleSettings {
  const config = readConfig();
  return Object.fromEntries(MODEL_ROLE_KEYS.map((key) => [key, config[key]])) as ModelRoleSettings;
}

export function writeModelRoles(roles: ModelRoleSettings) {
  return writeConfig(roles);
}

export function saveConnection(input: {
  endpoint: string;
  endpointKind: EndpointKind;
  apiKey?: string;
  deployments?: Partial<ModelRoleSettings & Pick<LocalConfig, "branchDeployment">>;
}) {
  const endpoint = normalizeEndpoint(input.endpoint);
  const endpointKind = detectEndpointKind(endpoint);
  if (endpointKind !== input.endpointKind) throw new Error("The Azure endpoint type does not match its host.");
  if (input.apiKey) writeApiKey(input.apiKey);
  const key = getApiKey();
  if (!key) throw new Error("No Azure API key is available.");
  return writeConfig({
    endpoint,
    endpointKind,
    configured: true,
    ...input.deployments,
  });
}

export function redactSecrets(value: string) {
  const key = getApiKey();
  let output = value;
  if (key) output = output.split(key).join("[REDACTED]");
  return output.replace(/(api[-_ ]?key["'\s:=]+)[^\s,"'}]+/gi, "$1[REDACTED]");
}
