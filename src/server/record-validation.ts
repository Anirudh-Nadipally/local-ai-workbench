import { z } from "zod";
import { effortValues } from "@/domain/reasoning";
const id = z.string().min(1).max(160),
  text = z.string().max(2_000_000),
  date = z
    .string()
    .max(80)
    .refine((v) => Number.isFinite(Date.parse(v)), "Invalid date");
const base = z.object({ id, createdAt: date, updatedAt: date });
const selection = z.object({
  id,
  mode: z.enum(["full", "excerpts", "original"]),
});
const activity = {
  reasoning: text.optional(),
  reasoningTokens: z.number().min(0).optional(),
  startedAt: date.optional(),
  finishedAt: date.optional(),
  phase: z.enum(["waiting", "reasoning", "writing"]).optional(),
  effort: z.enum(effortValues).optional(),
};
const model = base.extend({
  name: z.string().min(1).max(200),
  protocol: z.enum(["responses", "chat", "deepseek", "anthropic"]),
  image: z.boolean(),
  pdf: z.boolean(),
  verifiedAt: date.nullable(),
  contextTokens: z.number().min(16000).max(2000000),
  reasoning: z
    .object({
      mode: z.enum(["openai", "adaptive", "budget"]),
      efforts: z
        .array(
          z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
        )
        .max(7),
      summary: z.boolean(),
    })
    .optional(),
});
const manifest = z.object({
  id,
  name: z.string().min(1).max(300),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  storedName: z.string().regex(/^[a-zA-Z0-9._-]+$/),
});
export const recordSchemas = {
  project: base.extend({
    name: z.string().min(1).max(200),
    objective: z.string().max(5000),
    briefId: id.nullable(),
  }),
  brief: base.extend({
    projectId: id,
    content: text,
    previousId: id.nullable(),
    evidence: z.array(id).max(1000),
    status: z.enum(["draft", "accepted", "dismissed"]),
  }),
  thread: base.extend({
    title: z.string().max(500),
    projectId: id.nullable(),
    modelId: z.string().max(160),
    sourceIds: z.array(selection).max(100),
    includeBrief: z.boolean(),
    parentId: id.nullable(),
    deletedAt: date.nullable(),
    draft: text,
    temporary: z.boolean().optional(),
    expiresAt: date.optional(),
    effort: z.enum(effortValues).optional(),
  }),
  message: base.extend({
    threadId: id,
    role: z.enum(["user", "assistant", "system"]),
    content: text,
    status: z.enum(["complete", "queued", "streaming", "cancelled", "failed"]),
    sourceIds: z.array(id).max(100),
    generationId: id.optional(),
  }),
  source: base.extend({
    projectId: id.nullable(),
    threadId: id.nullable(),
    name: z.string().min(1).max(300),
    mime: z.string().max(200),
    size: z
      .number()
      .int()
      .min(1)
      .max(100 * 1024 * 1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    storedName: z.string().regex(/^[a-zA-Z0-9._-]+$/),
    status: z.enum(["queued", "processing", "ready", "failed"]),
    error: z.string().max(10000),
    text: z.string().max(100 * 1024 * 1024),
    sections: z
      .array(
        z.object({
          text: z.string().max(100 * 1024 * 1024),
          page: z.number().nullable().optional(),
          section: z.string().max(10000).nullable().optional(),
        }),
      )
      .max(30000),
  }),
  snapshot: base.extend({
    threadId: id,
    briefId: id.nullable(),
    system: text,
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: text }))
      .max(10000),
    sources: z
      .array(
        manifest.extend({
          mode: z.enum(["full", "excerpts", "original"]),
          coverage: z.string().max(500),
          mime: z.string().max(200),
        }),
      )
      .max(100),
    estimatedTokens: z.number().min(0),
    model,
    userText: text.optional(),
    effort: z.enum(effortValues).optional(),
  }),
  generation: base.extend({
    ...activity,
    threadId: id,
    messageId: id,
    snapshotId: id,
    modelName: z.string().max(200).optional(),
    state: z.enum(["queued", "running", "complete", "failed", "cancelled"]),
    error: z.string().max(10000),
    cancelRequested: z.boolean(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
  }),
  output: base.extend({
    projectId: id.nullable(),
    threadId: id,
    title: z.string().max(500),
    content: text,
    evidence: z.array(id).max(1000),
    previousId: id.nullable(),
  }),
  export: base.extend({
    revision: z.number().int().min(0).optional(),
    threadId: id,
    title: z.string().max(500),
    intent: z.enum(["continue", "share", "transcript"]),
    nextTask: z.string().max(5000),
    content: text,
    messageIds: z.array(id).max(10000),
    sourceIds: z.array(id).max(100),
    manifest: z.array(manifest).max(100),
    briefId: id.nullable(),
  }),
  draft: base.extend({
    ...activity,
    threadId: id,
    projectId: id.nullable(),
    kind: z.enum(["brief", "handoff"]),
    state: z.enum(["queued", "running", "complete", "failed", "cancelled"]),
    content: text,
    error: z.string().max(10000),
    cancelRequested: z.boolean(),
    model,
    system: text,
    prompt: text,
    evidence: z.array(id).max(500),
    sourceIds: z.array(id).max(10),
    previousBriefId: id.nullable(),
    exportId: id.nullable(),
    proposalId: id.nullable(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
  }),
  migration: base.extend({ legacyId: id, targetId: id }),
};
export function validateRecords(input: Record<string, unknown[]>) {
  const records: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    Object.entries(input).map(([kind, items]) => {
      const schema = recordSchemas[kind as keyof typeof recordSchemas];
      if (!schema) throw new Error("Unknown backup record type.");
      return [kind, items.map((item) => schema.parse(item))];
    }),
  );
  const ids = new Map<string, Set<string>>();
  for (const [kind, items] of Object.entries(records)) {
    const values = new Set(items.map((item) => String(item.id)));
    if (values.size !== items.length)
      throw new Error("Duplicate backup record.");
    ids.set(kind, values);
  }
  function ref(kind: string, id: unknown) {
    if (id != null && !ids.get(kind)?.has(String(id)))
      throw new Error("Backup contains a broken " + kind + " reference.");
  }
  for (const [kind, items] of Object.entries(records))
    for (const item of items) {
      if ("projectId" in item) ref("project", item.projectId);
      if ("threadId" in item) ref("thread", item.threadId);
      if ("briefId" in item) ref("brief", item.briefId);
      if (kind === "draft") {
        ref("export", item.exportId);
        ref("brief", item.proposalId);
        ref("brief", item.previousBriefId);
        for (const value of item.evidence as string[]) ref("message", value);
        for (const value of item.sourceIds as string[]) ref("source", value);
      }
      if (kind === "generation") {
        ref("message", item.messageId);
        ref("snapshot", item.snapshotId);
      }
      if (kind === "project") ref("brief", item.briefId);
      if (kind === "thread") {
        ref("thread", item.parentId);
        for (const source of item.sourceIds as { id: string }[])
          ref("source", source.id);
      }
      if (kind === "brief") {
        ref("brief", item.previousId);
        for (const source of item.evidence as string[]) ref("message", source);
      }
      if (kind === "output") {
        ref("output", item.previousId);
        for (const source of item.evidence as string[]) ref("message", source);
      }
      if (kind === "message") {
        for (const source of item.sourceIds as string[]) ref("source", source);
      }
      if (kind === "export") {
        for (const source of item.sourceIds as string[]) ref("source", source);
        for (const message of item.messageIds as string[])
          ref("message", message);
      }
    }
  return records;
}
