import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelRoleSettings, SynthesisRoutingSnapshot } from "@/lib/types";

describe("SQLite FTS, duplicate protection, and run transitions", () => {
  let directory = "";
  let repository: typeof import("@/lib/repository");
  let integrity: typeof import("@/lib/integrity");
  let context: typeof import("@/lib/context");
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-db-"));
    process.env.WORKBENCH_DATA_DIR = directory;
    vi.resetModules();
    repository = await import("@/lib/repository");
    integrity = await import("@/lib/integrity");
    context = await import("@/lib/context");
  });
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it("ranks local chunks and deduplicates uploads", () => {
    const project = repository.ensureDefaultProject();
    const thread = repository.createThread(project.id);
    const first = repository.createFile({ projectId: project.id, threadId: thread.id, originalName: "evidence.txt", storedName: "one.txt", mimeType: "text/plain", sizeBytes: 20, sha256: "same-hash" });
    const duplicate = repository.createFile({ projectId: project.id, threadId: thread.id, originalName: "copy.txt", storedName: "two.txt", mimeType: "text/plain", sizeBytes: 20, sha256: "same-hash" });
    expect(first.duplicate).toBe(false); expect(duplicate.duplicate).toBe(true); expect(duplicate.file.id).toBe(first.file.id);
    repository.replaceFileChunks(first.file.id, [
      { content: "Terracotta is the restrained accent color.", section: "Design", tokenEstimate: 10 },
      { content: "SQLite stores canonical local history.", section: "Persistence", tokenEstimate: 9 },
    ]);
    expect(repository.searchFileChunks([first.file.id], "terracotta accent", 12)[0].content).toContain("Terracotta");
    expect(repository.searchFileChunks([first.file.id], "generic question with no matching source terms", 12).map((chunk) => chunk.content)).toEqual([
      "Terracotta is the restrained accent color.",
      "SQLite stores canonical local history.",
    ]);
  });

  it("persists bounded synthesis state transitions", () => {
    const project = repository.ensureDefaultProject(); const thread = repository.createThread(project.id);
    const run = repository.createSynthesisRun({ projectId: project.id, threadId: thread.id, question: "Stress-test this", branchDeployment: "branch", criticDeployment: "critic", synthesisDeployment: "final", maxBranches: 5, refinementRounds: 1, fileIds: ["file_1"] });
    expect(run.status).toBe("queued"); expect(run.maxBranches).toBe(5); expect(run.refinementRounds).toBe(1); expect(run.fileIds).toEqual(["file_1"]);
    repository.updateSynthesisRun(run.id, { status: "running" });
    const step = repository.createRunStep({ runId: run.id, stage: "branch", role: "mapper", deployment: "branch", sequence: 1 });
    repository.updateRunStep(step, { status: "completed", output: "Mapped" });
    repository.updateSynthesisRun(run.id, { status: "cancelled" });
    expect(repository.getSynthesisRun(run.id)?.status).toBe("cancelled");
    expect(repository.listRunSteps(run.id)[0].output).toBe("Mapped");
    expect(repository.getSynthesisRun(run.id)?.routingSnapshot.lanes).toMatchObject({
      mapper: { name: "branch" },
      alternative: { name: "branch" },
      adversary: { name: "branch" },
      evidence: { name: "branch" },
      critic: { name: "critic" },
      refinement: { name: "critic" },
      synthesis: { name: "final" },
    });
  });

  it("persists an immutable per-lane routing snapshot", () => {
    const project = repository.ensureDefaultProject();
    const thread = repository.createThread(project.id);
    const kimi = repository.upsertDeployment({ name: "Kimi-K2.6", modelName: "Kimi-K2.6", protocol: "chat", capabilities: { streaming: true } });
    const flash = repository.upsertDeployment({ name: "DeepSeek-V4-Flash", modelName: "DeepSeek-V4-Flash", protocol: "deepseek", capabilities: { streaming: true, structuredOutput: true } });
    const pro = repository.upsertDeployment({ name: "DeepSeek-V4-Pro", modelName: "DeepSeek-V4-Pro", protocol: "deepseek", capabilities: { streaming: true, reasoning: true } });
    const snapshotFor = (deployment: typeof kimi, requestedDeployment = deployment.name) => ({
      id: deployment.id,
      name: deployment.name,
      modelName: deployment.modelName,
      protocol: deployment.protocol === "auto" ? "responses" as const : deployment.protocol,
      capabilities: { ...deployment.capabilities },
      requestedDeployment,
      adjustmentReason: null,
    });
    const routingSnapshot: SynthesisRoutingSnapshot = {
      version: 1,
      createdAt: "2026-06-24T12:00:00.000Z",
      lanes: {
        mapper: snapshotFor(kimi),
        alternative: snapshotFor(flash),
        adversary: snapshotFor(pro),
        evidence: snapshotFor(kimi),
        critic: snapshotFor(pro),
        refinement: snapshotFor(pro),
        synthesis: snapshotFor(kimi),
      },
    };

    const run = repository.createSynthesisRun({
      projectId: project.id,
      threadId: thread.id,
      question: "Stress-test the routing",
      branchDeployment: flash.name,
      criticDeployment: pro.name,
      synthesisDeployment: kimi.name,
      routingSnapshot,
      maxBranches: 4,
      refinementRounds: 1,
      fileIds: [],
    });
    repository.updateDeploymentCapabilities(kimi.name, { streaming: false, structuredOutput: false }, "responses");

    const persisted = repository.getSynthesisRun(run.id)!;
    expect(persisted.routingSnapshot).toEqual(routingSnapshot);
    expect(persisted.routingSnapshot.lanes.mapper).toMatchObject({ name: kimi.name, protocol: "chat", capabilities: { streaming: true } });
    expect(persisted.routingSnapshot.lanes.alternative.name).toBe(flash.name);
    expect(persisted.routingSnapshot.lanes.adversary.name).toBe(pro.name);
    expect(persisted.routingSnapshot.lanes.synthesis.name).toBe(kimi.name);
  });

  it("preserves probed deployment capabilities and adapter during discovery sync", () => {
    repository.upsertDeployment({
      name: "DeepSeek-V4-Pro",
      modelName: "DeepSeek-V4-Pro",
      protocol: "deepseek",
      capabilities: {
        textGeneration: true,
        streaming: true,
        structuredOutput: false,
        lastProbeLatencyMs: 842,
      },
    });

    const synced = repository.upsertDeployment({
      name: "DeepSeek-V4-Pro",
      modelName: "DeepSeek-V4-Pro",
    });

    expect(synced.protocol).toBe("deepseek");
    expect(synced.capabilities).toMatchObject({
      textGeneration: true,
      streaming: true,
      structuredOutput: false,
      lastProbeLatencyMs: 842,
    });
  });

  it("does not silently re-enable a disabled deployment during discovery sync", async () => {
    const { getSqlite } = await import("@/lib/db");
    repository.upsertDeployment({ name: "gpt-5.5", modelName: "gpt-5.5", protocol: "responses" });
    getSqlite().prepare("UPDATE deployments SET enabled=0 WHERE name=?").run("gpt-5.5");

    const synced = repository.upsertDeployment({ name: "gpt-5.5", modelName: "gpt-5.5" });

    expect(synced.enabled).toBe(false);
    expect(repository.listDeployments().some((item) => item.name === "gpt-5.5")).toBe(false);
  });

  it("rejects role assignments that have not verified required capabilities", async () => {
    repository.upsertDeployment({ name: "DeepSeek-V4-Pro", protocol: "deepseek", capabilities: { textGeneration: true, streaming: true, structuredOutput: false, lastProbeOk: true } });
    repository.upsertDeployment({ name: "DeepSeek-V4-Flash", protocol: "deepseek", capabilities: { textGeneration: true, streaming: true, structuredOutput: true, lastProbeOk: true } });
    repository.upsertDeployment({ name: "Kimi-K2.6", modelName: "Kimi-K2.6", protocol: "chat", capabilities: { textGeneration: true, streaming: true, structuredOutput: true, lastProbeOk: true } });
    const { validateModelRoles } = await import("@/lib/model-routing");
    const roles: ModelRoleSettings = {
      chatDeployment: "DeepSeek-V4-Pro",
      memoryDeployment: "DeepSeek-V4-Flash",
      mapperDeployment: "Kimi-K2.6",
      alternativeDeployment: "DeepSeek-V4-Flash",
      adversarialDeployment: "DeepSeek-V4-Pro",
      evidenceDeployment: "Kimi-K2.6",
      criticDeployment: "DeepSeek-V4-Pro",
      refinementDeployment: "DeepSeek-V4-Pro",
      synthesisDeployment: "Kimi-K2.6",
    };

    expect(validateModelRoles(roles)).toEqual(roles);
    expect(() => validateModelRoles({ ...roles, memoryDeployment: "DeepSeek-V4-Pro" })).toThrow(/structured output/i);
  });

  it("enforces project ownership for conversations and selected files", () => {
    const firstProject = repository.createProject("First");
    const secondProject = repository.createProject("Second");
    const firstThread = repository.createThread(firstProject.id);
    const secondThread = repository.createThread(secondProject.id);
    const firstFile = repository.createFile({
      projectId: firstProject.id,
      threadId: firstThread.id,
      originalName: "first.txt",
      storedName: "first.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      sha256: "first-project-file",
    }).file;

    expect(integrity.assertProjectThread(firstProject.id, firstThread.id).thread.id).toBe(firstThread.id);
    expect(() => integrity.assertProjectThread(firstProject.id, secondThread.id)).toThrow(/not found/i);
    expect(integrity.assertFilesBelongToProject([firstFile.id], firstProject.id)[0]?.id).toBe(firstFile.id);
    expect(() => integrity.assertFilesBelongToProject([firstFile.id], secondProject.id)).toThrow(/do not belong/i);
  });

  it("never assembles file context from another project", () => {
    const firstProject = repository.createProject("Context owner");
    const secondProject = repository.createProject("Context outsider");
    const firstThread = repository.createThread(firstProject.id);
    const foreignThread = repository.createThread(secondProject.id);
    const foreignFile = repository.createFile({
      projectId: secondProject.id,
      threadId: foreignThread.id,
      originalName: "foreign.txt",
      storedName: "foreign.txt",
      mimeType: "text/plain",
      sizeBytes: 24,
      sha256: "foreign-context-file",
    }).file;
    repository.replaceFileChunks(foreignFile.id, [{ content: "PRIVATE FOREIGN CONTEXT", tokenEstimate: 4 }]);
    repository.updateFile(foreignFile.id, { status: "ready" });

    const assembled = context.assembleContext({
      projectId: firstProject.id,
      threadId: firstThread.id,
      fileIds: [foreignFile.id],
      query: "private context",
    });

    expect(assembled.renderedContext).not.toContain("PRIVATE FOREIGN CONTEXT");
    expect(assembled.chunks).toHaveLength(0);
  });

  it("recovers and reclaims an expired running job lease", async () => {
    const job = repository.createJob("extract-file", { fileId: "expired" });
    const { getSqlite } = await import("@/lib/db");
    getSqlite().prepare(`UPDATE jobs SET status='running',lease_owner='dead-worker',lease_expires_at=? WHERE id=?`)
      .run("2020-01-01T00:00:00.000Z", job.id);

    const claimed = repository.claimJob("replacement-worker");

    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.lease_owner).toBe("replacement-worker");
    expect(claimed?.attempts).toBe(1);
  });

  it("allows a conversation model override to be cleared", () => {
    const project = repository.createProject("Override project");
    const thread = repository.createThread(project.id, "Override", "DeepSeek-V4-Pro");
    expect(thread.deploymentId).toBe("DeepSeek-V4-Pro");
    expect(repository.updateThread(thread.id, { deploymentId: null })?.deploymentId).toBeNull();
  });

  it("moves multiple conversations to recoverable trash and restores them", () => {
    const project = repository.createProject("Recoverable trash");
    const first = repository.createThread(project.id, "First");
    const second = repository.createThread(project.id, "Second");
    const retained = repository.createThread(project.id, "Retained");
    repository.saveMessage({ threadId: first.id, role: "user", content: "Still recoverable" });

    expect(repository.setThreadsTrashed([first.id, second.id], project.id, true)).toBe(2);
    expect(repository.listThreads(project.id).map((thread) => thread.id)).toEqual([retained.id]);
    expect(repository.listTrashedThreads(project.id).map((thread) => thread.id).sort()).toEqual([first.id, second.id].sort());
    expect(repository.listMessages(first.id)[0]?.content).toBe("Still recoverable");

    expect(repository.setThreadsTrashed([first.id], project.id, false)).toBe(1);
    expect(repository.listThreads(project.id).some((thread) => thread.id === first.id)).toBe(true);
    expect(repository.listTrashedThreads(project.id).map((thread) => thread.id)).toEqual([second.id]);
  });

  it("deduplicates active synthesis jobs and cancels them with their run", () => {
    const project = repository.createProject("Job coordination");
    const thread = repository.createThread(project.id);
    const run = repository.createSynthesisRun({
      projectId: project.id,
      threadId: thread.id,
      question: "Coordinate this run",
      branchDeployment: "branch",
      criticDeployment: "critic",
      synthesisDeployment: "final",
      maxBranches: 4,
      refinementRounds: 1,
      fileIds: [],
    });
    const first = repository.createSynthesisJob(run.id);
    const duplicate = repository.createSynthesisJob(run.id);

    expect(duplicate.id).toBe(first.id);
    expect(repository.cancelSynthesisJobs(run.id)).toBe(1);
    expect(repository.getJob(String(first.id))?.status).toBe("cancelled");
  });

  it("does not reclaim active leases and only lets the lease owner finish a job", () => {
    const job = repository.createJob("extract-file", { fileId: "active" });
    const jobId = String(job.id);
    const claimed = repository.claimJob("first-worker", 120);
    expect(claimed?.id).toBe(job.id);
    expect(repository.claimJob("second-worker", 120)).toBeNull();
    expect(repository.updateJob(jobId, { status: "completed" }, "second-worker")).toBeNull();
    expect(repository.getJob(jobId)?.status).toBe("running");
    expect(repository.updateJob(jobId, { status: "completed" }, "first-worker")?.status).toBe("completed");
    expect(repository.getJob(jobId)?.lease_owner).toBeNull();
    expect(repository.getJob(jobId)?.lease_expires_at).toBeNull();
  });

  it("recovers a legacy running job with no lease", async () => {
    const job = repository.createJob("extract-file", { fileId: "legacy" });
    const { getSqlite } = await import("@/lib/db");
    getSqlite().prepare("UPDATE jobs SET status='running',lease_owner=NULL,lease_expires_at=NULL WHERE id=?").run(job.id);
    expect(repository.claimJob("recovery-worker")?.id).toBe(job.id);
  });

  it("prevents a client message id from mutating another conversation", () => {
    const project = repository.createProject("Message IDs");
    const firstThread = repository.createThread(project.id);
    const secondThread = repository.createThread(project.id);
    repository.saveMessage({ id: "shared-message-id", threadId: firstThread.id, role: "user", content: "Original" });
    expect(() => repository.saveMessage({ id: "shared-message-id", threadId: secondThread.id, role: "user", content: "Overwrite" })).toThrow(/another conversation/i);
    expect(repository.getMessage("shared-message-id")?.content).toBe("Original");
  });

  it("supports insert-only user turns without changing the existing timeline", () => {
    const project = repository.createProject("Immutable submitted turns");
    const thread = repository.createThread(project.id);
    repository.saveMessage({ id: "immutable-user", threadId: thread.id, role: "user", content: "Original" });
    repository.saveMessage({ id: "immutable-answer", threadId: thread.id, role: "assistant", content: "Answer" });

    expect(() => repository.saveMessage(
      { id: "immutable-user", threadId: thread.id, role: "user", content: "Forged rewrite" },
      { overwriteExisting: false },
    )).toThrow(/already present/i);
    expect(repository.listMessages(thread.id).map((message) => message.content)).toEqual(["Original", "Answer"]);
  });

  it("regenerates from an unchanged stored user turn and removes only the later timeline", () => {
    const project = repository.createProject("Authoritative regeneration");
    const thread = repository.createThread(project.id);
    const user = repository.saveMessage({
      id: "regenerate-user",
      threadId: thread.id,
      role: "user",
      content: "Original prompt",
      attachments: [{ fileId: "stored-file", originalName: "source.png", mimeType: "image/png", sizeBytes: 12, mode: "direct" }],
    });
    repository.saveMessage({ id: "regenerate-answer", threadId: thread.id, role: "assistant", content: "Old answer" });
    repository.saveMessage({ id: "regenerate-follow-up", threadId: thread.id, role: "user", content: "Later prompt" });

    const anchor = repository.truncateConversationAfterUserMessage({ threadId: thread.id, messageId: user.id });

    expect(anchor).toMatchObject({ content: "Original prompt", attachments: user.attachments });
    expect(repository.listMessages(thread.id)).toEqual([anchor]);
  });

  it("invalidates stale probe evidence when a deployment model or protocol changes", () => {
    const original = repository.upsertDeployment({
      name: "repointed-slot",
      modelName: "gpt-5.6-sol",
      protocol: "responses",
      capabilities: { imageInput: true, vision: true, streaming: true, lastProbeOk: true, adapter: "responses" },
    });

    const repointed = repository.upsertDeployment({ name: original.name, modelName: "text-only-v2" });
    expect(repointed.capabilities).toMatchObject({ declaredVisualInput: false, probeRequired: true });
    expect(repointed.capabilities).not.toHaveProperty("imageInput");
    expect(repointed.capabilities).not.toHaveProperty("vision");
    expect(repointed.capabilities).not.toHaveProperty("lastProbeOk");

    const restored = repository.updateDeployment(repointed.id, { modelName: "gpt-5.6-sol", protocol: "responses" })!;
    expect(restored.capabilities).toMatchObject({ declaredVisualInput: true, probeRequired: true });
    expect(restored.capabilities).not.toHaveProperty("imageInput");
  });

  it("retains the effective saved model identity when discovery omits a model name", () => {
    repository.upsertDeployment({ name: "gpt-5.6-sol-slot", modelName: "text-only-v2", protocol: "responses" });
    const textOnly = repository.upsertDeployment({ name: "gpt-5.6-sol-slot", modelName: undefined });
    expect(textOnly.modelName).toBe("text-only-v2");
    expect(textOnly.capabilities.declaredVisualInput).toBe(false);

    repository.upsertDeployment({ name: "neutral-visual-slot", modelName: "gpt-5.6-sol", protocol: "responses" });
    const visual = repository.upsertDeployment({ name: "neutral-visual-slot", modelName: undefined });
    expect(visual.modelName).toBe("gpt-5.6-sol");
    expect(visual.capabilities.declaredVisualInput).toBe(true);
  });

  it("clears old adapter evidence when a probe selects a different protocol", () => {
    repository.upsertDeployment({
      name: "probe-protocol-shift",
      modelName: "gpt-5.6-sol",
      protocol: "chat",
      capabilities: { imageInput: false, vision: false, cacheObserved: true, lastProbeOk: false },
    });
    const updated = repository.updateDeploymentCapabilities("probe-protocol-shift", {
      textGeneration: true,
      streaming: true,
      imageInput: true,
      vision: true,
      lastProbeOk: true,
      adapter: "responses",
      probeRequired: false,
    }, "responses")!;

    expect(updated.protocol).toBe("responses");
    expect(updated.capabilities).toMatchObject({ imageInput: true, vision: true, lastProbeOk: true, declaredVisualInput: true });
    expect(updated.capabilities).not.toHaveProperty("cacheObserved");
  });

  it("creates immutable conversation branches and retains copied generation receipts", async () => {
    const project = repository.createProject("Conversation branches");
    const source = repository.createThread(project.id, "Pricing decision", "claude-sonnet-5");
    const first = repository.saveMessage({ id: "branch-question-1", threadId: source.id, role: "user", content: "Compare the options" });
    const answer = repository.saveMessage({ id: "branch-answer-1", threadId: source.id, role: "assistant", content: "Option A is safer" });
    const second = repository.saveMessage({ id: "branch-question-2", threadId: source.id, role: "user", content: "What about cost?" });
    const { getSqlite } = await import("@/lib/db");
    getSqlite().prepare(`INSERT INTO generations
      (id,message_id,thread_id,deployment_id,status,stage,settings_json,cache_read_tokens,thinking_tokens,duration_ms,provider_metadata_json,output_text,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "branch-generation", answer.id, source.id, "claude-sonnet-5", "complete", "response", JSON.stringify({ reasoningEffort: "medium" }),
        1_900, 420, 2_800, "{}", answer.content, "2026-08-21T08:00:00.000Z", "2026-08-21T08:00:02.800Z",
      );
    getSqlite().prepare(`INSERT INTO generations
      (id,message_id,thread_id,deployment_id,status,stage,settings_json,provider_metadata_json,output_text,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        "branch-preparation", null, source.id, "DeepSeek-V4-Flash", "complete", "attachment-preparation", JSON.stringify({ parentGenerationId: "branch-generation", fileName: "costs.json" }),
        "{}", "Prepared costs", "2026-08-21T07:59:58.000Z", "2026-08-21T08:00:00.000Z",
      );

    const branch = repository.branchThread({ sourceThreadId: source.id, throughMessageId: answer.id });
    expect(branch.parentThreadId).toBe(source.id);
    expect(branch.branchFromMessageId).toBe(answer.id);
    expect(repository.listMessages(source.id).map((message) => message.id)).toEqual([first.id, answer.id, second.id]);
    expect(repository.listMessages(branch.id).map((message) => message.content)).toEqual([first.content, answer.content]);
    const copiedGenerations = repository.listGenerations(branch.id);
    const copiedResponse = copiedGenerations.find((generation) => generation.stage === "response")!;
    const copiedPreparation = copiedGenerations.find((generation) => generation.stage === "attachment-preparation")!;
    expect(copiedResponse.cacheReadTokens).toBe(1_900);
    expect(copiedResponse.thinkingTokens).toBe(420);
    expect(copiedPreparation.settings.parentGenerationId).toBe(copiedResponse.id);

    const editBranch = repository.branchThread({ sourceThreadId: source.id, throughMessageId: second.id, includeMessage: false });
    expect(repository.listMessages(editBranch.id).map((message) => message.content)).toEqual([first.content, answer.content]);
    expect(repository.getMessage(second.id)?.content).toBe("What about cost?");
  });

  it("edits a user turn in place and removes only the later timeline", async () => {
    const project = repository.createProject("Editable conversation");
    const thread = repository.createThread(project.id, "Plan review");
    const first = repository.saveMessage({ id: "edit-question-1", threadId: thread.id, role: "user", content: "Compare the plans" });
    const firstAnswer = repository.saveMessage({ id: "edit-answer-1", threadId: thread.id, role: "assistant", content: "Plan A is safer" });
    repository.saveMessage({ id: "edit-question-2", threadId: thread.id, role: "user", content: "What about price?" });
    repository.saveMessage({ id: "edit-answer-2", threadId: thread.id, role: "assistant", content: "Plan B is cheaper" });
    const { getSqlite } = await import("@/lib/db");
    getSqlite().prepare(`INSERT INTO context_receipts
      (id,thread_id,memory_ids_json,file_chunk_ids_json,estimated_tokens,rendered_context,created_at)
      VALUES (?,?,?,?,?,?,?)`).run("edit-receipt", thread.id, "[]", "[]", 12, "stale context", firstAnswer.createdAt);
    getSqlite().prepare(`INSERT INTO generations
      (id,message_id,thread_id,deployment_id,status,stage,settings_json,provider_metadata_json,output_text,context_receipt_id,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "edit-generation", firstAnswer.id, thread.id, "claude-sonnet-5", "complete", "response", "{}", "{}", firstAnswer.content,
        "edit-receipt", firstAnswer.createdAt, firstAnswer.createdAt,
      );

    const edited = repository.editUserMessageAndTruncate({
      threadId: thread.id,
      messageId: first.id,
      content: "Compare total cost and risk",
      attachments: [],
    });

    expect(edited.id).toBe(first.id);
    expect(repository.listMessages(thread.id).map((message) => message.content)).toEqual(["Compare total cost and risk"]);
    expect(repository.listGenerations(thread.id)).toHaveLength(0);
    expect(repository.getLatestReceipt(thread.id)).toBeUndefined();
    expect(repository.listThreads(project.id)).toHaveLength(1);
  });

  it("persists the exact attachments on the user message", () => {
    const project = repository.createProject("Message attachments");
    const thread = repository.createThread(project.id);
    const attachments = [{
      fileId: "file-json",
      originalName: "azure-cost-analysis.json",
      mimeType: "application/json",
      sizeBytes: 354_489,
      mode: "prepare-text" as const,
      preparationDeployment: "DeepSeek-V4-Flash",
    }];
    const message = repository.saveMessage({ id: "message-with-file", threadId: thread.id, role: "user", content: "Analyze this", attachments });
    expect(message.attachments).toEqual(attachments);
    expect(repository.listMessages(thread.id)[0].attachments).toEqual(attachments);

    repository.saveMessage({ id: message.id, threadId: thread.id, role: "user", content: "Analyze this carefully" });
    expect(repository.getMessage(message.id)?.attachments).toEqual(attachments);
  });

  it("conservatively backfills attachments from an old generation receipt", async () => {
    const project = repository.createProject("Historical attachments");
    const thread = repository.createThread(project.id);
    const file = repository.createFile({
      projectId: project.id,
      threadId: thread.id,
      originalName: "historical.json",
      storedName: "historical.json",
      mimeType: "application/json",
      sizeBytes: 1_300,
      sha256: "historical-attachment-hash",
    }).file;
    const message = repository.saveMessage({ id: "historical-question", threadId: thread.id, role: "user", content: "Can you see it?" });
    const { getSqlite, migrate } = await import("@/lib/db");
    getSqlite().prepare(`INSERT INTO generations (id,thread_id,deployment_id,status,stage,settings_json,started_at)
      VALUES (?,?,?,?,?,?,?)`).run("historical-generation", thread.id, "claude-sonnet-5", "complete", "response", JSON.stringify({ attachments: [{ fileId: file.id, mode: "direct" }] }), "9999-01-01T00:00:00.000Z");

    migrate(getSqlite());
    expect(repository.getMessage(message.id)?.attachments).toEqual([{
      fileId: file.id,
      originalName: "historical.json",
      mimeType: "application/json",
      sizeBytes: 1_300,
      mode: "direct",
    }]);
  });

  it("persists inspectable preparation packet text", async () => {
    const project = repository.createProject("Inspectable preparation");
    const thread = repository.createThread(project.id);
    const { getSqlite } = await import("@/lib/db");
    getSqlite().prepare(`INSERT INTO generations (id,thread_id,deployment_id,status,stage,settings_json,output_text,started_at)
      VALUES (?,?,?,?,?,?,?,?)`).run("packet-generation", thread.id, "DeepSeek-V4-Flash", "complete", "attachment-preparation", "{}", "## Current state\nThe decision is still open.", "2026-08-20T12:00:00.000Z");
    expect(repository.listGenerations(thread.id)[0].outputText).toContain("decision is still open");
  });

  it("accepts a memory candidate only once", () => {
    const project = repository.createProject("Memory transitions");
    const thread = repository.createThread(project.id);
    repository.replaceMemoryCandidates(project.id, thread.id, [{
      type: "decision",
      title: "Chosen path",
      content: "Use the bounded workflow.",
      scope: "project",
      sensitivity: "normal",
      confidence: 1,
      explicit: true,
      evidence: [],
    }]);
    const candidate = repository.listMemoryCandidates(project.id, thread.id)[0];
    expect(repository.acceptMemoryCandidate(candidate.id)).not.toBeNull();
    expect(() => repository.acceptMemoryCandidate(candidate.id)).toThrow(/no longer pending/i);
    expect(repository.rejectMemoryCandidate(candidate.id)).toBe(false);
  });
});
