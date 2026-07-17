import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { assembleContext } from "@/lib/context";
import { createId, nowIso } from "@/lib/ids";
import { getSqlite } from "@/lib/db";
import { redactSecrets } from "@/lib/config";
import { assertFilesBelongToProject, assertProjectThread } from "@/lib/integrity";
import { reasoningProviderOptions, resolveAzureDeployment } from "@/lib/model-routing";
import { saveMessage } from "@/lib/repository";

export const runtime = "nodejs";
export const maxDuration = 300;

const ChatSchema = z.object({
  id: z.string().optional(), threadId: z.string(), projectId: z.string(), deployment: z.string(),
  fileIds: z.array(z.string()).max(10).default([]), messages: z.array(z.any()), reasoningEffort: z.enum(["none", "low", "medium", "high"]).default("medium"),
});

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = ChatSchema.parse(await request.json());
    const { project, thread } = assertProjectThread(input.projectId, input.threadId);
    assertFilesBelongToProject(input.fileIds, project.id);
    const uiMessages = input.messages as UIMessage[];
    const last = uiMessages.at(-1);
    const userText = last?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim() ?? "";
    if (!userText) throw new Error("Write a message first.");
    if (last?.role === "user") saveMessage({ id: last.id, threadId: thread.id, role: "user", content: userText });

    const resolved = resolveAzureDeployment(input.deployment, ["textGeneration", "streaming"]);
    const context = assembleContext({ projectId: project.id, threadId: thread.id, fileIds: input.fileIds, query: userText });
    const generationId = createId("generation");
    const started = Date.now();
    getSqlite().prepare(`INSERT INTO generations (id,thread_id,deployment_id,status,settings_json,context_receipt_id,started_at)
      VALUES (?,?,?,'streaming',?,?,?)`).run(generationId, thread.id, input.deployment, JSON.stringify({ reasoningEffort: input.reasoningEffort, fileIds: input.fileIds }), context.receiptId, nowIso());

    const system = [
      "You are the user's local Azure AI workbench. Be accurate, direct, and useful. Separate facts from assumptions when uncertainty matters.",
      project.instructions ? `PROJECT INSTRUCTIONS\n${project.instructions}` : "",
      context.renderedContext,
    ].filter(Boolean).join("\n\n");

    const result = streamText({
      model: resolved.model,
      system,
      messages: await convertToModelMessages(uiMessages),
      providerOptions: reasoningProviderOptions(resolved.deployment, input.reasoningEffort),
      onFinish: ({ text, finishReason, usage, providerMetadata }) => {
        const assistant = saveMessage({ threadId: thread.id, role: "assistant", content: text });
        getSqlite().prepare(`UPDATE generations SET message_id=?,status='complete',input_tokens=?,output_tokens=?,duration_ms=?,finish_reason=?,provider_metadata_json=?,completed_at=? WHERE id=?`)
          .run(assistant.id, usage.inputTokens ?? null, usage.outputTokens ?? null, Date.now() - started, finishReason, JSON.stringify(providerMetadata ?? {}), nowIso(), generationId);
      },
      onError: ({ error }) => {
        getSqlite().prepare("UPDATE generations SET status='failed',error=?,duration_ms=?,completed_at=? WHERE id=?")
          .run(redactSecrets(error instanceof Error ? error.message : "Streaming failed"), Date.now() - started, nowIso(), generationId);
      },
    });
    return result.toUIMessageStreamResponse({ originalMessages: uiMessages });
  } catch (error) { return apiError(error); }
}
