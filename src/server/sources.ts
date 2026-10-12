import { requireOpenChat } from "./temporary";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { all, base, db, put, filePath, required } from "./db";
import { assertSupportedFile, safeOriginalName } from "@/lib/files/extract";
export function addSource(
  name: string,
  bytes: Buffer,
  projectId: string | null,
  threadId: string | null,
) {
  return db().transaction(() => {
    safeOriginalName(name);
    assertSupportedFile(name, bytes.length);
    if (threadId) {
      const t = required("thread", threadId);
      requireOpenChat(t);
      if (t.projectId !== projectId)
        throw new Error("Project and conversation do not match.");
    } else if (projectId) required("project", projectId);
    else throw new Error("Choose a conversation or project.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const duplicate = all("source").find(
      (s) =>
        s.hash === hash && s.projectId === projectId && s.threadId === threadId,
    );
    if (duplicate) return duplicate;
    const ext = path.extname(name).toLowerCase();
    const mime =
      (
        {
          ".pdf": "application/pdf",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
        } as Record<string, string>
      )[ext] || "text/plain";
    const storedName = crypto.randomUUID() + ext;
    const record = {
      ...base(),
      projectId,
      threadId,
      name,
      mime,
      size: bytes.length,
      hash,
      storedName,
      status: "queued" as const,
      error: "",
      text: "",
      sections: [],
    };
    fs.writeFileSync(filePath(storedName), bytes, { mode: 0o600 });
    put("source", record);
    put("job", {
      ...base(),
      task: "extract",
      targetId: record.id,
      state: "queued",
      owner: "",
      leaseUntil: 0,
      error: "",
    });
    return record;
  })();
}
