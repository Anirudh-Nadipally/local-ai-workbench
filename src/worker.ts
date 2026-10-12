import { cleanupTemporaryChats } from "./server/temporary";
import { base, db, get, put } from "./server/db";
import { redact } from "./server/connections";
import { processJob, claimJob } from "./server/jobs";
const owner = crypto.randomUUID();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  db();
  cleanupTemporaryChats();
  let lastCleanup = Date.now();
  const heartbeat = setInterval(() => {
    put("health", { ...base("worker"), heartbeat: Date.now() });
    if (Date.now() - lastCleanup > 60000) {
      cleanupTemporaryChats();
      lastCleanup = Date.now();
    }
  }, 2000);
  put("health", { ...base("worker"), heartbeat: Date.now() });
  while (!stopping) {
    const job = claimJob(owner);
    if (job) {
      const lease = setInterval(() => {
        const current = get("job", job.id);
        if (
          current?.owner === owner &&
          current.state === "running" &&
          current.leaseUntil > Date.now()
        )
          put("job", { ...current, leaseUntil: Date.now() + 15000 });
      }, 4000);
      try {
        await processJob(job, () => stopping);
        const current = get("job", job.id);
        if (current?.owner === owner && current.state === "running")
          put("job", { ...current, state: "complete" });
      } catch (error) {
        const current = get("job", job.id);
        if (current?.owner === owner && current.state === "running")
          put("job", {
            ...current,
            state: "failed",
            error: redact(error),
          });
      } finally {
        clearInterval(lease);
      }
    } else await new Promise((r) => setTimeout(r, 400));
  }
  clearInterval(heartbeat);
}
void main().catch((error) => {
  console.error(redact(error));
  process.exitCode = 1;
});
