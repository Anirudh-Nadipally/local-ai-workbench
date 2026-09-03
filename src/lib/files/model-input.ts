import fs from "node:fs/promises";
import type { FilePart, ImagePart, ModelMessage } from "ai";
import { isImageFile, isPdfFile, supportsNativeVisualInput } from "@/lib/attachments";
import { resolveStoredUploadPath } from "@/lib/paths";
import { getFileChunks, searchFileChunks } from "@/lib/repository";
import type { DeploymentRecord, FileRecord } from "@/lib/types";
import type { MessageAttachmentRecord } from "@/lib/types";

export type NativeAttachmentPart = ImagePart | FilePart;

export async function nativeAttachmentPart(file: FileRecord, deployment: DeploymentRecord): Promise<NativeAttachmentPart> {
  if (!supportsNativeVisualInput(deployment)) {
    throw new Error(`${deployment.name} is not configured for direct image or PDF input. Choose Claude, configure GPT-5.6 Luna, or explicitly prepare the attachment first.`);
  }
  const data = new Uint8Array(await fs.readFile(resolveStoredUploadPath(file.storedName)));
  const providerOptions = deployment.protocol === "anthropic"
    ? { anthropic: { cacheControl: { type: "ephemeral" as const } } }
    : undefined;

  if (isImageFile(file)) {
    return { type: "image", image: data, mediaType: file.mimeType, providerOptions };
  }
  if (isPdfFile(file)) {
    return { type: "file", data, mediaType: "application/pdf", filename: file.originalName, providerOptions };
  }
  throw new Error(`${file.originalName} is extracted locally and should be sent as exact text, not as a native visual attachment.`);
}

export function addNativeAttachments(messages: ModelMessage[], parts: NativeAttachmentPart[]) {
  if (!parts.length) return messages;
  const next = messages.map((message) => ({ ...message })) as ModelMessage[];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    next[index] = { ...message, content: [...parts, ...content] };
    return next;
  }
  throw new Error("A user message is required for the selected attachment.");
}

export function addAttachmentManifest(messages: ModelMessage[], attachments: MessageAttachmentRecord[]) {
  if (!attachments.length) return messages;
  const manifest = [
    "[ATTACHMENTS FOR THIS USER MESSAGE]",
    ...attachments.map((attachment) => {
      const handling = attachment.mode === "direct"
        ? (isImageFile(attachment) || isPdfFile(attachment) ? "original binary included" : "extracted source text included in the source context")
        : `prepared with ${attachment.preparationDeployment || "the selected preparation model"}`;
      return `- ${attachment.originalName} (${attachment.mimeType || "unknown type"}; ${attachment.mode}; ${handling})`;
    }),
    "These files are attached to this user message. If asked what is attached, identify every filename above. Do not claim a listed file is unavailable; if only excerpts were supplied, state that limitation precisely.",
    "[END ATTACHMENTS]",
  ].join("\n");
  const next = messages.map((message) => ({ ...message })) as ModelMessage[];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    next[index] = { ...message, content: [{ type: "text" as const, text: manifest }, ...content] };
    return next;
  }
  throw new Error("A user message is required for the selected attachment manifest.");
}

export function renderFileTextForPreparation(file: FileRecord, query: string, maximumTokens = 36_000) {
  const chunks = getFileChunks(file.id);
  const totalTokens = chunks.reduce((sum, chunk) => sum + Number(chunk.token_estimate), 0);
  const selected = totalTokens <= maximumTokens
    ? chunks
    : selectPreparationChunks(chunks, searchFileChunks([file.id], query, 14), maximumTokens);
  if (!selected.length) throw new Error(`${file.originalName} has no locally extracted text. Use direct visual input or Prepare with Luna.`);
  const coverage = selected.length === chunks.length
    ? `[SOURCE COVERAGE: complete; ${chunks.length} of ${chunks.length} chunks; approximately ${totalTokens} tokens]`
    : `[SOURCE COVERAGE: partial hybrid selection; ${selected.length} of ${chunks.length} chunks; approximately ${selected.reduce((sum, chunk) => sum + Number(chunk.token_estimate), 0)} of ${totalTokens} source tokens. The beginning, ending, evenly distributed checkpoints, and query matches are represented. Do not imply unseen chunks were reviewed.]`;
  return [coverage, ...selected.map((chunk) => {
    const label = `[${file.originalName}${chunk.page ? `, page ${chunk.page}` : ""}, chunk ${Number(chunk.chunk_index) + 1}]`;
    return `${label}\n${String(chunk.content)}`;
  })].join("\n\n");
}

type PreparationChunk = Record<string, unknown> & { id?: unknown; chunk_index?: unknown; token_estimate?: unknown };

export function selectPreparationChunks(chunks: PreparationChunk[], relevant: PreparationChunk[], maximumTokens: number) {
  if (!chunks.length || maximumTokens <= 0) return [];
  const byIndex = [...chunks].sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
  const priority: PreparationChunk[] = [];
  const seen = new Set<string>();
  const add = (chunk: PreparationChunk | undefined) => {
    if (!chunk) return;
    const key = String(chunk.id ?? chunk.chunk_index);
    if (seen.has(key)) return;
    seen.add(key);
    priority.push(chunk);
  };

  byIndex.slice(0, 3).forEach(add);
  byIndex.slice(-5).forEach(add);
  relevant.forEach(add);
  const checkpoints = Math.min(28, byIndex.length);
  for (let index = 0; index < checkpoints; index += 1) {
    add(byIndex[Math.round((index * (byIndex.length - 1)) / Math.max(checkpoints - 1, 1))]);
  }
  byIndex.forEach(add);

  const selected: PreparationChunk[] = [];
  let usedTokens = 0;
  for (const chunk of priority) {
    const chunkTokens = Math.max(1, Number(chunk.token_estimate) || 1);
    if (selected.length && usedTokens + chunkTokens > maximumTokens) continue;
    selected.push(chunk);
    usedTokens += chunkTokens;
    if (usedTokens >= maximumTokens) break;
  }
  return selected.sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
}
