import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { apiError, apiGuard } from "@/lib/api";
import { assertSupportedFile, MAX_BATCH_FILES, safeOriginalName } from "@/lib/files/extract";
import { assertProjectThread } from "@/lib/integrity";
import { UPLOADS_DIR } from "@/lib/paths";
import { createFile, createJob, getProject, listFiles, updateFile } from "@/lib/repository";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try { apiGuard(request); const projectId = new URL(request.url).searchParams.get("projectId"); if (!projectId) throw new Error("projectId is required."); return Response.json({ files: listFiles(projectId) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const form = await request.formData();
    const projectId = String(form.get("projectId") ?? "");
    const threadId = String(form.get("threadId") ?? "") || null;
    if (!projectId) throw new Error("Choose a project first.");
    if (threadId) assertProjectThread(projectId, threadId);
    else if (!getProject(projectId)) throw new Error("Project not found.");
    const uploads = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!uploads.length) throw new Error("Choose at least one file.");
    if (uploads.length > MAX_BATCH_FILES) throw new Error("Upload at most ten files at once.");
    await fs.mkdir(UPLOADS_DIR, { recursive: true, mode: 0o700 });

    const results = [];
    for (const upload of uploads) {
      const originalName = safeOriginalName(upload.name);
      assertSupportedFile(originalName, upload.size);
      const bytes = Buffer.from(await upload.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const storedName = `${crypto.randomUUID()}${path.extname(originalName).toLowerCase()}`;
      const extension = path.extname(originalName).toLowerCase();
      const inferredMimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
        : extension === ".png" ? "image/png"
          : extension === ".webp" ? "image/webp"
            : extension === ".gif" ? "image/gif"
              : extension === ".pdf" ? "application/pdf"
                : "application/octet-stream";
      const mimeType = upload.type || inferredMimeType;
      const created = createFile({ projectId, threadId, originalName, storedName, mimeType, sizeBytes: upload.size, sha256 });
      if (!created.duplicate) {
        try {
          await fs.writeFile(path.join(UPLOADS_DIR, storedName), bytes, { mode: 0o600 });
          createJob("extract-file", { fileId: created.file.id });
        } catch (error) {
          updateFile(created.file.id, { status: "failed", error: "The local file could not be stored." });
          throw error;
        }
      }
      results.push({ ...created.file, duplicate: created.duplicate });
    }
    return Response.json({ files: results });
  } catch (error) { return apiError(error); }
}
