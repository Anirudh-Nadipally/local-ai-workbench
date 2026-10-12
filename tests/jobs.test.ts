import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
const provider = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../src/server/connections", () => ({
  modelFor: () => provider.current,
  redact: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
let store: typeof import("../src/server/db"),
  workspace: typeof import("../src/server/workspace"),
  jobs: typeof import("../src/server/jobs");
beforeAll(async () => {
  process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-jobs-"),
  );
  store = await import("../src/server/db");
  workspace = await import("../src/server/workspace");
  jobs = await import("../src/server/jobs");
});
beforeEach(() => {
  store.db().exec("DELETE FROM records; DELETE FROM search_index;");
});
function queue() {
  const m = store.put("model", {
    ...store.base(),
    name: "mock",
    protocol: "responses",
    image: false,
    pdf: false,
    verifiedAt: new Date().toISOString(),
    contextTokens: 128000,
  });
  const thread = workspace.createThread();
  const generation = workspace.startGeneration(
    thread.id,
    "Read selected context.",
    m.id,
    [],
    true,
  );
  return { thread, generation, model: m, job: store.all("job")[0] };
}
function mock(chunks: LanguageModelV3StreamPart[], delay = 1) {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks,
        initialDelayInMs: 0,
        chunkDelayInMs: delay,
      }),
    }),
  });
  provider.current = model;
  return model;
}
const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 2, text: 2, reasoning: undefined },
  },
};
describe("durable worker responses", () => {
  it("saves incremental text, final status, and usage", async () => {
    const { generation, job } = queue();
    const model = mock([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Useful " },
      { type: "text-delta", id: "t", delta: "answer." },
      { type: "text-end", id: "t" },
      finish,
    ]);
    await jobs.processJob(job);
    expect(store.required("message", generation.messageId).content).toBe(
      "Useful answer.",
    );
    expect(store.required("generation", generation.id).state).toBe("complete");
    expect(store.required("generation", generation.id).outputTokens).toBe(2);
    expect(model.doStreamCalls[0].prompt.at(-1)?.role).toBe("user");
  });
  it("retains partial text on provider failure", async () => {
    const { generation, job } = queue();
    mock([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Partial result" },
      { type: "error", error: new Error("Network interrupted") },
    ]);
    await jobs.processJob(job);
    expect(store.required("message", generation.messageId).content).toBe(
      "Partial result",
    );
    expect(store.required("message", generation.messageId).status).toBe(
      "failed",
    );
    expect(store.required("generation", generation.id).error).toContain(
      "Network interrupted",
    );
  });
  it("cancels queued work without calling a provider", async () => {
    const { generation, job } = queue();
    const model = mock([]);
    store.put("generation", { ...generation, cancelRequested: true });
    await jobs.processJob(job);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(store.required("generation", generation.id).state).toBe("cancelled");
  });
  it("stops active generation and preserves output already received", async () => {
    const { generation, job } = queue();
    mock(
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Saved before stop" },
        ...Array.from(
          { length: 10 },
          () => ({ type: "text-delta", id: "t", delta: "." }) as const,
        ),
        { type: "text-end", id: "t" },
        finish,
      ],
      80,
    );
    const run = jobs.processJob(job);
    await new Promise((r) => setTimeout(r, 260));
    store.put("generation", {
      ...store.required("generation", generation.id),
      cancelRequested: true,
    });
    await run;
    expect(store.required("generation", generation.id).state).toBe("cancelled");
    expect(store.required("message", generation.messageId).content).toContain(
      "Saved before stop",
    );
  });
  it("marks interrupted generation recoverable without replaying paid requests", () => {
    const { generation, job } = queue();
    store.put("job", {
      ...job,
      state: "running",
      owner: "old",
      leaseUntil: Date.now() - 100,
    });
    store.put("generation", { ...generation, state: "running" });
    store.put("message", {
      ...store.required("message", generation.messageId),
      content: "Durable partial",
      status: "streaming",
    });
    expect(jobs.claimJob("new-worker")).toBeNull();
    expect(store.required("generation", generation.id).state).toBe("failed");
    expect(store.required("message", generation.messageId).content).toBe(
      "Durable partial",
    );
  });
  it("requeues interrupted extraction safely", () => {
    const task = store.put("job", {
      ...store.base(),
      task: "extract",
      targetId: "source",
      state: "running",
      owner: "old",
      leaseUntil: Date.now() - 100,
      error: "",
    });
    const claimed = jobs.claimJob("new-worker");
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.owner).toBe("new-worker");
  });
});

