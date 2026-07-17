export type EndpointKind = "foundry-project" | "azure-openai";
export type DeploymentProtocol = "auto" | "responses" | "chat" | "deepseek";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const MODEL_ROLE_KEYS = [
  "chatDeployment",
  "memoryDeployment",
  "mapperDeployment",
  "alternativeDeployment",
  "adversarialDeployment",
  "evidenceDeployment",
  "criticDeployment",
  "refinementDeployment",
  "synthesisDeployment",
] as const;

export type ModelRoleKey = (typeof MODEL_ROLE_KEYS)[number];
export type ModelRoleSettings = Record<ModelRoleKey, string>;

export type SafeConfig = {
  configured: boolean;
  hasCredential: boolean;
  endpoint: string;
  endpointKind: EndpointKind;
  defaultProjectId: string;
  chatDeployment: string;
  memoryDeployment: string;
  branchDeployment: string;
  mapperDeployment: string;
  alternativeDeployment: string;
  adversarialDeployment: string;
  evidenceDeployment: string;
  criticDeployment: string;
  refinementDeployment: string;
  synthesisDeployment: string;
  reasoningEffort: "none" | "low" | "medium" | "high";
};

export type DeploymentRecord = {
  id: string;
  name: string;
  modelName: string | null;
  protocol: DeploymentProtocol;
  capabilities: Record<string, boolean | number | string | null>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SynthesisLane = "mapper" | "alternative" | "adversary" | "evidence" | "critic" | "refinement" | "synthesis";

export type RoutingDeploymentSnapshot = {
  id: string;
  name: string;
  modelName: string | null;
  protocol: Exclude<DeploymentProtocol, "auto">;
  capabilities: Record<string, boolean | number | string | null>;
  requestedDeployment: string;
  adjustmentReason: string | null;
};

export type SynthesisRoutingSnapshot = {
  version: 1;
  createdAt: string;
  lanes: Record<SynthesisLane, RoutingDeploymentSnapshot>;
};

export type ProjectRecord = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadRecord = {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  deploymentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: string;
  createdAt: string;
};

export type FileRecord = {
  id: string;
  projectId: string;
  threadId: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  status: "queued" | "extracting" | "ready" | "failed";
  error: string | null;
  summary: string;
  sha256: string;
  createdAt: string;
  updatedAt: string;
};

export const MEMORY_TYPES = [
  "preference",
  "project fact",
  "decision",
  "commitment",
  "hypothesis",
  "open question",
  "procedure",
  "episodic note",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryRecord = {
  id: string;
  projectId: string;
  threadId: string | null;
  type: MemoryType;
  title: string;
  content: string;
  scope: string;
  status: "accepted" | "superseded";
  sensitivity: "normal" | "sensitive";
  confidence: number;
  explicit: boolean;
  evidence: Array<{ kind: "message" | "file"; id: string; label?: string }>;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCandidateRecord = Omit<MemoryRecord, "status" | "supersedesId"> & {
  status: "proposed" | "accepted" | "rejected";
};

export type SynthesisRunRecord = {
  id: string;
  projectId: string;
  threadId: string;
  question: string;
  status: JobStatus;
  branchDeployment: string;
  criticDeployment: string;
  synthesisDeployment: string;
  routingSnapshot: SynthesisRoutingSnapshot;
  maxBranches: number;
  refinementRounds: number;
  fileIds: string[];
  output: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
