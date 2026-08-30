import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  ...timestamps,
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentThreadId: text("parent_thread_id"),
  branchFromMessageId: text("branch_from_message_id"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  deploymentId: text("deployment_id"),
  deletedAt: text("deleted_at"),
  ...timestamps,
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("complete"),
  attachmentsJson: text("attachments_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  messageId: text("message_id"),
  threadId: text("thread_id").notNull(),
  deploymentId: text("deployment_id").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull().default("response"),
  settingsJson: text("settings_json").notNull().default("{}"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  uncachedInputTokens: integer("uncached_input_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  thinkingTokens: integer("thinking_tokens"),
  cacheStatus: text("cache_status"),
  durationMs: integer("duration_ms"),
  finishReason: text("finish_reason"),
  error: text("error"),
  providerMetadataJson: text("provider_metadata_json").notNull().default("{}"),
  outputText: text("output_text").notNull().default(""),
  contextReceiptId: text("context_receipt_id"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  modelName: text("model_name"),
  protocol: text("protocol").notNull().default("responses"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("deployments_name_unique").on(table.name)]);

export const fileAssets = sqliteTable("files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  summary: text("summary").notNull().default(""),
  sha256: text("sha256").notNull(),
  ...timestamps,
});

export const fileChunks = sqliteTable("file_chunks", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => fileAssets.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  page: integer("page"),
  section: text("section"),
  tokenEstimate: integer("token_estimate").notNull(),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  sensitivity: text("sensitivity").notNull(),
  confidence: real("confidence").notNull(),
  explicit: integer("explicit", { mode: "boolean" }).notNull(),
  evidenceJson: text("evidence_json").notNull(),
  supersedesId: text("supersedes_id"),
  ...timestamps,
});

export const memoryCandidates = sqliteTable("memory_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  sensitivity: text("sensitivity").notNull(),
  confidence: real("confidence").notNull(),
  explicit: integer("explicit", { mode: "boolean" }).notNull(),
  evidenceJson: text("evidence_json").notNull(),
  ...timestamps,
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull(),
  progress: real("progress").notNull().default(0),
  message: text("message").notNull().default(""),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  error: text("error"),
  ...timestamps,
});

export const synthesisRuns = sqliteTable("synthesis_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  threadId: text("thread_id").notNull(),
  question: text("question").notNull(),
  status: text("status").notNull(),
  branchDeployment: text("branch_deployment").notNull(),
  criticDeployment: text("critic_deployment").notNull(),
  synthesisDeployment: text("synthesis_deployment").notNull(),
  routingSnapshotJson: text("routing_snapshot_json").notNull().default("{}"),
  maxBranches: integer("max_branches").notNull(),
  refinementRounds: integer("refinement_rounds").notNull(),
  fileIdsJson: text("file_ids_json").notNull().default("[]"),
  output: text("output").notNull().default(""),
  error: text("error"),
  ...timestamps,
});

export const runSteps = sqliteTable("run_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => synthesisRuns.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  deployment: text("deployment").notNull(),
  input: text("input").notNull().default(""),
  output: text("output").notNull().default(""),
  error: text("error"),
  sequence: integer("sequence").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});