describe("durable drafts", () => {
  async function queueDraft(kind: "brief" | "handoff" = "handoff") {
    const { thread, model, generation } = queue();
    store.put("generation", { ...generation, state: "complete" });
    store.put("message", {
      ...store.required("message", generation.messageId),
      status: "complete",
      content: "A proposal, not a decision.",
    });
    if (kind === "brief") {
      const project = store.put("project", {
        ...store.base(),
        name: "Test project",
        objective: "Build a useful app",
        briefId: null,
      });
      store.put("thread", { ...thread, projectId: project.id });
    }
    const drafts = await import("../src/server/drafts");
    const input = {
      threadId: thread.id,
      modelId: model.id,
      kind,
      messageIds: store.threadMessages(thread.id).map((m) => m.id),
      sourceIds: [],
      nextTask: "Challenge the proposed approach",
    };
    const draft = drafts.startDraft(input);
    const job = store.all("job").find((j) => j.targetId === draft.id)!;
    return { draft, job, drafts, input };
  }
  it("freezes context and saves a portable handoff independently of the requesting view", async () => {
    const { draft, job, drafts, input } = await queueDraft();
    expect(() => drafts.startDraft(input)).toThrow("already running");
    const saved = store.required("draft", draft.id);
    expect(saved.prompt).not.toContain(input.messageIds[0]);
    expect(saved.system).not.toContain("1200");
    store.put("message", {
      ...store.required("message", input.messageIds[0]),
      content: "Changed after queueing",
    });
    const model = mock([
      { type: "reasoning-start", id: "r" },
      {
        type: "reasoning-delta",
        id: "r",
        delta: "Checking the supplied constraints.",
      },
      { type: "reasoning-end", id: "r" },
      { type: "text-start", id: "t" },
      {
        type: "text-delta",
        id: "t",
        delta:
          "# Continue the project\n\nChallenge the proposed approach. Preserve the user's constraints.",
      },
      { type: "text-end", id: "t" },
      finish,
    ]);
    await jobs.processJob(job);
    const result = drafts.draftSummaries(input.threadId)[0];
    expect(result.state).toBe("complete");
    expect(result.reasoning).toContain("Checking");
    expect(result.finishedAt).toBeTruthy();
    expect(result).not.toHaveProperty("prompt");
    expect(store.required("export", result.exportId!).content).toBe(
      result.content,
    );
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(
      "Changed after queueing",
    );
    const exported = await import("../src/server/exports");
    expect(
      exported.exportDocument(store.required("export", result.exportId!)),
    ).not.toContain(result.exportId);
  });
  it("saves a brief as an unapproved proposal even without an open editor", async () => {
    const { draft, job } = await queueDraft("brief");
    mock([
      { type: "text-start", id: "t" },
      {
        type: "text-delta",
        id: "t",
        delta: "## Objective\nBuild a useful app.",
      },
      { type: "text-end", id: "t" },
      finish,
    ]);
    await jobs.processJob(job);
    const result = store.required("draft", draft.id);
    expect(store.required("brief", result.proposalId!).status).toBe("draft");
    expect(store.required("project", result.projectId!).briefId).toBeNull();
  });
  it("retains failed and cancelled partial drafts and does not replay them", async () => {
    const { draft, job } = await queueDraft();
    mock([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Partial portable context" },
      { type: "error", error: new Error("Provider disconnected") },
    ]);
    await jobs.processJob(job);
    expect(store.required("draft", draft.id).state).toBe("failed");
    expect(store.required("export", draft.exportId!).content).toBe(
      "Partial portable context",
    );
  });
  it("stops a running draft and keeps text already streamed", async () => {
    const { draft, job, drafts } = await queueDraft();
    mock(
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Keep this partial" },
        ...Array.from(
          { length: 12 },
          () => ({ type: "text-delta", id: "t", delta: "." }) as const,
        ),
        { type: "text-end", id: "t" },
        finish,
      ],
      60,
    );
    const work = jobs.processJob(job);
    await new Promise((resolve) => setTimeout(resolve, 220));
    drafts.stopDraft(draft.id);
    await work;
    expect(store.required("draft", draft.id).state).toBe("cancelled");
    expect(store.required("export", draft.exportId!).content).toContain(
      "Keep this partial",
    );
  });
  it("does not let an expired worker overwrite recovered work", async () => {
    const { draft, job } = await queueDraft();
    const owned = store.put("job", {
      ...job,
      state: "running",
      owner: "first",
      leaseUntil: Date.now() + 10000,
    });
    mock(
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "First fragment" },
        ...Array.from(
          { length: 12 },
          () => ({ type: "text-delta", id: "t", delta: "." }) as const,
        ),
        { type: "text-end", id: "t" },
        finish,
      ],
      60,
    );
    const work = jobs.processJob(owned);
    await new Promise((resolve) => setTimeout(resolve, 220));
    store.put("job", {
      ...store.required("job", job.id),
      leaseUntil: Date.now() - 1,
    });
    jobs.claimJob("replacement");
    const recovered = store.required("draft", draft.id);
    await work;
    expect(store.required("draft", draft.id)).toEqual(recovered);
    expect(recovered.state).toBe("failed");
  });
  it("stops queued drafts without a provider call", async () => {
    const { draft, job, drafts } = await queueDraft();
    const model = mock([]);
    drafts.stopDraft(draft.id);
    await jobs.processJob(job);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(store.required("draft", draft.id).state).toBe("cancelled");
  });
  it("recovers an expired draft lease and preserves output without another call", async () => {
    const { draft, job } = await queueDraft();
    store.put("draft", {
      ...store.required("draft", draft.id),
      state: "running",
      content: "Saved before restart",
    });
    store.put("job", {
      ...job,
      state: "running",
      owner: "old-worker",
      leaseUntil: Date.now() - 10,
    });
    jobs.claimJob("new-worker");
    expect(store.required("draft", draft.id).state).toBe("failed");
    expect(store.required("export", draft.exportId!).content).toBe(
      "Saved before restart",
    );
  });
  it("rejects stale editor writes and edits during generation", async () => {
    const { draft, drafts } = await queueDraft();
    expect(() =>
      drafts.updateExport(draft.exportId!, "Unsafe edit", 0),
    ).toThrow("Wait for drafting");
    drafts.stopDraft(draft.id);
    const updated = drafts.updateExport(draft.exportId!, "Reviewed handoff", 0);
    expect(updated.content).toBe("Reviewed handoff");
    expect(() => drafts.updateExport(draft.exportId!, "Stale edit", 0)).toThrow(
      "another window",
    );
    expect(store.required("export", draft.exportId!).content).toBe(
      "Reviewed handoff",
    );
  });
  it("cannot accept selected messages from another conversation", async () => {
    const { drafts, input } = await queueDraft();
    drafts.stopDraft(store.all("draft")[0].id);
    expect(() =>
      drafts.startDraft({ ...input, messageIds: ["not-in-this-conversation"] }),
    ).toThrow("missing message");
  });
});

