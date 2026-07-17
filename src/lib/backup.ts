import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { getSqlite } from "@/lib/db";
import { getSafeConfig, parseConfigWithLegacyFallback, writeConfig, type LocalConfig } from "@/lib/config";
import { CONFIG_PATH, DATA_DIR, resolveStoredUploadPath, UPLOADS_DIR } from "@/lib/paths";
import { MODEL_ROLE_KEYS } from "@/lib/types";

const TABLES = [
  "projects", "deployments", "threads", "messages", "files", "file_chunks", "generations", "memories",
  "memory_candidates", "memory_revisions", "context_receipts", "synthesis_runs", "run_steps", "jobs", "artifacts", "settings",
] as const;
const DELETE_ORDER = [...TABLES].reverse();
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10_000;

export async function createBackupArchive() {
  const zip = new JSZip();
  const database = getSqlite();
  const tables = database.transaction(() => Object.fromEntries(
    TABLES.map((table) => [table, database.prepare(`SELECT * FROM ${table}`).all()]),
  ))();
  zip.file("workbench.json", JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), config: getSafeConfig(), tables }, null, 2));
  const files = database.prepare("SELECT stored_name FROM files").all() as Array<{ stored_name: string }>;
  for (const file of files) {
    try { zip.file(`uploads/${file.stored_name}`, await fs.readFile(resolveStoredUploadPath(file.stored_name))); }
    catch { /* Missing or invalid originals are reported by restore/UI later. */ }
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function restoreBackupArchive(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file("workbench.json");
  if (!manifestFile) throw new Error("This is not a Local Azure AI Workbench backup.");
  const manifestBytes = await manifestFile.async("nodebuffer");
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error("The backup manifest is too large.");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    schemaVersion: number; config?: Record<string, unknown>; tables: Record<string, Array<Record<string, unknown>>>;
  };
  if (manifest.schemaVersion !== 1 || !manifest.tables || typeof manifest.tables !== "object") {
    throw new Error("Unsupported or malformed backup.");
  }
  const database = getSqlite();
  const rowsByTable = validateManifestTables(database, manifest.tables);
  const configUpdate = restorableConfig(manifest.config);
  const storedNames = new Set(rowsByTable.files.map((row) => String(row.stored_name)));
  const uploadFiles = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.startsWith("uploads/"));
  if (uploadFiles.length > MAX_UPLOAD_FILES) throw new Error("The backup contains too many uploaded files.");

  const restoreRoot = path.join(DATA_DIR, `.restore-${randomUUID()}`);
  const stagedUploads = path.join(restoreRoot, "uploads");
  const previousUploads = path.join(restoreRoot, "previous-uploads");
  await fs.mkdir(stagedUploads, { recursive: true, mode: 0o700 });
  let totalUploadBytes = 0;
  try {
    for (const entry of uploadFiles) {
      const relativeName = entry.name.slice("uploads/".length);
      if (!isSafeStoredName(relativeName) || !storedNames.has(relativeName)) {
        throw new Error("The backup contains an invalid uploaded file path.");
      }
      const bytes = await entry.async("nodebuffer");
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`The restored file ${relativeName} exceeds 100 MB.`);
      totalUploadBytes += bytes.length;
      if (totalUploadBytes > MAX_TOTAL_UPLOAD_BYTES) throw new Error("The restored uploads exceed 1 GB.");
      await fs.writeFile(path.join(stagedUploads, relativeName), bytes, { mode: 0o600 });
    }

    const priorConfig = fsSync.existsSync(CONFIG_PATH) ? fsSync.readFileSync(CONFIG_PATH) : null;
    let swappedUploads = false;
    const transaction = database.transaction(() => {
      fsSync.renameSync(UPLOADS_DIR, previousUploads);
      fsSync.renameSync(stagedUploads, UPLOADS_DIR);
      swappedUploads = true;
      database.prepare("DELETE FROM file_chunks_fts").run();
      database.prepare("DELETE FROM messages_fts").run();
      for (const table of DELETE_ORDER) database.prepare(`DELETE FROM ${table}`).run();
      for (const table of TABLES) {
        for (const row of rowsByTable[table]) insertRow(database, table, row);
      }
      const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length) throw new Error("The backup contains inconsistent records.");
      if (configUpdate) writeConfig(configUpdate);
    });

    try {
      transaction();
    } catch (error) {
      if (swappedUploads) {
        fsSync.rmSync(UPLOADS_DIR, { recursive: true, force: true });
        fsSync.renameSync(previousUploads, UPLOADS_DIR);
      }
      if (priorConfig) fsSync.writeFileSync(CONFIG_PATH, priorConfig, { mode: 0o600 });
      else fsSync.rmSync(CONFIG_PATH, { force: true });
      throw error;
    }
    await fs.rm(previousUploads, { recursive: true, force: true });
    return { tables: TABLES.length, files: uploadFiles.length };
  } finally {
    await fs.rm(restoreRoot, { recursive: true, force: true });
  }
}

type ManifestTables = Record<(typeof TABLES)[number], Array<Record<string, unknown>>>;

function validateManifestTables(database: ReturnType<typeof getSqlite>, tables: Record<string, unknown>): ManifestTables {
  const validated = {} as ManifestTables;
  for (const table of TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows)) throw new Error(`The backup is missing the ${table} table.`);
    const allowed = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    validated[table] = rows.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`The ${table} table contains an invalid row.`);
      const row = { ...(value as Record<string, unknown>) };
      const columns = Object.keys(row);
      if (!columns.length || columns.some((column) => !allowed.has(column))) throw new Error(`The ${table} table contains unsupported columns.`);
      if (table === "files" && !isSafeStoredName(String(row.stored_name ?? ""))) {
        throw new Error("The backup contains an unsafe stored file name.");
      }
      if (table === "jobs" && ["queued", "running"].includes(String(row.status))) {
        row.status = "cancelled";
        row.message = "Cancelled during restore";
        row.lease_owner = null;
        row.lease_expires_at = null;
      }
      return row;
    });
  }
  return validated;
}

function insertRow(database: ReturnType<typeof getSqlite>, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  const names = columns.map((column) => `"${column}"`).join(",");
  const placeholders = columns.map(() => "?").join(",");
  database.prepare(`INSERT INTO ${table} (${names}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
}

function isSafeStoredName(name: string) {
  return Boolean(name) && name !== "." && name !== ".." && path.basename(name) === name && /^[A-Za-z0-9._-]+$/.test(name);
}

function restorableConfig(value: unknown): Partial<LocalConfig> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const parsed = parseConfigWithLegacyFallback(input);
  const update: Partial<LocalConfig> = {};
  for (const key of [...MODEL_ROLE_KEYS, "branchDeployment"] as const) {
    if (typeof input[key] === "string") update[key] = parsed[key];
  }
  if (typeof input.defaultProjectId === "string") update.defaultProjectId = parsed.defaultProjectId;
  if (typeof input.reasoningEffort === "string") update.reasoningEffort = parsed.reasoningEffort;
  return update;
}
