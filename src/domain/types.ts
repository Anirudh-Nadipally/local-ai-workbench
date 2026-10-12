export type Base = { id: string; createdAt: string; updatedAt: string };
export type Effort =
  "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningConfig = {
  mode: "openai" | "adaptive" | "budget";
  efforts: Exclude<Effort, "default">[];
  summary: boolean;
};
export type RunActivity = {
  reasoning?: string;
  reasoningTokens?: number;
  startedAt?: string;
  finishedAt?: string;
  phase?: "waiting" | "reasoning" | "writing";
  effort?: Effort;
};
export type Project = Base & {
  name: string;
  objective: string;
  briefId: string | null;
};
export type Brief = Base & {
  projectId: string;
  content: string;
  previousId: string | null;
  evidence: string[];
  status: "draft" | "accepted" | "dismissed";
};
export type Selection = { id: string; mode: "full" | "excerpts" | "original" };
export type Thread = Base & {
  title: string;
  projectId: string | null;
  modelId: string;
  sourceIds: Selection[];
  includeBrief: boolean;
  parentId: string | null;
  deletedAt: string | null;
  draft: string;
  effort?: Effort;
  temporary?: boolean;
  expiresAt?: string;
};
export type Message = Base & {
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "queued" | "streaming" | "cancelled" | "failed";
  sourceIds: string[];
  generationId?: string;
};
export type Source = Base & {
  projectId: string | null;
  threadId: string | null;
  name: string;
  mime: string;
  size: number;
  hash: string;
  storedName: string;
  status: "queued" | "processing" | "ready" | "failed";
  error: string;
  text: string;
  sections: { text: string; page?: number | null; section?: string | null }[];
};
export type Snapshot = Base & {
  threadId: string;
  briefId: string | null;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  sources: {
    id: string;
    name: string;
    mode: Selection["mode"];
    coverage: string;
    hash: string;
    storedName: string;
    mime: string;
  }[];
  estimatedTokens: number;
  model: Model;
  userText?: string;
  effort?: Effort;
};
export type Generation = Base &
  RunActivity & {
    threadId: string;
    messageId: string;
    snapshotId: string;
    modelName?: string;
    state: "queued" | "running" | "complete" | "failed" | "cancelled";
    error: string;
    cancelRequested: boolean;
    inputTokens?: number;
    outputTokens?: number;
  };
export type Model = Base & {
  name: string;
  protocol: "responses" | "chat" | "deepseek" | "anthropic";
  image: boolean;
  pdf: boolean;
  verifiedAt: string | null;
  contextTokens: number;
  reasoning?: ReasoningConfig;
};
export type Output = Base & {
  projectId: string | null;
  threadId: string;
  title: string;
  content: string;
  evidence: string[];
  previousId: string | null;
};
export type ExportIntent = "continue" | "share" | "transcript";
export type ExportSnapshot = Base & {
  threadId: string;
  title: string;
  intent: ExportIntent;
  nextTask: string;
  content: string;
  messageIds: string[];
  sourceIds: string[];
  manifest: { id: string; name: string; hash: string; storedName: string }[];
  briefId: string | null;
  revision?: number;
};
export type Draft = Base &
  RunActivity & {
    threadId: string;
    projectId: string | null;
    kind: "brief" | "handoff";
    state: Generation["state"];
    content: string;
    error: string;
    cancelRequested: boolean;
    model: Model;
    system: string;
    prompt: string;
    evidence: string[];
    sourceIds: string[];
    previousBriefId: string | null;
    exportId: string | null;
    proposalId: string | null;
    inputTokens?: number;
    outputTokens?: number;
  };
export type DraftSummary = Omit<Draft, "system" | "prompt">;
export type Job = Base & {
  task: "extract" | "generate" | "draft";
  targetId: string;
  state: "queued" | "running" | "complete" | "failed";
  owner: string;
  leaseUntil: number;
  error: string;
};
export type Records = {
  project: Project;
  brief: Brief;
  thread: Thread;
  message: Message;
  source: Source;
  snapshot: Snapshot;
  generation: Generation;
  model: Model;
  output: Output;
  export: ExportSnapshot;
  draft: Draft;
  job: Job;
  migration: Base & { legacyId: string; targetId: string };
  health: Base & { heartbeat: number };
};
export type ThreadView = {
  thread: Thread;
  messages: Message[];
  sources: Source[];
  project: Project | null;
  brief: Brief | null;
  generations: Generation[];
  outputs: Output[];
  drafts: DraftSummary[];
};
export type Boot = {
  projects: Project[];
  threads: Thread[];
  temporaryThreads: Thread[];
  models: Model[];
  configured: boolean;
  endpoint: string;
  workerAlive: boolean;
};
