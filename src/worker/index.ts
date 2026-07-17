import os from "node:os";
import { redactSecrets } from "@/lib/config";
import { extractFile } from "@/lib/files/extract";
import { resolveStoredUploadPath } from "@/lib/paths";
import { claimJob, getFile, getJob, renewJobLease, replaceFileChunks, updateFile, updateJob } from "@/lib/repository";
import { curateThreadMemory } from "@/lib/memory/curate";
import { executeSynthesis } from "@/lib/synthesis/engine";

const owner = `${os.hostname()}:${process.pid}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log("Local workbench worker ready.");

async function main() {
  while (!stopping) {
    const job = claimJob(owner);
    if (!job) {
      await sleep(800);
      continue;
    }
    const id = String(job.id);
    const heartbeat = setInterval(() => { renewJobLease(id, owner); }, 30_000);
    heartbeat.unref();
    try {
      const payload = JSON.parse(String(job.payload_json)) as Record<string, string>;
      if (job.type === "extract-file") await processFile(id, payload.fileId);
      else if (job.type === "curate-memory") await curateThreadMemory({ projectId: payload.projectId, threadId: payload.threadId, deployment: payload.deployment });
      else if (job.type === "synthesis") await executeSynthesis(payload.runId);
      else throw new Error(`Unknown job type: ${String(job.type)}`);
      if (getJob(id)?.status === "cancelled") continue;
      updateJob(id, { status: "completed", progress: 1, message: "Complete", error: null }, owner);
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : "Job failed.");
      updateJob(id, { status: "failed", message: "Failed", error: message }, owner);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

void main();

async function processFile(jobId: string, fileId: string) {
  const file = getFile(fileId);
  if (!file) throw new Error("Uploaded file not found.");
  updateFile(fileId, { status: "extracting", error: null });
  updateJob(jobId, { status: "running", progress: 0.15, message: "Extracting local text" }, owner);
  try {
    const extracted = await extractFile(resolveStoredUploadPath(file.storedName), file.originalName);
    updateJob(jobId, { status: "running", progress: 0.65, message: "Building searchable chunks" }, owner);
    replaceFileChunks(fileId, extracted.chunks);
    updateFile(fileId, { status: "ready", summary: extracted.summary, error: null });
  } catch (error) {
    updateFile(fileId, { status: "failed", error: error instanceof Error ? error.message : "Extraction failed." });
    throw error;
  }
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
