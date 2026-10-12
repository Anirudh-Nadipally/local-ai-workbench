import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Base, Records } from "@/domain/types";
export const dataDir = path.resolve(
  process.env.WORKBENCH_DATA_DIR || path.join(process.cwd(), "data"),
);
export const uploadsDir = path.join(dataDir, "uploads");
let database: Database.Database | undefined;
export function db() {
  if (!database) {
    fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o700 });
    database = new Database(path.join(dataDir, "workbench.db"));
    fs.chmodSync(path.join(dataDir, "workbench.db"), 0o600);
    database.pragma("journal_mode = WAL");
    database.pragma("busy_timeout = 5000");
    database.exec(`CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_versions VALUES(1);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_thread ON records(kind,json_extract(body,'$.threadId'));
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(id UNINDEXED,kind UNINDEXED,content);`);
  }
  return database;
}
export function base(id = crypto.randomUUID()): Base {
  const at = new Date().toISOString();
  return { id, createdAt: at, updatedAt: at };
}
export function get<K extends keyof Records>(
  kind: K,
  id: string,
): Records[K] | null {
  const row = db()
    .prepare("SELECT body FROM records WHERE kind=? AND id=?")
    .get(kind, id) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : null;
}
export function required<K extends keyof Records>(
  kind: K,
  id: string,
): Records[K] {
  const value = get(kind, id);
  if (!value) throw new Error(`${kind} not found.`);
  return value;
}
export function all<K extends keyof Records>(kind: K): Records[K][] {
  return (
    db()
      .prepare(
        "SELECT body FROM records WHERE kind=? ORDER BY updated_at DESC,id",
      )
      .all(kind) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
export function put<K extends keyof Records>(
  kind: K,
  value: Records[K],
  preserveUpdatedAt = false,
): Records[K] {
  const next = {
    ...value,
    updatedAt: preserveUpdatedAt ? value.updatedAt : new Date().toISOString(),
  };
  db().transaction(() => {
    db()
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
      )
      .run(kind, next.id, JSON.stringify(next), next.updatedAt);
    if (["thread", "message", "source", "output", "project"].includes(kind)) {
      db()
        .prepare("DELETE FROM search_index WHERE id=? AND kind=?")
        .run(next.id, kind);
      const parentId = "threadId" in next ? next.threadId : null;
      const temporary =
        kind === "thread"
          ? (next as Records["thread"]).temporary
          : parentId
            ? get("thread", String(parentId))?.temporary
            : false;
      if (temporary) return;
      const text = Object.entries(next)
        .filter(([k]) =>
          ["title", "name", "content", "text", "objective"].includes(k),
        )
        .map(([, v]) => v)
        .join("\n");
      db()
        .prepare("INSERT INTO search_index(id,kind,content) VALUES(?,?,?)")
        .run(next.id, kind, text);
    }
  })();
  return next;
}
export function filePath(name: string) {
  if (path.basename(name) !== name || !/^[a-zA-Z0-9._-]+$/.test(name))
    throw new Error("Invalid stored filename.");
  return path.join(uploadsDir, name);
}
export function threadMessages(id: string) {
  return (
    db()
      .prepare(
        "SELECT body FROM records WHERE kind='message' AND json_extract(body,'$.threadId')=? ORDER BY json_extract(body,'$.createdAt'),id",
      )
      .all(id) as { body: string }[]
  ).map((row) => JSON.parse(row.body)) as Records["message"][];
}
export function sourceSummaries(): Records["source"][] {
  return (
    db()
      .prepare(
        "SELECT json_remove(body,'$.text','$.sections') AS body FROM records WHERE kind='source' ORDER BY updated_at DESC",
      )
      .all() as { body: string }[]
  ).map((row) => ({ ...JSON.parse(row.body), text: "", sections: [] }));
}
export function search(query: string) {
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12);
  if (!tokens?.length) return [];
  return db()
    .prepare(
      "SELECT id,kind,snippet(search_index,2,'','',' … ',24) AS snippet FROM search_index WHERE search_index MATCH ? LIMIT 60",
    )
    .all(tokens.map((t) => `"${t}"*`).join(" AND ")) as {
    id: string;
    kind: string;
    snippet: string;
  }[];
}
