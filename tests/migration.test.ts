import { beforeAll, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
let migrate: typeof import("../src/server/migration").migrate,
  preview: typeof import("../src/server/migration").migrationPreview,
  store: typeof import("../src/server/db");
let legacyFile: string;
beforeAll(async () => {
  const legacy = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-legacy-fixture-"),
  );
  process.env.WORKBENCH_LEGACY_DIR = legacy;
  process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-migration-"),
  );
  fs.mkdirSync(path.join(legacy, "data/uploads"), { recursive: true });
  legacyFile = path.join(legacy, "data/workbench.db");
  const db = new Database(legacyFile);
  db.exec(
    `CREATE TABLE projects(id TEXT,name TEXT,description TEXT);CREATE TABLE threads(id TEXT,title TEXT,project_id TEXT,parent_thread_id TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);CREATE TABLE messages(id TEXT,thread_id TEXT,role TEXT,content TEXT,status TEXT,attachments_json TEXT,created_at TEXT);CREATE TABLE files(id TEXT,project_id TEXT,thread_id TEXT,original_name TEXT,stored_name TEXT,sha256 TEXT);CREATE TABLE memories(title TEXT,content TEXT,project_id TEXT,status TEXT);CREATE TABLE synthesis_runs(id TEXT,thread_id TEXT,question TEXT,output TEXT,status TEXT);`,
  );
  db.prepare("INSERT INTO projects VALUES(?,?,?)").run(
    "p",
    "Legacy project",
    "Useful work",
  );
  const at = new Date().toISOString();
  db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?)").run(
    "a",
    "Original",
    "p",
    null,
    at,
    at,
    null,
  );
  db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?)").run(
    "b",
    "Branch",
    "p",
    "a",
    at,
    at,
    null,
  );
  const bytes = Buffer.from("Original evidence");
  fs.writeFileSync(path.join(legacy, "data/uploads/evidence.txt"), bytes);
  db.prepare("INSERT INTO files VALUES(?,?,?,?,?,?)").run(
    "f",
    "p",
    "a",
    "evidence.txt",
    "evidence.txt",
    createHash("sha256").update(bytes).digest("hex"),
  );
  db.prepare(
    "INSERT INTO messages(id,thread_id,role,content,status,attachments_json) VALUES(?,?,?,?,?,?)",
  ).run(
    "m",
    "a",
    "user",
    "Read the evidence",
    "complete",
    JSON.stringify([{ fileId: "f" }]),
  );
  db.prepare(
    "INSERT INTO messages(id,thread_id,role,content,status,attachments_json) VALUES(?,?,?,?,?,?)",
  ).run("m2", "b", "assistant", "Interrupted answer", "failed", "[]");
  db.prepare("INSERT INTO memories VALUES(?,?,?,?)").run(
    "Budget",
    "500",
    "p",
    "accepted",
  );
  db.prepare("INSERT INTO synthesis_runs VALUES(?,?,?,?,?)").run(
    "r",
    "a",
    "Final analysis",
    "Useful final result",
    "completed",
  );
  db.close();
  ({ migrate, migrationPreview: preview } =
    await import("../src/server/migration"));
  store = await import("../src/server/db");
});
it("copies all selected history without modifying legacy database", () => {
  const before = createHash("sha256")
    .update(fs.readFileSync(legacyFile))
    .digest("hex");
  const result = migrate(["a", "b"]);
  expect(result.imported).toHaveLength(2);
  expect(result.warnings).toEqual([]);
  expect(
    createHash("sha256").update(fs.readFileSync(legacyFile)).digest("hex"),
  ).toBe(before);
  expect(store.all("message")).toHaveLength(2);
  expect(store.all("source")).toHaveLength(1);
  expect(store.all("output")[0].content).toBe("Useful final result");
  expect(store.all("thread").find((t) => t.title === "Branch")?.parentId).toBe(
    store.all("thread").find((t) => t.title === "Original")?.id,
  );
  expect(
    store.all("message").find((m) => m.content === "Interrupted answer")
      ?.status,
  ).toBe("failed");
  expect(store.all("brief")[0].status).toBe("draft");
});
it("repeated migration does not duplicate conversations or files", () => {
  expect(migrate(["a", "b"]).skipped).toHaveLength(2);
  expect(store.all("thread")).toHaveLength(2);
  expect(store.all("source")).toHaveLength(1);
  expect(preview().threads.every((t) => "imported" in t && t.imported)).toBe(
    true,
  );
});

it("requires an explicit legacy folder instead of searching a personal path", () => {
  const previous = process.env.WORKBENCH_LEGACY_DIR;
  delete process.env.WORKBENCH_LEGACY_DIR;
  try {
    expect(preview()).toMatchObject({
      available: false,
      hasConnection: false,
      threads: [],
      error: expect.stringContaining("WORKBENCH_LEGACY_DIR"),
    });
  } finally {
    process.env.WORKBENCH_LEGACY_DIR = previous;
  }
});
