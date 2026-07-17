import { Output, generateText } from "ai";
import { z } from "zod";
import { resolveAzureDeployment } from "@/lib/model-routing";
import { MEMORY_TYPES } from "@/lib/types";
import { listMessages, replaceMemoryCandidates, updateThread } from "@/lib/repository";

const EvidenceSchema = z.object({
  kind: z.enum(["message", "file"]),
  id: z.string(),
  label: z.string().optional(),
});

const MemoryCurationSchema = z.object({
  threadSummary: z.string().max(3_000),
  candidates: z.array(z.object({
    type: z.enum(MEMORY_TYPES),
    title: z.string().max(120),
    content: z.string().max(1_200),
    scope: z.string().max(120),
    confidence: z.number().min(0).max(1),
    sensitivity: z.enum(["normal", "sensitive"]),
    explicit: z.boolean(),
    evidence: z.array(EvidenceSchema).min(1).max(8),
  })).max(8),
});

export async function curateThreadMemory(input: { projectId: string; threadId: string; deployment: string }) {
  const messages = listMessages(input.threadId);
  if (!messages.length) throw new Error("There is no conversation to curate yet.");
  const transcript = messages.map((message) => `[${message.id}] ${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const resolved = resolveAzureDeployment(input.deployment, ["textGeneration", "structuredOutput"], { requireVerified: true });
  const result = await generateText({
    model: resolved.model,
    output: Output.object({ schema: MemoryCurationSchema, name: "memory_curation" }),
    system: `You are a conservative memory curator. Propose—not commit—durable items that could help in later conversations.
Do not infer personal facts without evidence. Use explicit=false for any inference. Prefer no candidate over a weak one.
The user will manually accept or reject every candidate. Cite exact message ids in evidence.`,
    prompt: transcript,
  });
  const output = result.output;
  updateThread(input.threadId, { summary: output.threadSummary });
  replaceMemoryCandidates(input.projectId, input.threadId, output.candidates.map((candidate) => ({
    ...candidate,
    createdAt: "",
    updatedAt: "",
  })));
  return output;
}

export { MemoryCurationSchema };
