import { createId, nowIso } from "@/lib/ids";
import { getSqlite } from "@/lib/db";
import type {
  DeploymentRecord,
  DeploymentProtocol,
  FileRecord,
  MemoryCandidateRecord,
  MemoryRecord,
  MessageRecord,
  ProjectRecord,
  SynthesisRunRecord,
  SynthesisRoutingSnapshot,
  ThreadRecord,
} from "@/lib/types";

type Row = Record<string, unknown>;
const db = () => getSqlite();
const json = <T>(value: unknown, fallback: T): T => {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};

export function ensureDefaultProject() {
  const existing = db().prepare("SELECT * FROM projects ORDER BY created_at LIMIT 1").get() as Row | undefined;
  if (existing) return mapProject(existing);
  return createProject("Personal workbench", "Local conversations, files, and curated memory.");
}

export function createProject(name: string, description = "") {
  const id = createId("project");
  const at = nowIso();
  db().prepare("INSERT INTO projects (id,name,description,instructions,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, name.trim() || "Untitled project", description, "", at, at);
  return getProject(id)!;
}

export function listProjects() {
  return (db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(mapProject);
}

export function getProject(id: string) {
  const row = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return row ? mapProject(row) : null;
}

export function updateProject(id: string, input: Partial<Pick<ProjectRecord, "name" | "description" | "instructions">>) {
  const current = getProject(id);
  if (!current) return null;
  db().prepare("UPDATE projects SET name=?, description=?, instructions=?, updated_at=? WHERE id=?")
    .run(input.name ?? current.name, input.description ?? current.description, input.instructions ?? current.instructions, nowIso(), id);
  return getProject(id);
}

export function createThread(projectId: string, title = "New conversation", deploymentId?: string) {
  const id = createId("thread");
  const at = nowIso();
  db().prepare("INSERT INTO threads (id,project_id,title,summary,deployment_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, projectId, title, "", deploymentId ?? null, at, at);
  return getThread(id)!;
}

export function listThreads(projectId?: string, query?: string) {
  if (query?.trim()) {
    const fts = query.trim().replace(/["']/g, " ").split(/\s+/).filter(Boolean).map((part) => `"${part}"*`).join(" OR ");
    const rows = db().prepare(`SELECT DISTINCT t.* FROM threads t LEFT JOIN messages_fts f ON f.thread_id=t.id
      WHERE (? IS NULL OR t.project_id=?) AND (t.title LIKE ? OR f.content MATCH ?) ORDER BY t.updated_at DESC LIMIT 100`)
      .all(projectId ?? null, projectId ?? null, `%${query}%`, fts) as Row[];
    return rows.map(mapThread);
  }
  const rows = projectId
    ? db().prepare("SELECT * FROM threads WHERE project_id=? ORDER BY updated_at DESC").all(projectId)
    : db().prepare("SELECT * FROM threads ORDER BY updated_at DESC").all();
  return (rows as Row[]).map(mapThread);
}

export function getThread(id: string) {
  const row = db().prepare("SELECT * FROM threads WHERE id=?").get(id) as Row | undefined;
  return row ? mapThread(row) : null;
}

export function updateThread(id: string, input: Partial<Pick<ThreadRecord, "title" | "summary" | "deploymentId">>) {
  const current = getThread(id);
  if (!current) return null;
  db().prepare("UPDATE threads SET title=?,summary=?,deployment_id=?,updated_at=? WHERE id=?")
    .run(input.title ?? current.title, input.summary ?? current.summary,
      input.deploymentId === undefined ? current.deploymentId : input.deploymentId, nowIso(), id);
  return getThread(id);
}

export function deleteThread(id: string) {
  const sqlite = db();
  return sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM generations WHERE thread_id=?").run(id);
    sqlite.prepare("DELETE FROM context_receipts WHERE thread_id=?").run(id);
    sqlite.prepare("DELETE FROM synthesis_runs WHERE thread_id=?").run(id);
    sqlite.prepare("DELETE FROM artifacts WHERE thread_id=?").run(id);
    return sqlite.prepare("DELETE FROM threads WHERE id=?").run(id).changes > 0;
  })();
}

export function saveMessage(input: { id?: string; threadId: string; role: MessageRecord["role"]; content: string; status?: string }) {
  const id = input.id ?? createId("message");
  const at = nowIso();
  const existing = getMessage(id);
  if (existing && (existing.threadId !== input.threadId || existing.role !== input.role)) {
    throw new Error("The message identifier is already used by another conversation.");
  }
  db().prepare(`INSERT INTO messages (id,thread_id,role,content,status,created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content,status=excluded.status`)
    .run(id, input.threadId, input.role, input.content, input.status ?? "complete", at);
  const thread = getThread(input.threadId);
  if (thread) {
    const firstUser = db().prepare("SELECT content FROM messages WHERE thread_id=? AND role='user' ORDER BY created_at LIMIT 1").get(input.threadId) as { content?: string } | undefined;
    const title = thread.title === "New conversation" && firstUser?.content
      ? firstUser.content.replace(/\s+/g, " ").slice(0, 56)
      : thread.title;
    db().prepare("UPDATE threads SET title=?,updated_at=? WHERE id=?").run(title, at, input.threadId);
  }
  return getMessage(id)!;
}

export function getMessage(id: string) {
  const row = db().prepare("SELECT * FROM messages WHERE id=?").get(id) as Row | undefined;
  return row ? mapMessage(row) : null;
}

export function listMessages(threadId: string) {
  return (db().prepare("SELECT * FROM messages WHERE thread_id=? ORDER BY created_at").all(threadId) as Row[]).map(mapMessage);
}

export function upsertDeployment(input: { name: string; modelName?: string | null; protocol?: DeploymentProtocol; capabilities?: Record<string, unknown>; enabled?: boolean }) {
  const existing = db().prepare("SELECT * FROM deployments WHERE name=?").get(input.name) as Row | undefined;
  const at = nowIso();
  const id = existing ? String(existing.id) : createId("deployment");
  const modelName = input.modelName === undefined ? (existing?.model_name ? String(existing.model_name) : null) : input.modelName;
  const protocol = input.protocol ?? (existing ? String(existing.protocol) as DeploymentProtocol : "auto");
  const capabilities = { ...json(existing?.capabilities_json, {}), ...(input.capabilities ?? {}) };
  const enabled = input.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : input.enabled;
  db().prepare(`INSERT INTO deployments (id,name,model_name,protocol,capabilities_json,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET model_name=excluded.model_name,
    protocol=excluded.protocol,capabilities_json=excluded.capabilities_json,enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .run(id, input.name, modelName, protocol, JSON.stringify(capabilities), enabled ? 1 : 0, at, at);
  return getDeployment(input.name)!;
}

export function getDeployment(name: string) {
  const row = db().prepare("SELECT * FROM deployments WHERE name=? OR id=?").get(name, name) as Row | undefined;
  return row ? mapDeployment(row) : null;
}

export function listDeployments(includeDisabled = false) {
  const rows = includeDisabled
    ? db().prepare("SELECT * FROM deployments ORDER BY enabled DESC,name").all()
    : db().prepare("SELECT * FROM deployments WHERE enabled=1 ORDER BY name").all();
  return (rows as Row[]).map(mapDeployment);
}

export function updateDeploymentCapabilities(name: string, capabilities: Record<string, unknown>, protocol?: DeploymentProtocol) {
  const current = getDeployment(name);
  if (!current) return null;
  db().prepare("UPDATE deployments SET capabilities_json=?,protocol=?,updated_at=? WHERE name=?")
    .run(JSON.stringify({ ...current.capabilities, ...capabilities }), protocol ?? current.protocol, nowIso(), name);
  return getDeployment(name);
}

export function updateDeployment(id: string, input: { modelName?: string | null; protocol?: DeploymentProtocol; enabled?: boolean }) {
  const current = getDeployment(id);
  if (!current) return null;
  const adapterChanged = input.protocol !== undefined && input.protocol !== current.protocol;
  const modelNameChanged = input.modelName !== undefined && input.modelName !== current.modelName;
  const capabilities = adapterChanged
    ? { ...current.capabilities, lastProbeOk: null, lastProbeError: null, probeRequired: true }
    : modelNameChanged
      ? { ...current.capabilities, probeRequired: true }
    : current.capabilities;
  db().prepare("UPDATE deployments SET model_name=?,protocol=?,enabled=?,capabilities_json=?,updated_at=? WHERE id=?")
    .run(input.modelName === undefined ? current.modelName : input.modelName, input.protocol ?? current.protocol,
      input.enabled === undefined ? (current.enabled ? 1 : 0) : (input.enabled ? 1 : 0), JSON.stringify(capabilities), nowIso(), current.id);
  return getDeployment(current.id);
}

export function createFile(input: Omit<FileRecord, "id" | "status" | "error" | "summary" | "createdAt" | "updatedAt">) {
  const duplicate = db().prepare("SELECT * FROM files WHERE project_id=? AND sha256=?").get(input.projectId, input.sha256) as Row | undefined;
  if (duplicate) return { file: mapFile(duplicate), duplicate: true };
  const id = createId("file");
  const at = nowIso();
  db().prepare(`INSERT INTO files (id,project_id,thread_id,original_name,stored_name,mime_type,size_bytes,status,error,summary,sha256,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'queued',NULL,'',?,?,?)`)
    .run(id, input.projectId, input.threadId, input.originalName, input.storedName, input.mimeType, input.sizeBytes, input.sha256, at, at);
  return { file: getFile(id)!, duplicate: false };
}

export function listFiles(projectId: string) {
  return (db().prepare("SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Row[]).map(mapFile);
}

export function getFile(id: string) {
  const row = db().prepare("SELECT * FROM files WHERE id=?").get(id) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function updateFile(id: string, input: Partial<Pick<FileRecord, "status" | "error" | "summary">>) {
  const current = getFile(id);
  if (!current) return null;
  db().prepare("UPDATE files SET status=?,error=?,summary=?,updated_at=? WHERE id=?")
    .run(input.status ?? current.status, input.error === undefined ? current.error : input.error, input.summary ?? current.summary, nowIso(), id);
  return getFile(id);
}

export function deleteFile(id: string) {
  return db().prepare("DELETE FROM files WHERE id=?").run(id).changes > 0;
}

export function replaceFileChunks(fileId: string, chunks: Array<{ content: string; page?: number | null; section?: string | null; tokenEstimate: number }>) {
  const transaction = db().transaction(() => {
    db().prepare("DELETE FROM file_chunks WHERE file_id=?").run(fileId);
    const insert = db().prepare("INSERT INTO file_chunks (id,file_id,chunk_index,content,page,section,token_estimate) VALUES (?,?,?,?,?,?,?)");
    chunks.forEach((chunk, index) => insert.run(createId("chunk"), fileId, index, chunk.content, chunk.page ?? null, chunk.section ?? null, chunk.tokenEstimate));
  });
  transaction();
}

export function getFileChunks(fileId: string, limit = 1000) {
  return db().prepare("SELECT * FROM file_chunks WHERE file_id=? ORDER BY chunk_index LIMIT ?").all(fileId, limit) as Row[];
}

export function searchFileChunks(fileIds: string[], query: string, limit = 12) {
  if (!fileIds.length) return [];
  const placeholders = fileIds.map(() => "?").join(",");
  const clean = query.replace(/["']/g, " ").split(/\s+/).filter((part) => part.length > 2).slice(0, 12);
  if (!clean.length) {
    return db().prepare(`SELECT c.*,f.original_name FROM file_chunks c JOIN files f ON f.id=c.file_id WHERE c.file_id IN (${placeholders}) ORDER BY c.chunk_index LIMIT ?`)
      .all(...fileIds, limit) as Row[];
  }
  const fts = clean.map((part) => `"${part}"*`).join(" OR ");
  return db().prepare(`SELECT c.*,f.original_name,bm25(file_chunks_fts) AS rank FROM file_chunks_fts
    JOIN file_chunks c ON c.id=file_chunks_fts.chunk_id JOIN files f ON f.id=c.file_id
    WHERE file_chunks_fts MATCH ? AND c.file_id IN (${placeholders}) ORDER BY rank LIMIT ?`)
    .all(fts, ...fileIds, limit) as Row[];
}

export function listMemories(projectId: string, threadId?: string) {
  const rows = threadId
    ? db().prepare("SELECT * FROM memories WHERE project_id=? AND status='accepted' AND (thread_id IS NULL OR thread_id=?) ORDER BY updated_at DESC").all(projectId, threadId)
    : db().prepare("SELECT * FROM memories WHERE project_id=? AND status='accepted' ORDER BY updated_at DESC").all(projectId);
  return (rows as Row[]).map(mapMemory);
}

export function listMemoryCandidates(projectId: string, threadId?: string) {
  const rows = threadId
    ? db().prepare("SELECT * FROM memory_candidates WHERE project_id=? AND thread_id=? ORDER BY created_at DESC").all(projectId, threadId)
    : db().prepare("SELECT * FROM memory_candidates WHERE project_id=? ORDER BY created_at DESC").all(projectId);
  return (rows as Row[]).map(mapCandidate);
}

export function replaceMemoryCandidates(projectId: string, threadId: string, candidates: Array<Omit<MemoryCandidateRecord, "id" | "projectId" | "threadId" | "status" | "createdAt" | "updatedAt">>) {
  const transaction = db().transaction(() => {
    db().prepare("DELETE FROM memory_candidates WHERE project_id=? AND thread_id=? AND status='proposed'").run(projectId, threadId);
    const insert = db().prepare(`INSERT INTO memory_candidates
      (id,project_id,thread_id,type,title,content,scope,status,sensitivity,confidence,explicit,evidence_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'proposed',?,?,?,?,?,?)`);
    for (const item of candidates.slice(0, 8)) {
      const at = nowIso();
      insert.run(createId("candidate"), projectId, threadId, item.type, item.title, item.content, item.scope,
        item.sensitivity, item.confidence, item.explicit ? 1 : 0, JSON.stringify(item.evidence), at, at);
    }
  });
  transaction();
}

export function acceptMemoryCandidate(candidateId: string, edits?: Partial<Pick<MemoryCandidateRecord, "type" | "title" | "content" | "scope" | "sensitivity" | "confidence" | "explicit">>) {
  const row = db().prepare("SELECT * FROM memory_candidates WHERE id=?").get(candidateId) as Row | undefined;
  if (!row) return null;
  if (String(row.status) !== "proposed") throw new Error("This memory candidate is no longer pending.");
  const candidate = { ...mapCandidate(row), ...edits };
  const id = createId("memory");
  const at = nowIso();
  const transaction = db().transaction(() => {
    db().prepare(`INSERT INTO memories (id,project_id,thread_id,type,title,content,scope,status,sensitivity,confidence,explicit,evidence_json,supersedes_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'accepted',?,?,?,?,NULL,?,?)`)
      .run(id, candidate.projectId, candidate.threadId, candidate.type, candidate.title, candidate.content,
        candidate.scope, candidate.sensitivity, candidate.confidence, candidate.explicit ? 1 : 0, JSON.stringify(candidate.evidence), at, at);
    db().prepare("UPDATE memory_candidates SET status='accepted',updated_at=? WHERE id=?").run(at, candidateId);
  });
  transaction();
  return db().prepare("SELECT * FROM memories WHERE id=?").get(id) as Row;
}

export function rejectMemoryCandidate(id: string) {
  return db().prepare("UPDATE memory_candidates SET status='rejected',updated_at=? WHERE id=? AND status='proposed'").run(nowIso(), id).changes > 0;
}

export function updateMemory(id: string, input: Partial<Pick<MemoryRecord, "type" | "title" | "content" | "scope" | "sensitivity" | "confidence" | "explicit">>) {
  const row = db().prepare("SELECT * FROM memories WHERE id=?").get(id) as Row | undefined;
  if (!row) return null;
  const current = mapMemory(row);
  const at = nowIso();
  const transaction = db().transaction(() => {
    db().prepare("INSERT INTO memory_revisions (id,memory_id,prior_json,created_at) VALUES (?,?,?,?)")
      .run(createId("revision"), id, JSON.stringify(current), at);
    db().prepare("UPDATE memories SET type=?,title=?,content=?,scope=?,sensitivity=?,confidence=?,explicit=?,updated_at=? WHERE id=?")
      .run(input.type ?? current.type, input.title ?? current.title, input.content ?? current.content,
        input.scope ?? current.scope, input.sensitivity ?? current.sensitivity, input.confidence ?? current.confidence,
        (input.explicit ?? current.explicit) ? 1 : 0, at, id);
  });
  transaction();
  return mapMemory(db().prepare("SELECT * FROM memories WHERE id=?").get(id) as Row);
}

export function deleteMemory(id: string) {
  return db().prepare("DELETE FROM memories WHERE id=?").run(id).changes > 0;
}

export function createContextReceipt(input: { threadId: string; memoryIds: string[]; fileChunkIds: string[]; estimatedTokens: number; renderedContext: string }) {
  const id = createId("receipt");
  db().prepare("INSERT INTO context_receipts (id,thread_id,memory_ids_json,file_chunk_ids_json,estimated_tokens,rendered_context,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, input.threadId, JSON.stringify(input.memoryIds), JSON.stringify(input.fileChunkIds), input.estimatedTokens, input.renderedContext, nowIso());
  return id;
}

export function getLatestReceipt(threadId: string) {
  return db().prepare("SELECT * FROM context_receipts WHERE thread_id=? ORDER BY created_at DESC LIMIT 1").get(threadId) as Row | undefined;
}

export function createJob(type: string, payload: Record<string, unknown>) {
  const id = createId("job");
  const at = nowIso();
  db().prepare("INSERT INTO jobs (id,type,payload_json,status,progress,message,attempts,created_at,updated_at) VALUES (?,?,?,'queued',0,'Queued',0,?,?)")
    .run(id, type, JSON.stringify(payload), at, at);
  return getJob(id)!;
}

export function createSynthesisJob(runId: string) {
  const database = db();
  return database.transaction(() => {
    const existing = database.prepare(`SELECT * FROM jobs
      WHERE type='synthesis' AND status IN ('queued','running')
      AND json_extract(payload_json, '$.runId')=? ORDER BY created_at LIMIT 1`).get(runId) as Row | undefined;
    if (existing) return existing;
    return createJob("synthesis", { runId });
  })();
}

export function cancelSynthesisJobs(runId: string) {
  return db().prepare(`UPDATE jobs SET status='cancelled',message='Cancelled',lease_expires_at=NULL,updated_at=?
    WHERE type='synthesis' AND status IN ('queued','running')
    AND json_extract(payload_json, '$.runId')=?`).run(nowIso(), runId).changes;
}

export function getJob(id: string) {
  return db().prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
}

export function claimJob(owner: string, leaseSeconds = 120) {
  const database = db();
  const transaction = database.transaction(() => {
    database.prepare(`UPDATE jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE status='running' AND (lease_expires_at IS NULL OR datetime(lease_expires_at) < datetime('now'))`).run(nowIso());
    const row = database.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as Row | undefined;
    if (!row) return null;
    const expires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const result = database.prepare("UPDATE jobs SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'")
      .run(owner, expires, nowIso(), row.id);
    return result.changes ? database.prepare("SELECT * FROM jobs WHERE id=?").get(row.id) as Row : null;
  });
  return transaction();
}

export function renewJobLease(id: string, owner: string, leaseSeconds = 120) {
  return db().prepare(`UPDATE jobs SET lease_expires_at=?,updated_at=?
    WHERE id=? AND status='running' AND lease_owner=?`)
    .run(new Date(Date.now() + leaseSeconds * 1000).toISOString(), nowIso(), id, owner).changes > 0;
}

export function updateJob(id: string, input: { status?: string; progress?: number; message?: string; error?: string | null }, owner: string) {
  const current = getJob(id);
  if (!current || current.status !== "running" || current.lease_owner !== owner) return null;
  const terminal = input.status !== undefined && input.status !== "running";
  db().prepare(`UPDATE jobs SET status=?,progress=?,message=?,error=?,lease_owner=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND status='running' AND lease_owner=?`)
    .run(input.status ?? current.status, input.progress ?? current.progress, input.message ?? current.message,
      input.error === undefined ? current.error : input.error, terminal ? null : owner,
      terminal ? null : current.lease_expires_at, nowIso(), id, owner);
  return getJob(id);
}

type CreateSynthesisRunInput = Omit<SynthesisRunRecord, "id" | "status" | "output" | "error" | "createdAt" | "updatedAt" | "routingSnapshot"> & {
  routingSnapshot?: SynthesisRoutingSnapshot;
};

export function createSynthesisRun(input: CreateSynthesisRunInput) {
  const id = createId("run");
  const at = nowIso();
  const routingSnapshot = input.routingSnapshot ?? legacyRoutingSnapshot(input, at);
  db().prepare(`INSERT INTO synthesis_runs (id,project_id,thread_id,question,status,branch_deployment,critic_deployment,synthesis_deployment,max_branches,refinement_rounds,file_ids_json,routing_snapshot_json,output,error,created_at,updated_at)
    VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?,'',NULL,?,?)`)
    .run(id, input.projectId, input.threadId, input.question, input.branchDeployment, input.criticDeployment,
      input.synthesisDeployment, Math.min(5, Math.max(1, input.maxBranches)), Math.min(1, Math.max(0, input.refinementRounds)), JSON.stringify(input.fileIds), JSON.stringify(routingSnapshot), at, at);
  return getSynthesisRun(id)!;
}

export function getSynthesisRun(id: string) {
  const row = db().prepare("SELECT * FROM synthesis_runs WHERE id=?").get(id) as Row | undefined;
  return row ? mapRun(row) : null;
}

export function listSynthesisRuns(threadId: string) {
  return (db().prepare("SELECT * FROM synthesis_runs WHERE thread_id=? ORDER BY created_at DESC").all(threadId) as Row[]).map(mapRun);
}

export function updateSynthesisRun(id: string, input: Partial<Pick<SynthesisRunRecord, "status" | "output" | "error">>) {
  const current = getSynthesisRun(id);
  if (!current) return null;
  db().prepare("UPDATE synthesis_runs SET status=?,output=?,error=?,updated_at=? WHERE id=?")
    .run(input.status ?? current.status, input.output ?? current.output, input.error === undefined ? current.error : input.error, nowIso(), id);
  return getSynthesisRun(id);
}

export function createRunStep(input: { runId: string; stage: string; role: string; deployment: string; sequence: number; input?: string }) {
  const id = createId("step");
  db().prepare("INSERT INTO run_steps (id,run_id,stage,role,status,deployment,input,output,sequence) VALUES (?,?,?,?,'queued',?,?,'',?)")
    .run(id, input.runId, input.stage, input.role, input.deployment, input.input ?? "", input.sequence);
  return id;
}

export function updateRunStep(id: string, input: { status: string; output?: string; error?: string | null }) {
  db().prepare("UPDATE run_steps SET status=?,output=COALESCE(?,output),error=?,started_at=COALESCE(started_at,?),completed_at=? WHERE id=?")
    .run(input.status, input.output ?? null, input.error ?? null, nowIso(), ["completed", "failed", "cancelled"].includes(input.status) ? nowIso() : null, id);
}

export function finishRunningRunSteps(runId: string, status: "failed" | "cancelled", error: string | null) {
  return db().prepare(`UPDATE run_steps SET status=?,error=?,completed_at=?
    WHERE run_id=? AND status='running'`).run(status, error, nowIso(), runId).changes;
}

export function listRunSteps(runId: string) {
  return db().prepare("SELECT * FROM run_steps WHERE run_id=? ORDER BY sequence").all(runId) as Row[];
}

function mapProject(row: Row): ProjectRecord { return { id: String(row.id), name: String(row.name), description: String(row.description), instructions: String(row.instructions), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapThread(row: Row): ThreadRecord { return { id: String(row.id), projectId: String(row.project_id), title: String(row.title), summary: String(row.summary), deploymentId: row.deployment_id ? String(row.deployment_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapMessage(row: Row): MessageRecord { return { id: String(row.id), threadId: String(row.thread_id), role: row.role as MessageRecord["role"], content: String(row.content), status: String(row.status), createdAt: String(row.created_at) }; }
function mapDeployment(row: Row): DeploymentRecord { return { id: String(row.id), name: String(row.name), modelName: row.model_name ? String(row.model_name) : null, protocol: row.protocol as DeploymentRecord["protocol"], capabilities: json(row.capabilities_json, {}), enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapFile(row: Row): FileRecord { return { id: String(row.id), projectId: String(row.project_id), threadId: row.thread_id ? String(row.thread_id) : null, originalName: String(row.original_name), storedName: String(row.stored_name), mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes), status: row.status as FileRecord["status"], error: row.error ? String(row.error) : null, summary: String(row.summary), sha256: String(row.sha256), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapMemory(row: Row): MemoryRecord { return { id: String(row.id), projectId: String(row.project_id), threadId: row.thread_id ? String(row.thread_id) : null, type: row.type as MemoryRecord["type"], title: String(row.title), content: String(row.content), scope: String(row.scope), status: row.status as MemoryRecord["status"], sensitivity: row.sensitivity as MemoryRecord["sensitivity"], confidence: Number(row.confidence), explicit: Boolean(row.explicit), evidence: json(row.evidence_json, []), supersedesId: row.supersedes_id ? String(row.supersedes_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapCandidate(row: Row): MemoryCandidateRecord { const memory = mapMemory({ ...row, supersedes_id: null, status: "accepted" }); return { ...memory, status: row.status as MemoryCandidateRecord["status"] }; }
function mapRun(row: Row): SynthesisRunRecord { return { id: String(row.id), projectId: String(row.project_id), threadId: String(row.thread_id), question: String(row.question), status: row.status as SynthesisRunRecord["status"], branchDeployment: String(row.branch_deployment), criticDeployment: String(row.critic_deployment), synthesisDeployment: String(row.synthesis_deployment), routingSnapshot: parseRoutingSnapshot(row), maxBranches: Number(row.max_branches), refinementRounds: Number(row.refinement_rounds), fileIds: json(row.file_ids_json, []), output: String(row.output), error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }

function parseRoutingSnapshot(row: Row): SynthesisRoutingSnapshot {
  const parsed = json<Partial<SynthesisRoutingSnapshot>>(row.routing_snapshot_json, {});
  if (parsed.version === 1 && parsed.lanes) return parsed as SynthesisRoutingSnapshot;
  return legacyRoutingSnapshot({
    branchDeployment: String(row.branch_deployment),
    criticDeployment: String(row.critic_deployment),
    synthesisDeployment: String(row.synthesis_deployment),
  }, String(row.created_at));
}

function legacyRoutingSnapshot(input: { branchDeployment: string; criticDeployment: string; synthesisDeployment: string }, createdAt: string): SynthesisRoutingSnapshot {
  const lane = (name: string) => {
    const deployment = getDeployment(name);
    const protocol = deployment?.protocol && deployment.protocol !== "auto" ? deployment.protocol : "responses";
    return {
      id: deployment?.id ?? name,
      name,
      modelName: deployment?.modelName ?? null,
      protocol,
      capabilities: deployment?.capabilities ?? {},
      requestedDeployment: name,
      adjustmentReason: null,
    };
  };
  return {
    version: 1,
    createdAt,
    lanes: {
      mapper: lane(input.branchDeployment),
      alternative: lane(input.branchDeployment),
      adversary: lane(input.branchDeployment),
      evidence: lane(input.branchDeployment),
      critic: lane(input.criticDeployment),
      refinement: lane(input.criticDeployment),
      synthesis: lane(input.synthesisDeployment),
    },
  };
}
