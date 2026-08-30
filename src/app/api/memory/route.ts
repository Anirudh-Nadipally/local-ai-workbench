import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { MEMORY_TYPES } from "@/lib/types";
import { assertProjectThread } from "@/lib/integrity";
import { acceptMemoryCandidate, createMemory, deleteMemory, getMessage, listMemories, listMemoryCandidates, rejectMemoryCandidate, updateMemory } from "@/lib/repository";

const ActionSchema = z.object({
  action: z.enum(["accept", "reject", "edit", "delete", "create"]), id: z.string().optional(),
  projectId: z.string().optional(), threadId: z.string().optional(), messageId: z.string().optional(),
  type: z.enum(MEMORY_TYPES).optional(), title: z.string().max(120).optional(), content: z.string().max(1_200).optional(),
  scope: z.string().max(120).optional(), sensitivity: z.enum(["normal", "sensitive"]).optional(),
  edits: z.object({
    type: z.enum(MEMORY_TYPES).optional(), title: z.string().max(120).optional(), content: z.string().max(1_200).optional(),
    scope: z.string().max(120).optional(), sensitivity: z.enum(["normal", "sensitive"]).optional(), confidence: z.number().min(0).max(1).optional(), explicit: z.boolean().optional(),
  }).optional(),
});

export async function GET(request: Request) {
  try {
    apiGuard(request); const url = new URL(request.url); const projectId = url.searchParams.get("projectId");
    if (!projectId) throw new Error("projectId is required."); const threadId = url.searchParams.get("threadId") ?? undefined;
    return Response.json({ memories: listMemories(projectId, threadId), candidates: listMemoryCandidates(projectId, threadId) });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    apiGuard(request, true); const input = ActionSchema.parse(await request.json());
    if (input.action === "create") {
      if (!input.projectId || !input.threadId || !input.title?.trim() || !input.content?.trim() || !input.type) throw new Error("Complete the memory before saving it.");
      assertProjectThread(input.projectId, input.threadId);
      const evidenceMessage = input.messageId ? getMessage(input.messageId) : null;
      if (input.messageId && (!evidenceMessage || evidenceMessage.threadId !== input.threadId)) throw new Error("The supporting message is unavailable in this conversation.");
      return Response.json({ memory: createMemory({
        projectId: input.projectId, threadId: input.scope === "project" ? null : input.threadId, type: input.type,
        title: input.title, content: input.content, scope: input.scope ?? "conversation", sensitivity: input.sensitivity,
        confidence: 1, explicit: true, evidence: input.messageId ? [{ kind: "message", id: input.messageId }] : [],
      }) });
    }
    if (!input.id) throw new Error("Memory id is required.");
    if (input.action === "accept") return Response.json({ memory: acceptMemoryCandidate(input.id, input.edits) });
    if (input.action === "reject") return Response.json({ rejected: rejectMemoryCandidate(input.id) });
    if (input.action === "edit") return Response.json({ memory: updateMemory(input.id, input.edits ?? {}) });
    return Response.json({ deleted: deleteMemory(input.id) });
  } catch (error) { return apiError(error); }
}
