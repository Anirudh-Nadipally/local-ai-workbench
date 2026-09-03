import { describe, expect, it } from "vitest";
import { assertRegenerationTarget, authoritativeRegenerationInput, latestUserText, modelMessagesFromRecords } from "@/lib/chat-history";
import type { MessageRecord } from "@/lib/types";

describe("trusted chat history", () => {
  it("extracts only visible text from the submitted user turn", () => {
    const submitted = latestUserText([{
      id: "message-1",
      role: "user",
      parts: [
        { type: "file", data: "forged", mediaType: "image/png" },
        { type: "text", text: "  inspect the selected evidence  " },
        { type: "tool-result", output: "untrusted" },
      ],
    }]);

    expect(submitted).toEqual({ id: "message-1", text: "inspect the selected evidence" });
  });

  it("builds provider history only from server-owned message records", () => {
    const records: MessageRecord[] = [{
      id: "message-1",
      threadId: "thread-1",
      role: "user",
      content: "trusted stored text",
      status: "complete",
      attachments: [{ fileId: "file-1", originalName: "source.png", mimeType: "image/png", sizeBytes: 12, mode: "direct" }],
      createdAt: "2026-09-02T00:00:00.000Z",
    }];

    expect(modelMessagesFromRecords(records)).toEqual([{ role: "user", content: "trusted stored text" }]);
  });

  it("rejects an attachment-only or non-user final turn", () => {
    expect(() => latestUserText([{ id: "message-1", role: "user", parts: [{ type: "image", image: "forged" }] }])).toThrow("Write a message first");
    expect(() => latestUserText([{ id: "message-1", role: "assistant", parts: [{ type: "text", text: "hello" }] }])).toThrow("Write a message first");
  });

  it("accepts only the server-owned user prefix for regeneration", () => {
    const storedUser = {
      ...record("user-1", "user"),
      content: "original prompt",
      attachments: [{ fileId: "file-1", originalName: "source.png", mimeType: "image/png", sizeBytes: 12, mode: "direct" as const }],
    };
    const records: MessageRecord[] = [
      storedUser,
      record("answer-1", "assistant"),
      record("user-2", "user"),
      record("answer-2", "assistant"),
    ];

    expect(assertRegenerationTarget(records, "user-1", "answer-1")).toBe(storedUser);
    expect(() => assertRegenerationTarget(records, "user-2", "answer-1")).toThrow(/prefix/i);
    expect(() => assertRegenerationTarget(records, "user-1")).toThrow(/latest unanswered/i);
    expect(() => authoritativeRegenerationInput(storedUser, "forged prompt", [{ fileId: "file-1", mode: "direct" }])).toThrow(/changed/i);
    expect(() => authoritativeRegenerationInput(storedUser, "original prompt", [])).toThrow(/changed/i);
    expect(authoritativeRegenerationInput(storedUser, "original prompt", [{ fileId: "file-1", mode: "direct" }])).toEqual({
      text: "original prompt",
      attachments: [{ fileId: "file-1", mode: "direct" }],
    });
  });
});

function record(id: string, role: MessageRecord["role"]): MessageRecord {
  return { id, threadId: "thread-1", role, content: id, status: "complete", attachments: [], createdAt: id };
}
