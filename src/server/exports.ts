import { requireSavedChat } from "./temporary";
import { base, put, required, threadMessages } from "./db";
import { sourceForThread } from "./workspace";
import type { ExportIntent, ExportSnapshot } from "@/domain/types";
export function makeExport(input: {
  threadId: string;
  intent: ExportIntent;
  nextTask: string;
  messageIds: string[];
  sourceIds: string[];
  content?: string;
}): ExportSnapshot {
  const thread = required("thread", input.threadId),
    messages = threadMessages(thread.id).filter((m) =>
      input.messageIds.includes(m.id),
    );
  requireSavedChat(thread);
  if (messages.length !== new Set(input.messageIds).size)
    throw new Error("Export selection includes a missing message.");
  const project = thread.projectId
    ? required("project", thread.projectId)
    : null;
  const brief = project?.briefId ? required("brief", project.briefId) : null;
  const manifest = input.sourceIds.map((id) => {
    const s = sourceForThread(thread, id);
    return { id: s.id, name: s.name, hash: s.hash, storedName: s.storedName };
  });
  let content = "";
  if (input.intent === "transcript")
    content =
      `# ${thread.title}\n\n` +
      messages
        .map(
          (m) =>
            `## ${m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Historical system"}${m.status !== "complete" ? ` (${m.status})` : ""}\n\n${m.content}${m.sourceIds.length ? "\n\nAttachments: " + m.sourceIds.map((id) => required("source", id).name).join(", ") : ""}`,
        )
        .join("\n\n---\n\n");
  if (input.intent === "share")
    content =
      `# ${thread.title}\n\n` +
      messages.map((m) => m.content).join("\n\n---\n\n");
  if (input.intent === "continue")
    content =
      `# Continue: ${thread.title}\n\n## Next task\n${input.nextTask || "Continue from the unresolved questions below."}\n\n## Project context\n${brief?.content || "Use the conversation below as background. Assistant suggestions remain proposals unless the user accepted them."}\n\n## Conversation context\n` +
      messages
        .map(
          (m, index) =>
            `### ${m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Historical system"} · Message ${index + 1}\n\n${m.content}`,
        )
        .join("\n\n") +
      "\n\n## How to continue\nAddress the next task above using this context. Preserve unresolved questions and distinguish user decisions from assistant suggestions.\n";
  content = input.content ?? content;
  return put("export", {
    ...base(),
    revision: 0,
    threadId: thread.id,
    title: thread.title,
    intent: input.intent,
    nextTask: input.nextTask,
    content,
    messageIds: messages.map((m) => m.id),
    sourceIds: input.sourceIds,
    manifest,
    briefId: brief?.id || null,
  });
}
export function exportDocument(snapshot: ExportSnapshot) {
  if (snapshot.intent === "share") return snapshot.content + "\n";
  return (
    snapshot.content +
    `\n\n---\nPrepared ${snapshot.createdAt.slice(0, 10)}\n` +
    (snapshot.manifest.length
      ? "\nIncluded originals (when downloading the bundle):\n" +
        snapshot.manifest.map((s) => `- ${s.name}`).join("\n")
      : "\nNo original files included.")
  );
}