describe("reasoning controls", () => {
  it("sends configured provider options and records returned reasoning", async () => {
    const { generation, job } = queue();
    const snapshot = store.required("snapshot", generation.snapshotId);
    store.put("snapshot", {
      ...snapshot,
      model: {
        ...snapshot.model,
        reasoning: { mode: "openai", efforts: ["high"], summary: true },
      },
    });
    store.put("generation", { ...generation, effort: "high" });
    const model = mock([
      { type: "reasoning-start", id: "r" },
      { type: "reasoning-delta", id: "r", delta: "A returned summary" },
      { type: "reasoning-end", id: "r" },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Answer" },
      { type: "text-end", id: "t" },
      finish,
    ]);
    await jobs.processJob(job);
    expect(model.doStreamCalls[0].providerOptions).toEqual({
      openai: { reasoningEffort: "high", reasoningSummary: "auto" },
    });
    expect(store.required("generation", generation.id).reasoning).toBe(
      "A returned summary",
    );
  });
  it("maps adaptive thinking and preserves provider defaults", async () => {
    const { reasoningOptions } = await import("../src/domain/reasoning");
    const { model } = queue();
    const anthropic = {
      ...model,
      protocol: "anthropic" as const,
      reasoning: {
        mode: "adaptive" as const,
        efforts: ["high" as const],
        summary: true,
      },
    };
    expect(reasoningOptions(anthropic)).toBeUndefined();
    expect(reasoningOptions(anthropic, "high")).toEqual({
      anthropic: {
        effort: "high",
        thinking: { type: "adaptive", display: "summarized" },
      },
    });
    expect(() => reasoningOptions(anthropic, "max")).toThrow("not configured");
    expect(() =>
      reasoningOptions({ ...anthropic, protocol: "responses" }, "high"),
    ).toThrow("Anthropic protocol");
  });
});

describe("temporary generation cleanup", () => {
  it("disables provider storage and prevents a late response from restoring an ended chat", async () => {
    const { thread, generation, job } = queue();
    const temporary = await import("../src/server/temporary");
    store.put("thread", {
      ...thread,
      temporary: true,
      expiresAt: temporary.temporaryExpiry(),
      includeBrief: false,
    });
    const model = mock(
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Temporary output" },
        ...Array.from(
          { length: 12 },
          () => ({ type: "text-delta", id: "t", delta: "." }) as const,
        ),
        { type: "text-end", id: "t" },
        finish,
      ],
      60,
    );
    const run = jobs.processJob(job);
    await new Promise((resolve) => setTimeout(resolve, 220));
    temporary.deleteTemporaryChat(thread.id);
    await run;
    expect(model.doStreamCalls[0].providerOptions).toEqual({
      openai: { store: false },
    });
    expect(store.get("thread", thread.id)).toBeNull();
    expect(store.get("generation", generation.id)).toBeNull();
    expect(store.get("message", generation.messageId)).toBeNull();
    expect(store.get("snapshot", generation.snapshotId)).toBeNull();
    expect(store.get("job", job.id)).toBeNull();
  });
});
