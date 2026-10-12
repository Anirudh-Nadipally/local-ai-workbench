import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { Effort, Model, ReasoningConfig } from "./types";

export const effortValues = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const effortLabel = (effort: Effort) =>
  effort === "default"
    ? "Provider default"
    : effort[0].toUpperCase() + effort.slice(1);

export function validateReasoning(model: Model, config: ReasoningConfig) {
  if (
    config.mode === "openai" &&
    !["responses", "chat"].includes(model.protocol)
  )
    throw new Error("OpenAI reasoning requires Responses or Chat Completions.");
  if (config.mode !== "openai" && model.protocol !== "anthropic")
    throw new Error("Anthropic thinking requires the Anthropic protocol.");
  if (
    config.mode !== "openai" &&
    config.efforts.some((e) => ["none", "minimal"].includes(e))
  )
    throw new Error("Use low or higher for Anthropic thinking.");
  if (
    config.mode === "budget" &&
    config.efforts.some((e) => !["low", "medium", "high"].includes(e))
  )
    throw new Error("Budget thinking supports low, medium and high.");
}

export function reasoningOptions(
  model: Model,
  effort: Effort = "default",
): SharedV3ProviderOptions | undefined {
  const config = model.reasoning;
  if (effort === "default") return undefined;
  if (!config || !config.efforts.includes(effort))
    throw new Error(
      "This effort is not configured for the selected deployment. Choose Provider default or configure reasoning in Settings.",
    );
  validateReasoning(model, config);
  if (config.mode === "openai")
    return {
      openai: {
        reasoningEffort: effort,
        ...(config.summary &&
        model.protocol === "responses" &&
        effort !== "none"
          ? { reasoningSummary: "auto" }
          : {}),
      },
    };
  if (config.mode === "adaptive")
    return {
      anthropic: {
        effort,
        thinking: {
          type: "adaptive",
          ...(config.summary ? { display: "summarized" } : {}),
        },
      },
    };
  return {
    anthropic: {
      thinking: {
        type: "enabled",
        budgetTokens: { low: 2048, medium: 4096, high: 8192 }[
          effort as "low" | "medium" | "high"
        ],
      },
    },
  };
}
