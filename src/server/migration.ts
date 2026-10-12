import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createDecipheriv, createHash } from "node:crypto";
import { all, base, db, get, put } from "./db";
import { createThread } from "./workspace";
import { addSource } from "./sources";
import { saveConnection } from "./connections";
const legacyRoot = () => {
  const root = process.env.WORKBENCH_LEGACY_DIR;
  if (!root)
    throw new Error(
      "Set WORKBENCH_LEGACY_DIR to the previous workbench folder, then restart the app to import it.",
    );
  return path.resolve(root);
};
function open() {
  const file = path.join(legacyRoot(), "data/workbench.db");
  if (!fs.existsSync(file))
    throw new Error("The previous workbench database was not found.");
  return new Database(file, { readonly: true, fileMustExist: true });
}
type Row = Record<string, unknown>;
export function migrationPreview() {
  let source: Database.Database | undefined;
  try {
    source = open();
    const threads = source
      .prepare(
        "SELECT id,title,project_id,created_at,updated_at FROM threads ORDER BY updated_at DESC",
      )
      .all() as {
      id: string;
      title: string;
      project_id: string;
      created_at: string;
      updated_at: string;
    }[];
    const migrated = new Set(all("migration").map((m) => m.legacyId));
    return {
      available: true,
      threads: threads.map((t) => ({
        ...t,
        imported: migrated.has(String(t.id)),
      })),
      hasConnection: fs.existsSync(path.join(legacyRoot(), "data/config.json")),
    };
  } catch (error) {
    return {
      available: false,
      threads: [],
      hasConnection: false,
      error: error instanceof Error ? error.message : "Unavailable",
    };
  } finally {
    source?.close();
  }
}
function importLegacyFile(f: Row, projectId: string, threadId: string | null) {
  const prior = all("migration").find(
    (m) => m.legacyId === "source:" + String(f.id),
  );
  if (prior) {
    const existing = get("source", prior.targetId);
    if (existing) return existing;
  }
  const name = String(f.stored_name);
  if (path.basename(name) !== name || !/^[a-zA-Z0-9._-]+$/.test(name))
    throw new Error("Unsafe legacy file path.");
  const bytes = fs.readFileSync(path.join(legacyRoot(), "data/uploads", name));
  if (
    f.sha256 &&
    createHash("sha256").update(bytes).digest("hex") !== String(f.sha256)
  )
    throw new Error("Legacy source hash mismatch.");
  const imported = addSource(
    String(f.original_name),
    bytes,
    projectId,
    threadId,
  );
  put("migration", {
    ...base(),
    legacyId: "source:" + String(f.id),
    targetId: imported.id,
  });
  return imported;
}
export function migrate(ids: string[]) {
  const source = open(),
    report: { imported: string[]; skipped: string[]; warnings: string[] } = {
      imported: [],
      skipped: [],
      warnings: [],
    };
  try {
    source.exec("BEGIN");
    for (const id of ids) {
      if (all("migration").some((m) => m.legacyId === id)) {
        report.skipped.push(id);
        continue;
      }
      const old = source.prepare("SELECT * FROM threads WHERE id=?").get(id) as
        Row | undefined;
      if (!old)
        throw new Error("Selected legacy conversation no longer exists.");
      db().transaction(() => {
        const legacyProject = source
          .prepare("SELECT * FROM projects WHERE id=?")
          .get(old.project_id as string) as Row;
        let project = all("project").find(
          (p) => p.id === "legacy-" + String(old.project_id),
        );
        if (!project)
          project = put("project", {
            ...base("legacy-" + String(old.project_id)),
            name: String(legacyProject.name),
            objective: String(legacyProject.description || ""),
            briefId: null,
          });
        const thread = createThread(project.id, String(old.title));
        const fileMap = new Map<string, string>();
        const messages = source
          .prepare(
            "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at,rowid",
          )
          .all(id) as Row[];
        for (let index = 0; index < messages.length; index++) {
          const m = messages[index];
          let attachments: { fileId: string }[] = [];
          try {
            attachments = JSON.parse(String(m.attachments_json || "[]"));
          } catch {}
          const sourceIds: string[] = [];
          for (const attachment of attachments) {
            if (!fileMap.has(attachment.fileId)) {
              const f = source
                .prepare("SELECT * FROM files WHERE id=?")
                .get(attachment.fileId) as Row | undefined;
              if (!f) {
                report.warnings.push("Missing attachment record.");
                continue;
              }
              try {
                if (String(f.project_id) !== String(old.project_id))
                  throw new Error("Attachment belongs to another project.");
                const imported = importLegacyFile(f, project.id, thread.id);
                fileMap.set(attachment.fileId, imported.id);
              } catch {
                report.warnings.push(
                  `Could not import ${String(f.original_name)}. Original remains in the previous workbench.`,
                );
                continue;
              }
            }
            sourceIds.push(fileMap.get(attachment.fileId)!);
          }
          put("message", {
            ...base(),
            createdAt: Number.isFinite(Date.parse(String(m.created_at)))
              ? String(m.created_at)
              : new Date(
                  Date.parse(String(old.created_at)) + index,
                ).toISOString(),
            threadId: thread.id,
            role: ["user", "assistant", "system"].includes(String(m.role))
              ? (m.role as "user" | "assistant" | "system")
              : "user",
            content: String(m.content),
            status: ["complete", "failed", "cancelled"].includes(
              String(m.status),
            )
              ? (m.status as "complete" | "failed" | "cancelled")
              : "failed",
            sourceIds,
          });
        }
        const associated = source
          .prepare(
            "SELECT * FROM files WHERE project_id=? AND (thread_id=? OR thread_id IS NULL)",
          )
          .all(old.project_id as string, id) as Row[];
        for (const file of associated) {
          try {
            importLegacyFile(
              file,
              project.id,
              file.thread_id ? thread.id : null,
            );
          } catch {
            report.warnings.push(
              "Could not import " +
                String(file.original_name) +
                ". Original remains in the previous workbench.",
            );
          }
        }
        const completed = source
          .prepare(
            "SELECT id,question,output FROM synthesis_runs WHERE thread_id=? AND status='completed' AND output<>''",
          )
          .all(id) as Row[];
        for (const output of completed)
          put("output", {
            ...base(),
            projectId: project.id,
            threadId: thread.id,
            title: String(output.question || old.title).slice(0, 200),
            content: String(output.output),
            evidence: [],
            previousId: null,
          });
        const memories = source
          .prepare(
            "SELECT title,content FROM memories WHERE project_id=? AND status='accepted'",
          )
          .all(old.project_id as string) as Row[];
        if (
          memories.length &&
          !all("brief").some((b) => b.projectId === project!.id)
        )
          put("brief", {
            ...base(),
            projectId: project.id,
            content: memories
              .map((m) => `## ${String(m.title)}\n${String(m.content)}`)
              .join("\n\n"),
            previousId: null,
            evidence: [],
            status: "draft",
          });
        put(
          "thread",
          {
            ...thread,
            createdAt: String(old.created_at),
            updatedAt: String(old.updated_at),
            deletedAt: old.deleted_at ? String(old.deleted_at) : null,
            sourceIds: [],
          },
          true,
        );
        put("migration", { ...base(), legacyId: id, targetId: thread.id });
        report.imported.push(thread.id);
      })();
    }
    for (const mapping of all("migration").filter((m) =>
      ids.includes(m.legacyId),
    )) {
      const old = source
        .prepare("SELECT parent_thread_id FROM threads WHERE id=?")
        .get(mapping.legacyId) as Row | undefined;
      if (old?.parent_thread_id) {
        const parent = all("migration").find(
            (m) => m.legacyId === old.parent_thread_id,
          ),
          thread = get("thread", mapping.targetId);
        if (parent && thread)
          put("thread", { ...thread, parentId: parent.targetId }, true);
      }
    }
    source.exec("COMMIT");
    return report;
  } finally {
    source.close();
  }
}
export function transferConnection() {
  const root = path.join(legacyRoot(), "data");
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "config.json"), "utf8"),
  );
  const contents = fs.readFileSync(path.join(root, "secrets.env"), "utf8");
  let key = "";
  const encrypted = contents.match(/^AZURE_API_KEY_ENC=(.+)$/m);
  if (encrypted) {
    const bytes = Buffer.from(encrypted[1], "base64"),
      d = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(
          fs.readFileSync(path.join(root, ".secrets-key"), "utf8").trim(),
          "base64",
        ),
        bytes.subarray(0, 12),
      );
    d.setAuthTag(bytes.subarray(12, 28));
    key = Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString();
  } else {
    const encoded = contents.match(/^AZURE_API_KEY_B64=(.+)$/m);
    if (encoded) key = Buffer.from(encoded[1], "base64").toString();
  }
  if (!key)
    throw new Error(
      "No transferable local credential found. Enter the key in Settings.",
    );
  saveConnection(config.endpoint, key);
  const source = open();
  try {
    const models = source
      .prepare("SELECT name,protocol FROM deployments WHERE enabled=1")
      .all() as Row[];
    for (const m of models) {
      if (!all("model").some((existing) => existing.name === m.name))
        put("model", {
          ...base(),
          name: String(m.name),
          protocol: ["chat", "responses", "deepseek", "anthropic"].includes(
            String(m.protocol),
          )
            ? (m.protocol as "chat" | "responses" | "deepseek" | "anthropic")
            : "responses",
          image: false,
          pdf: false,
          verifiedAt: null,
          contextTokens: 128000,
        });
    }
  } finally {
    source.close();
  }
  return { transferred: true };
}
