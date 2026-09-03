import type { ModelMessage } from "ai";
import type { AttachmentSelection } from "@/lib/attachments";
import type { MessageRecord } from "@/lib/types";

export type ClientChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
};

/**
 * Read only the text the user is visibly submitting. Client-provided image,
 * file, tool, and metadata parts never become model input; attachments are
 * resolved separately from server-owned file records.
 */
export function latestUserText(messages: ClientChatMessage[]) {
  const latest = messages.at(-1);
  if (!latest || latest.role !== "user") throw new Error("Write a message first.");

  const text = latest.parts
    .filter((part): part is { type: "text"; text: string } => (
      typeof part === "object"
      && part !== null
      && (part as { type?: unknown }).type === "text"
      && typeof (part as { text?: unknown }).text === "string"
    ))
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Write a message first.");
  return { id: latest.id, text };
}

/**
 * The local database is the authority for conversation history. This keeps
 * untrusted browser message parts from bypassing file ownership checks or the
 * context receipt while retaining the exact stored conversation text.
 */
export function modelMessagesFromRecords(records: MessageRecord[]): ModelMessage[] {
  return records.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Regeneration is an explicit timeline rewrite. Validate the target against
 * server-owned history before truncating so a forged browser prefix cannot
 * select an unrelated turn.
 */
export function assertRegenerationTarget(records: MessageRecord[], submittedUserId: string, targetMessageId?: string) {
  const submittedIndex = records.findIndex((message) => message.id === submittedUserId);
  if (submittedIndex < 0 || records[submittedIndex].role !== "user") {
    throw new Error("The message to regenerate was not found in this conversation.");
  }

  if (!targetMessageId) {
    if (submittedIndex !== records.length - 1) {
      throw new Error("Retry is only available for the latest unanswered message.");
    }
    return records[submittedIndex];
  }

  const targetIndex = records.findIndex((message) => message.id === targetMessageId);
  if (targetIndex < 0) throw new Error("The response to regenerate was not found in this conversation.");
  const target = records[targetIndex];
  if (target.role === "user") {
    if (target.id !== submittedUserId) throw new Error("The regeneration target does not match the submitted user turn.");
    return records[submittedIndex];
  }
  if (target.role !== "assistant") throw new Error("Only user or assistant turns can be regenerated.");

  const precedingUser = records.slice(0, targetIndex).reverse().find((message) => message.role === "user");
  if (!precedingUser || precedingUser.id !== submittedUserId) {
    throw new Error("The regeneration target does not match the submitted conversation prefix.");
  }
  return records[submittedIndex];
}

export function authoritativeRegenerationInput(
  storedUser: MessageRecord,
  submittedText: string,
  submittedAttachments: AttachmentSelection[],
) {
  const storedAttachments: AttachmentSelection[] = storedUser.attachments.map(({ fileId, mode, preparationDeployment }) => ({
    fileId,
    mode,
    ...(preparationDeployment ? { preparationDeployment } : {}),
  }));
  if (storedUser.content !== submittedText || attachmentFingerprint(storedAttachments) !== attachmentFingerprint(submittedAttachments)) {
    throw new Error("The conversation changed before regeneration. Reload it and try again.");
  }
  return { text: storedUser.content, attachments: storedAttachments };
}

function attachmentFingerprint(attachments: AttachmentSelection[]) {
  return JSON.stringify(attachments.map((attachment) => ({
    fileId: attachment.fileId,
    mode: attachment.mode,
    preparationDeployment: attachment.preparationDeployment?.trim() || null,
  })).sort((left, right) => left.fileId.localeCompare(right.fileId)));
}
