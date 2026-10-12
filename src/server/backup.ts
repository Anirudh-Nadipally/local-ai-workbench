import JSZip from "jszip";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { all, db, filePath, put } from "./db";
import { finishDraft } from "./drafts";
import { validateRecords } from "./record-validation";
import type { Records } from "@/domain/types";
const kinds = [
  "project",
  "brief",
  "thread",
  "message",
  "source",
  "snapshot",
  "generation",
  "output",
  "export",
  "migration",
  "draft",
] as const;
export async function backup() {
  const zip = new JSZip();
  const records = db().transaction(() => {
    const temporaryIds = new Set(
      all("thread")
        .filter((t) => t.temporary)
        .map((t) => t.id),
    );
    return Object.fromEntries(
      kinds.map((k) => [
        k,
        all(k).filter((item) =>
          k === "thread"
            ? !temporaryIds.has(item.id)
            : !(
                "threadId" in item &&
                item.threadId &&
                temporaryIds.has(item.threadId)
              ),
        ),
      ]),
    );
  })();
  zip.file("workbench.json", JSON.stringify({ version: 1, records }));
  for (const s of records.source as Records["source"][]) {
    if (fs.existsSync(filePath(s.storedName)))
      zip.file(
        "uploads/" + s.storedName,
        fs.readFileSync(filePath(s.storedName)),
      );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
const base = z
  .object({
    id: z.string().min(1).max(150),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export async function restore(bytes: Buffer) {
  if (bytes.length > 120 * 1024 * 1024)
    throw new Error("Backup exceeds 120 MB.");
  const zip = await JSZip.loadAsync(bytes);
  let expanded = 0;
  for (const item of Object.values(zip.files)) {
    const unsafe =
      (item as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ||
      item.name;
    if (
      unsafe.includes("..") ||
      unsafe.startsWith("/") ||
      unsafe.includes("\\")
    )
      throw new Error("Unsafe archive path.");
    const size =
      (item as unknown as { _data?: { uncompressedSize: number } })._data
        ?.uncompressedSize || 0;
    expanded += size;
    if (expanded > 300 * 1024 * 1024)
      throw new Error("Expanded backup is too large.");
  }
  const manifest = zip.file("workbench.json");
  if (!manifest) throw new Error("Not a Workbench backup.");
  const packet = z
    .object({
      version: z.literal(1),
      records: z.record(z.string(), z.array(base).max(50000)),
    })
    .parse(JSON.parse(await manifest.async("string")));
  for (const k of Object.keys(packet.records))
    if (!kinds.includes(k as (typeof kinds)[number]))
      throw new Error("Unknown backup record type.");
  packet.records = validateRecords(packet.records) as typeof packet.records;
  // Restore only to an empty workspace so references cannot replace existing content.
  if (kinds.some((k) => all(k).length))
    throw new Error(
      "Restore requires an empty workspace. Use selective migration for existing data.",
    );
  const staged: { name: string; bytes: Buffer }[] = [];
  for (const raw of packet.records.source || []) {
    const s = z
      .object({
        storedName: z.string(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().max(100 * 1024 * 1024),
      })
      .passthrough()
      .parse(raw);
    filePath(s.storedName);
    const member = zip.file("uploads/" + s.storedName);
    if (!member) throw new Error("Backup is missing an attachment.");
    const data = await member.async("nodebuffer");
    if (
      data.length !== s.size ||
      createHash("sha256").update(data).digest("hex") !== s.hash
    )
      throw new Error("Attachment verification failed.");
    if (!staged.some((f) => f.name === s.storedName))
      staged.push({ name: s.storedName, bytes: data });
  }
  for (const file of staged) {
    if (fs.existsSync(filePath(file.name)))
      throw new Error("Backup file conflicts with an existing file.");
  }
  try {
    for (const file of staged)
      fs.writeFileSync(filePath(file.name), file.bytes, {
        mode: 0o600,
        flag: "wx",
      });
    db().transaction(() => {
      if (kinds.some((k) => all(k).length))
        throw new Error("Workspace changed during restore.");
      for (const kind of kinds)
        for (const raw of packet.records[kind] || []) {
          const record = { ...raw };
          if (
            (kind === "generation" || kind === "draft") &&
            ["queued", "running"].includes(String(record.state))
          ) {
            record.state = "failed";
            record.error =
              "This task was incomplete at backup time. Partial work is saved; start a new draft to retry.";
          }
          if (
            kind === "message" &&
            ["queued", "streaming"].includes(String(record.status))
          )
            record.status = "failed";
          if (kind === "thread") record.modelId = "";
          if (
            kind === "source" &&
            ["queued", "processing"].includes(String(record.status))
          ) {
            record.status = "failed";
            record.error =
              "Processing was incomplete at backup time. Retry extraction.";
          }
          put(kind, record as Records[typeof kind]);
        }
      for (const original of packet.records.draft || []) {
        if (["queued", "running"].includes(String(original.state)))
          finishDraft(String(original.id));
      }
    })();
  } catch (error) {
    for (const file of staged) {
      try {
        fs.unlinkSync(filePath(file.name));
      } catch {}
    }
    throw error;
  }
  return { restored: true };
}
