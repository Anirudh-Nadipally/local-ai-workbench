import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
let store: typeof import("../src/server/db"),
  workspace: typeof import("../src/server/workspace"),
  temporary: typeof import("../src/server/temporary"),
  sources: typeof import("../src/server/sources"),
  api: typeof import("../src/server/api"),
  backups: typeof import("../src/server/backup");
beforeAll(async () => {
  process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-temporary-"),
  );
  store = await import("../src/server/db");
  workspace = await import("../src/server/workspace");
  temporary = await import("../src/server/temporary");
  sources = await import("../src/server/sources");
  api = await import("../src/server/api");
  backups = await import("../src/server/backup");
});
beforeEach(() => {
  store.db().exec("DELETE FROM records; DELETE FROM search_index;");
});
function seed() {
  const thread = workspace.createThread(null, "Temporary test", true);
  const message = store.put("message", {
    ...store.base(),
    threadId: thread.id,
    role: "user",
    content: "TEMPORARYMARKER should not be searchable",
    status: "complete",
    sourceIds: [],
  });
  const source = sources.addSource(
    "private-scratch.md",
    Buffer.from("Temporary source content"),
    null,
    thread.id,
  );
  return { thread, message, source };
}
async function request(route: string, data: unknown, method = "POST") {
  return api.handle(
    new Request("http://127.0.0.1:3024/api/" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3024",
      },
      body: JSON.stringify(data),
    }),
    route.split("/"),
  );
}
describe("temporary chat boundaries", () => {
  it("is separate from history, project context, the search index, and backup files", async () => {
    const { thread, message, source } = seed();
    expect(thread.includeBrief).toBe(false);
    expect(thread.projectId).toBeNull();
    expect(workspace.boot().threads).toHaveLength(0);
    expect(workspace.boot().temporaryThreads.map((t) => t.id)).toEqual([
      thread.id,
    ]);
    expect(store.search("TEMPORARYMARKER")).toEqual([]);
    expect(store.search("private scratch")).toEqual([]);
    const zip = await JSZip.loadAsync(await backups.backup());
    const json = await zip.file("workbench.json")!.async("string");
    for (const id of [thread.id, message.id, source.id])
      expect(json).not.toContain(id);
    expect(zip.file("uploads/" + source.storedName)).toBeNull();
  });
  it("explicit Keep adds the same chat and attachments to history, search, and backups", async () => {
    const { thread, source } = seed();
    const kept = temporary.keepTemporaryChat(thread.id);
    expect(kept.temporary).toBe(false);
    expect(kept.expiresAt).toBeUndefined();
    expect(kept.includeBrief).toBe(false);
    expect(workspace.boot().threads[0].id).toBe(thread.id);
    expect(workspace.boot().temporaryThreads).toHaveLength(0);
    expect(store.search("TEMPORARYMARKER")).toHaveLength(1);
    const zip = await JSZip.loadAsync(await backups.backup());
    expect(await zip.file("workbench.json")!.async("string")).toContain(
      thread.id,
    );
    expect(zip.file("uploads/" + source.storedName)).not.toBeNull();
  });
  it("deletes associated records, queued jobs, and attachments without touching saved work", () => {
    const { thread, source } = seed();
    const regular = workspace.createThread();
    const shared = store.put("source", {
      ...source,
      ...store.base(),
      threadId: regular.id,
    });
    const onlyTemporary = sources.addSource(
      "only-temporary.md",
      Buffer.from("Temporary only"),
      null,
      thread.id,
    );
    temporary.deleteTemporaryChat(thread.id);
    expect(store.get("thread", thread.id)).toBeNull();
    expect(store.threadMessages(thread.id)).toHaveLength(0);
    expect(store.all("job")).toHaveLength(0);
    expect(store.get("source", source.id)).toBeNull();
    expect(store.get("source", shared.id)).not.toBeNull();
    expect(fs.existsSync(store.filePath(onlyTemporary.storedName))).toBe(false);
    expect(fs.existsSync(store.filePath(shared.storedName))).toBe(true);
    expect(() => temporary.deleteTemporaryChat(regular.id)).toThrow(
      "Only temporary",
    );
  });
  it("expires idle chats, including their files, and leaves kept conversations alone", () => {
    const { thread, source } = seed();
    const kept = workspace.createThread();
    temporary.cleanupTemporaryChats(Date.parse(thread.expiresAt!) + 1);
    expect(store.get("thread", thread.id)).toBeNull();
    expect(fs.existsSync(store.filePath(source.storedName))).toBe(false);
    expect(store.get("thread", kept.id)).not.toBeNull();
  });
  it("blocks persistent exports, outputs, branches, project context and trash while temporary", async () => {
    const { thread, message } = seed();
    expect(
      (
        await request("exports", {
          threadId: thread.id,
          intent: "continue",
          messageIds: [message.id],
          sourceIds: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("outputs", {
          threadId: thread.id,
          title: "No automatic saving",
          content: "No",
          evidence: [message.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("branch", { threadId: thread.id, messageId: message.id }))
        .status,
    ).toBe(400);
    expect(
      (await request("threads/" + thread.id, { includeBrief: true }, "PATCH"))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          "threads/" + thread.id,
          { deletedAt: new Date().toISOString() },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    const project = store.put("project", {
      ...store.base(),
      name: "Saved project",
      objective: "",
      briefId: null,
    });
    expect(() =>
      workspace.createThread(project.id, "No project", true),
    ).toThrow("cannot belong");
  });
  it("extends retention on user activity but not on read-only polling", async () => {
    const { thread } = seed();
    const oldExpiry = new Date(Date.now() + 60000).toISOString();
    store.put("thread", { ...thread, expiresAt: oldExpiry });
    workspace.view(thread.id);
    expect(store.required("thread", thread.id).expiresAt).toBe(oldExpiry);
    await request("threads/" + thread.id, { draft: "Still working" }, "PATCH");
    expect(
      Date.parse(store.required("thread", thread.id).expiresAt!),
    ).toBeGreaterThan(Date.parse(oldExpiry));
  });
});
