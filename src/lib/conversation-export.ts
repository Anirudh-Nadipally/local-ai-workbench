export type ConversationExportRole = "user" | "assistant" | "system";

export type ConversationExportMessage = {
  id: string;
  role: ConversationExportRole;
  content: string;
};

export type ConversationExportPreset = "all" | "questions" | "answers" | "custom";

/** Keep messages in their original order while applying an export preset. */
export function selectConversationMessages(
  messages: readonly ConversationExportMessage[],
  preset: ConversationExportPreset,
  selectedIds: ReadonlySet<string> = new Set(messages.map((message) => message.id)),
) {
  return messages.filter((message) => {
    if (preset === "all") return true;
    if (preset === "questions") return message.role === "user";
    if (preset === "answers") return message.role === "assistant";
    return selectedIds.has(message.id);
  });
}

/** Render the selected messages without changing the Markdown inside them. */
export function conversationMessagesToMarkdown(
  messages: readonly ConversationExportMessage[],
  title?: string,
) {
  const heading = title ? `# ${title}\n\n` : "";
  const body = messages.map((message) => {
    const label = message.role === "user" ? "Question" : message.role === "assistant" ? "Answer" : "System";
    return `## ${label}\n\n${message.content}`;
  }).join("\n\n");
  return `${heading}${body}`;
}

/** Create a safe, stable filename for a Markdown download. */
export function conversationExportFilename(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "conversation"}.md`;
}
