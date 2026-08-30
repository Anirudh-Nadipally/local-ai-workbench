import { describe, expect, it } from "vitest";
import {
  conversationExportFilename,
  conversationMessagesToMarkdown,
  selectConversationMessages,
  type ConversationExportMessage,
} from "@/lib/conversation-export";

const messages: ConversationExportMessage[] = [
  { id: "q1", role: "user", content: "What is **important**?" },
  { id: "a1", role: "assistant", content: "The answer has a | Markdown table.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |" },
  { id: "q2", role: "user", content: "Follow-up" },
];

describe("conversation Markdown export", () => {
  it("keeps source order and selects all/questions/answers/custom", () => {
    expect(selectConversationMessages(messages, "all").map((message) => message.id)).toEqual(["q1", "a1", "q2"]);
    expect(selectConversationMessages(messages, "questions").map((message) => message.id)).toEqual(["q1", "q2"]);
    expect(selectConversationMessages(messages, "answers").map((message) => message.id)).toEqual(["a1"]);
    expect(selectConversationMessages(messages, "custom", new Set(["q2", "q1"])).map((message) => message.id)).toEqual(["q1", "q2"]);
  });

  it("preserves raw Markdown content", () => {
    expect(conversationMessagesToMarkdown([messages[1]], "A | title")).toBe(
      "# A | title\n\n## Answer\n\nThe answer has a | Markdown table.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("creates a safe bounded filename", () => {
    expect(conversationExportFilename("My Strategy: Q&A / 2026")).toBe("my-strategy-q-a-2026.md");
    expect(conversationExportFilename("!!!")).toBe("conversation.md");
  });
});
