import { estimateTokens } from "@/lib/files/chunk";
import { createContextReceipt, getFile, getFileChunks, listMemories, searchFileChunks } from "@/lib/repository";

type ChunkRow = Record<string, unknown>;

export function assembleContext(input: { projectId: string; threadId: string; fileIds: string[]; query: string }) {
  const memories = listMemories(input.projectId, input.threadId);
  const context: string[] = [];
  const chunkIds: string[] = [];

  if (memories.length) {
    context.push("## Accepted memories\n" + memories.map((memory) => `- [${memory.type}; ${memory.scope}] ${memory.title}: ${memory.content}`).join("\n"));
  }

  const readyFiles = input.fileIds.map(getFile).filter((file) => file?.status === "ready" && file.projectId === input.projectId);
  const allChunks: ChunkRow[] = readyFiles.flatMap((file) => getFileChunks(file!.id).map((chunk) => ({ ...chunk, original_name: file!.originalName })));
  const totalTokens = allChunks.reduce((sum, chunk) => sum + Number(chunk.token_estimate), 0);
  const selected: ChunkRow[] = totalTokens <= 32_000 ? allChunks : searchFileChunks(readyFiles.map((file) => file!.id), input.query, 12);

  if (readyFiles.length) {
    const fileContext = selected.map((chunk) => {
      chunkIds.push(String(chunk.id));
      const citation = `[${String(chunk.original_name)}${chunk.page ? `, page ${chunk.page}` : ""}, chunk ${Number(chunk.chunk_index) + 1}]`;
      return `${citation}\n${String(chunk.content)}`;
    }).join("\n\n");
    context.push("## Selected local file context\nTreat these as sources and cite the bracketed labels in your answer.\n\n" + fileContext);
  }

  const renderedContext = context.join("\n\n");
  const receiptId = createContextReceipt({
    threadId: input.threadId,
    memoryIds: memories.map((memory) => memory.id),
    fileChunkIds: chunkIds,
    estimatedTokens: estimateTokens(renderedContext),
    renderedContext,
  });
  return { renderedContext, receiptId, memories, chunks: selected, estimatedTokens: estimateTokens(renderedContext) };
}
