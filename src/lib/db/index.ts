import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import { DATA_DIR, DB_PATH, EXPORTS_DIR, UPLOADS_DIR } from "@/lib/paths";
import * as schema from "@/lib/db/schema";

let client: Database.Database | undefined;

export function getSqlite() {
  if (client) return client;
  for (const directory of [DATA_DIR, UPLOADS_DIR, EXPORTS_DIR]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  client = new Database(DB_PATH);
  fs.chmodSync(DB_PATH, 0o600);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  migrate(client);
  recoverStaleJobs(client);
  return client;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

function recoverStaleJobs(db: Database.Database) {
  db.prepare(`UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
    updated_at = datetime('now') WHERE status = 'running'
    AND (lease_expires_at IS NULL OR datetime(lease_expires_at) < datetime('now'))`).run();
}

export function migrate(db = getSqlite()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', deployment_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model_name TEXT, protocol TEXT NOT NULL DEFAULT 'responses',
      capabilities_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL, error TEXT, summary TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS files_project_hash_unique ON files(project_id, sha256);
    CREATE TABLE IF NOT EXISTS file_chunks (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL, content TEXT NOT NULL, page INTEGER, section TEXT,
      token_estimate INTEGER NOT NULL, UNIQUE(file_id, chunk_index)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts5(
      content, file_id UNINDEXED, chunk_id UNINDEXED, tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS file_chunks_ai AFTER INSERT ON file_chunks BEGIN
      INSERT INTO file_chunks_fts(rowid, content, file_id, chunk_id) VALUES (new.rowid, new.content, new.file_id, new.id);
    END;
    CREATE TRIGGER IF NOT EXISTS file_chunks_ad AFTER DELETE ON file_chunks BEGIN
      DELETE FROM file_chunks_fts WHERE rowid = old.rowid;
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, thread_id UNINDEXED, message_id UNINDEXED, tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, thread_id, message_id) VALUES (new.rowid, new.content, new.thread_id, new.id);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
    END;
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT NOT NULL, deployment_id TEXT NOT NULL,
      status TEXT NOT NULL, settings_json TEXT NOT NULL DEFAULT '{}', input_tokens INTEGER,
      output_tokens INTEGER, duration_ms INTEGER, finish_reason TEXT, error TEXT,
      provider_metadata_json TEXT NOT NULL DEFAULT '{}', context_receipt_id TEXT,
      started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, sensitivity TEXT NOT NULL,
      confidence REAL NOT NULL, explicit INTEGER NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
      supersedes_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, sensitivity TEXT NOT NULL,
      confidence REAL NOT NULL, explicit INTEGER NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_revisions (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      prior_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_receipts (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, generation_id TEXT,
      memory_ids_json TEXT NOT NULL DEFAULT '[]', file_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
      estimated_tokens INTEGER NOT NULL DEFAULT 0, rendered_context TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS synthesis_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, question TEXT NOT NULL,
      status TEXT NOT NULL, branch_deployment TEXT NOT NULL, critic_deployment TEXT NOT NULL,
      synthesis_deployment TEXT NOT NULL, max_branches INTEGER NOT NULL, refinement_rounds INTEGER NOT NULL,
      file_ids_json TEXT NOT NULL DEFAULT '[]', routing_snapshot_json TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, deployment TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '', output TEXT NOT NULL DEFAULT '', error TEXT, sequence INTEGER NOT NULL,
      started_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT, lease_expires_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const synthesisColumns = db.prepare("PRAGMA table_info(synthesis_runs)").all() as Array<{ name: string }>;
  if (!synthesisColumns.some((column) => column.name === "file_ids_json")) {
    db.exec("ALTER TABLE synthesis_runs ADD COLUMN file_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!synthesisColumns.some((column) => column.name === "routing_snapshot_json")) {
    db.exec("ALTER TABLE synthesis_runs ADD COLUMN routing_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  }
}
