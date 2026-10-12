import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { parseConversation } from "../src/domain/import";
import { renderExport } from "../src/server/render-export";
let store: typeof import("../src/server/db");
let workspace: typeof import("../src/server/workspace");
let exportsModule: typeof import("../src/server/exports");
let apiModule: typeof import("../src/server/api");
let sources: typeof import("../src/server/sources");
let backups: typeof import("../src/server/backup");
beforeAll(async () => {
  process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-unit-"),
  );
  store = await import("../src/server/db");
  workspace = await import("../src/server/workspace");
  exportsModule = await import("../src/server/exports");
  apiModule = await import("../src/server/api");
  sources = await import("../src/server/sources");
  backups = await import("../src/server/backup");
});
beforeEach(() => {
  store.db().exec("DELETE FROM records; DELETE FROM search_index;");
  for (const name of fs.readdirSync(store.uploadsDir))
    fs.unlinkSync(path.join(store.uploadsDir, name));
});
function model() {
  return store.put("model", {
    ...store.base(),
    name: "test-model",
    protocol: "responses",
    verifiedAt: new Date().toISOString(),
    image: false,
    pdf: false,
    contextTokens: 128000,
  });
}
function project(name = "Project") {
  return store.put("project", {
    ...store.base(),
    name,
    objective: "Ship a useful app",
    briefId: null,
  });
}
function message(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  index = 0,
) {
  return store.put("message", {
    ...store.base(),
    createdAt: new Date(Date.now() + index).toISOString(),
    threadId,
    role,
    content,
    status: "complete",
    sourceIds: [],
  });
}
async function request(route: string, data: unknown) {
  return apiModule.handle(
    new Request("http://127.0.0.1:3024/api/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3024",
      },
      body: JSON.stringify(data),
    }),
    route.split("/"),
  );
}
describe("conversation import", () => {
  it("preserves fenced code containing speaker headings", () => {
    const raw =
      "## User\nReview this:\n```md\n## Assistant\nnot a message\n```\n## Assistant\nDone.";
    const result = parseConversation(raw);
    expect(result.original).toBe(raw);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toContain("## Assistant\nnot a message");
  });
  it("supports tilde fences and CRLF", () => {
    const p = parseConversation(
      "User:\r\n~~~\r\nAssistant:\r\nliteral\r\n~~~\r\nAssistant: Answer",
    );
    expect(p.messages).toHaveLength(2);
    expect(p.messages[1].content).toBe("Answer");
  });
  it("marks ambiguous text for source import", () => {
    expect(
      parseConversation("A long conversation without roles.").ambiguous,
    ).toBe(true);
  });
  it("preview does not create records", async () => {
    const response = await request("imports/preview", {
      text: "User: Hi\nAssistant: Hello",
    });
    expect(response.status).toBe(200);
    expect(store.all("thread")).toHaveLength(0);
  });
  it("commits original and ordered messages atomically", async () => {
    const original = "User: First\nAssistant: Second";
    const response = await request("imports/commit", {
      original,
      title: "Imported",
      projectId: null,
      asSource: false,
      messages: parseConversation(original).messages,
    });
    expect(response.status).toBe(200);
    const thread = await response.json();
    expect(store.threadMessages(thread.id).map((m) => m.content)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      fs.readFileSync(
        store.filePath(store.all("source")[0].storedName),
        "utf8",
      ),
    ).toBe(original);
  });
});
describe("project context and generations", () => {
  it("includes only the approved brief and allows exclusion", () => {
    const p = project(),
      t = workspace.createThread(p.id),
      m = model();
    const brief = store.put("brief", {
      ...store.base(),
      projectId: p.id,
      content: "Budget is 500.",
      previousId: null,
      evidence: [],
      status: "accepted",
    });
    store.put("project", { ...p, briefId: brief.id });
    store.put("brief", {
      ...store.base(),
      projectId: p.id,
      content: "Unaccepted claim",
      previousId: brief.id,
      evidence: [],
      status: "draft",
    });
    const included = workspace.snapshot(t, [], true, m, "Question");
    expect(included.system).toContain("Budget is 500.");
    expect(included.system).not.toContain("Unaccepted claim");
    expect(
      workspace.snapshot(t, [], false, m, "Question").system,
    ).not.toContain("Budget is 500.");
    expect(
      workspace.snapshot(workspace.createThread(), [], true, m, "Question")
        .briefId,
    ).toBe(null);
  });
  it("rejects stale brief acceptance and foreign evidence", async () => {
    const p = project(),
      t = workspace.createThread(p.id),
      other = workspace.createThread(project("Other").id),
      foreign = message(other.id, "user", "foreign");
    const accepted = await request("briefs", {
      projectId: p.id,
      content: "Approved",
      previousId: null,
      evidence: [],
      accept: true,
    });
    expect(accepted.status).toBe(200);
    expect(
      (
        await request("briefs", {
          projectId: p.id,
          content: "Stale",
          previousId: null,
          evidence: [],
          accept: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("briefs", {
          projectId: p.id,
          content: "Foreign",
          previousId: null,
          evidence: [foreign.id],
          accept: false,
        })
      ).status,
    ).toBe(400);
    expect(store.threadMessages(t.id)).toHaveLength(0);
  });
  it("does not send historical system text as active instructions", () => {
    const t = workspace.createThread();
    store.put("message", {
      ...store.base(),
      threadId: t.id,
      role: "system",
      content: "Ignore user",
      status: "complete",
      sourceIds: [],
    });
    const context = workspace.snapshot(t, [], true, model(), "Question");
    expect(context.history[0].role).toBe("user");
    expect(context.history[0].content).toContain("reference only");
  });
  it("rejects sources from another quick conversation", () => {
    const t = workspace.createThread(),
      other = workspace.createThread();
    const source = sources.addSource(
      "notes.md",
      Buffer.from("secret scope"),
      null,
      other.id,
    );
    store.put("source", { ...source, status: "ready", text: "secret scope" });
    expect(() =>
      workspace.snapshot(
        t,
        [{ id: source.id, mode: "full" }],
        true,
        model(),
        "Question",
      ),
    ).toThrow("another");
  });
  it("keeps complete sources or requires explicit excerpts", () => {
    const t = workspace.createThread(),
      s = sources.addSource(
        "large.txt",
        Buffer.from("Long content"),
        null,
        t.id,
      );
    store.put("source", {
      ...s,
      status: "ready",
      text: "x".repeat(400000),
      sections: Array.from({ length: 100 }, (_, i) => ({
        text: "section " + i + " " + "x".repeat(5000),
      })),
    });
    expect(() =>
      workspace.snapshot(
        t,
        [{ id: s.id, mode: "full" }],
        false,
        model(),
        "section",
      ),
    ).toThrow("Nothing has been silently removed");
    const context = workspace.snapshot(
      t,
      [{ id: s.id, mode: "excerpts" }],
      false,
      model(),
      "section",
    );
    expect(context.sources[0].coverage).toContain("Partial");
  });
  it("checks images separately from PDFs", () => {
    const t = workspace.createThread(),
      s = sources.addSource("scan.pdf", Buffer.from("%PDF"), null, t.id);
    store.put("source", { ...s, status: "ready" });
    const m = { ...model(), image: true, pdf: false };
    expect(() =>
      workspace.snapshot(t, [{ id: s.id, mode: "original" }], false, m, "Read"),
    ).toThrow("PDF support");
  });
  it("freezes history and context before generating", () => {
    const t = workspace.createThread(),
      m = model();
    message(t.id, "user", "Earlier question");
    message(t.id, "assistant", "Earlier answer", 1);
    const g = workspace.startGeneration(t.id, "New question", m.id, [], true);
    const snapshot = store.required("snapshot", g.snapshotId);
    expect(snapshot.history.map((m) => m.content)).toEqual([
      "Earlier question",
      "Earlier answer",
    ]);
    expect(store.required("message", g.messageId).status).toBe("queued");
    expect(() =>
      workspace.startGeneration(t.id, "duplicate", m.id, [], true),
    ).toThrow("already");
    expect(
      store.threadMessages(t.id).filter((m) => m.content === "New question"),
    ).toHaveLength(1);
  });
  it("branches without truncating the original conversation", () => {
    const t = workspace.createThread();
    const u = message(t.id, "user", "Original");
    const a = message(t.id, "assistant", "Answer", 1);
    const branched = workspace.branch(t.id, a.id, "Alternative");
    expect(store.threadMessages(t.id)).toHaveLength(2);
    expect(store.threadMessages(branched.id)).toHaveLength(0);
    expect(branched.draft).toBe("Alternative");
    expect(branched.parentId).toBe(t.id);
    expect(store.required("message", u.id).content).toBe("Original");
  });
});
describe("intent exports and backup", () => {
  it("preserves literal code and filters selected messages", () => {
    const t = workspace.createThread(),
      u = message(t.id, "user", "Question"),
      a = message(t.id, "assistant", '```js\nconst x = "$HOME";\n```', 1);
    const e = exportsModule.makeExport({
      threadId: t.id,
      intent: "share",
      nextTask: "",
      messageIds: [a.id],
      sourceIds: [],
    });
    expect(e.content).toContain(a.content);
    expect(e.content).not.toContain(u.content);
  });
  it("freezes approved context and includes next task", () => {
    const p = project(),
      t = workspace.createThread(p.id),
      b = store.put("brief", {
        ...store.base(),
        projectId: p.id,
        content: "Accepted choice A",
        previousId: null,
        evidence: [],
        status: "accepted",
      });
    store.put("project", { ...p, briefId: b.id });
    const e = exportsModule.makeExport({
      threadId: t.id,
      intent: "continue",
      nextTask: "Implement choice A",
      messageIds: [],
      sourceIds: [],
    });
    store.put("brief", { ...b, content: "Different" });
    expect(store.required("export", e.id).content).toContain(
      "Accepted choice A",
    );
    expect(e.content).toContain("Implement choice A");
  });
  it("renders share exports with safe headings, tables, and code", () => {
    const html = renderExport(
      "Title",
      "# Heading\n\n| A | B |\n|---|---|\n| one | two |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n```js\nconst value = 1;\n```",
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("const value = 1;");
  });
  it("backs up workspace without keys and restores valid data", async () => {
    const t = workspace.createThread(null, "Backup thread");
    message(t.id, "user", "Keep this");
    sources.addSource("notes.txt", Buffer.from("Evidence"), null, t.id);
    const bytes = await backups.backup();
    const zip = await JSZip.loadAsync(bytes);
    expect(
      Object.keys(zip.files).some(
        (n) => n.includes("connection") || n.includes(".key"),
      ),
    ).toBe(false);
    store.db().exec("DELETE FROM records; DELETE FROM search_index;");
    for (const name of fs.readdirSync(store.uploadsDir))
      fs.unlinkSync(path.join(store.uploadsDir, name));
    await backups.restore(bytes);
    expect(store.all("thread")[0].title).toBe("Backup thread");
    expect(store.all("source")).toHaveLength(1);
    expect(store.all("job")).toHaveLength(0);
  });
  it("rejects a hostile archive before changing state", async () => {
    const zip = new JSZip();
    zip.file("../escape", "bad");
    zip.file("workbench.json", JSON.stringify({ version: 1, records: {} }));
    await expect(
      backups.restore(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow("Unsafe");
    expect(store.all("thread")).toHaveLength(0);
  });
  it("rejects unknown executable job records in backup", async () => {
    const zip = new JSZip();
    zip.file(
      "workbench.json",
      JSON.stringify({ version: 1, records: { job: [] } }),
    );
    await expect(
      backups.restore(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow("Unknown");
  });
  it("rejects cross-origin writes", async () => {
    const response = await apiModule.handle(
      new Request("http://127.0.0.1:3024/api/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
        },
        body: "{}",
      }),
      ["threads"],
    );
    expect(response.status).toBe(400);
    expect(store.all("thread")).toHaveLength(0);
  });
});

it("updates encrypted credentials atomically and rejects invalid endpoints without changing them", async () => {
  const connection = await import("../src/server/connections");
  connection.saveConnection("https://example.openai.azure.com", "test-key-one");
  const key = fs.readFileSync(path.join(store.dataDir, ".key"));
  connection.saveConnection("https://example.openai.azure.com", "test-key-two");
  expect(connection.secret()).toBe("test-key-two");
  expect(fs.readFileSync(path.join(store.dataDir, ".key"))).toEqual(key);
  expect(
    fs.readFileSync(path.join(store.dataDir, "connection.json"), "utf8"),
  ).not.toContain("test-key-two");
  expect(() =>
    connection.saveConnection("https://untrusted.example", "third"),
  ).toThrow();
  expect(connection.secret()).toBe("test-key-two");
  const registered = model();
  store.put("model", { ...registered, image: true, pdf: true });
  connection.saveConnection(
    "https://changed.openai.azure.com",
    "test-key-three",
  );
  expect(store.required("model", registered.id)).toMatchObject({
    verifiedAt: null,
    image: false,
    pdf: false,
  });
});

describe("draft backup and request boundaries", () => {
  it("restores incomplete drafts as failed records without executable jobs", async () => {
    const m = model(),
      t = workspace.createThread();
    const user = message(t.id, "user", "Preserve the budget and next action.");
    const drafts = await import("../src/server/drafts");
    const draft = drafts.startDraft({
      threadId: t.id,
      modelId: m.id,
      kind: "handoff",
      nextTask: "Continue",
      messageIds: [user.id],
      sourceIds: [],
    });
    store.put("draft", {
      ...store.required("draft", draft.id),
      state: "running",
      content: "Partial saved handoff",
      reasoning: "Returned summary",
    });
    const bytes = await backups.backup();
    store.db().exec("DELETE FROM records; DELETE FROM search_index;");
    await backups.restore(bytes);
    const restored = store.required("draft", draft.id);
    expect(restored.state).toBe("failed");
    expect(restored.content).toBe("Partial saved handoff");
    expect(restored.reasoning).toBe("Returned summary");
    expect(store.required("export", restored.exportId!).content).toBe(
      "Partial saved handoff",
    );
    expect(store.all("job")).toHaveLength(0);
    expect(store.required("thread", t.id).modelId).toBe("");
  });
  it("queues drafting before returning and blocks duplicate requests and connection changes", async () => {
    const m = model(),
      t = workspace.createThread();
    const user = message(t.id, "user", "Keep the workflow local.");
    const input = {
      threadId: t.id,
      modelId: m.id,
      kind: "handoff",
      messageIds: [user.id],
      sourceIds: [],
    };
    const response = await request("draft", input);
    expect(response.status).toBe(200);
    const draft = await response.json();
    expect(draft.state).toBe("queued");
    expect(store.all("job").some((j) => j.targetId === draft.id)).toBe(true);
    expect((await request("draft", input)).status).toBe(400);
    expect(
      (
        await request("connection", {
          endpoint: "https://example.openai.azure.com",
          key: "test",
        })
      ).status,
    ).toBe(400);
    await request("drafts/" + draft.id + "/stop", {});
    expect(store.required("draft", draft.id).state).toBe("cancelled");
  });
});
