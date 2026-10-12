import fs from "node:fs";
import type { Thread } from "@/domain/types";
import { all, db, filePath, get, put, required } from "./db";

export const TEMPORARY_LIFETIME = 24 * 60 * 60 * 1000;
export function temporaryExpiry(now = Date.now()) {
  return new Date(now + TEMPORARY_LIFETIME).toISOString();
}
export function requireSavedChat(thread: Thread) {
  if (thread.temporary)
    throw new Error(
      "Keep this temporary chat first to save, export, or branch its work.",
    );
}
export function requireOpenChat(thread: Thread) {
  if (
    thread.temporary &&
    (!thread.expiresAt || Date.parse(thread.expiresAt) <= Date.now())
  )
    throw new Error("This temporary chat has expired.");
}

// Ending a temporary chat revokes job ownership before removing its data.
// An in-flight worker must not recreate records after cleanup.
export function deleteTemporaryChat(id: string, expiredBefore?: number) {
  const marked = db().transaction(() => {
    const current = get("thread", id);
    if (!current) return false;
    if (
      expiredBefore !== undefined &&
      (!current.temporary ||
        (current.expiresAt && Date.parse(current.expiresAt) > expiredBefore))
    )
      return false;
    if (!current.temporary)
      throw new Error("Only temporary chats can be ended here.");
    // Keep an expired tombstone if filesystem cleanup fails, so cleanup can retry.
    put("thread", { ...current, expiresAt: new Date(0).toISOString() });
    return true;
  })();
  if (!marked) return { deleted: true };
  db().transaction(() => {
    const thread = get("thread", id);
    if (!thread) return;
    if (!thread.temporary)
      throw new Error("Only temporary chats can be ended here.");
    const sources = all("source").filter((s) => s.threadId === id);
    const targetIds = new Set([
      ...sources.map((s) => s.id),
      ...all("generation")
        .filter((g) => g.threadId === id)
        .map((g) => g.id),
      ...all("draft")
        .filter((d) => d.threadId === id)
        .map((d) => d.id),
    ]);
    const remove = (kind: string, recordId: string) => {
      db()
        .prepare("DELETE FROM search_index WHERE kind=? AND id=?")
        .run(kind, recordId);
      db()
        .prepare("DELETE FROM records WHERE kind=? AND id=?")
        .run(kind, recordId);
    };
    for (const source of sources) {
      if (
        all("source").some(
          (s) => s.threadId !== id && s.storedName === source.storedName,
        )
      )
        continue;
      try {
        fs.unlinkSync(filePath(source.storedName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const job of all("job"))
      if (targetIds.has(job.targetId)) remove("job", job.id);
    for (const kind of [
      "message",
      "source",
      "snapshot",
      "generation",
      "draft",
      "export",
      "output",
    ] as const)
      for (const item of all(kind))
        if (item.threadId === id) remove(kind, item.id);
    remove("thread", id);
  })();
  return { deleted: true };
}

export function cleanupTemporaryChats(now = Date.now()) {
  for (const thread of all("thread"))
    if (
      thread.temporary &&
      (!thread.expiresAt || Date.parse(thread.expiresAt) <= now)
    )
      deleteTemporaryChat(thread.id, now);
}

export function keepTemporaryChat(id: string) {
  return db().transaction(() => {
    const thread = required("thread", id);
    requireOpenChat(thread);
    const saved = put("thread", {
      ...thread,
      temporary: false,
      expiresAt: undefined,
    });
    // Temporary content was never indexed. Index it only after explicit Keep.
    for (const kind of ["message", "source"] as const)
      for (const item of all(kind))
        if (item.threadId === id) put(kind, item, true);
    return saved;
  })();
}
