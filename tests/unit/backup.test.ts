import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("backup and restore trust boundary", () => {
  let directory = "";
  let backup: typeof import("@/lib/backup");
  let config: typeof import("@/lib/config");
  let repository: typeof import("@/lib/repository");
  let uploadsDir = "";

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-backup-"));
    process.env.WORKBENCH_DATA_DIR = directory;
    vi.resetModules();
    config = await import("@/lib/config");
    repository = await import("@/lib/repository");
    backup = await import("@/lib/backup");
    uploadsDir = (await import("@/lib/paths")).UPLOADS_DIR;
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("round-trips local data without exporting secrets or activating restored jobs", async () => {
    config.saveConnection({
      endpoint: "https://example-resource.openai.azure.com/openai/v1",
      endpointKind: "azure-openai",
      apiKey: "local-test-secret",
    });
    const project = repository.createProject("Backup project");
    const thread = repository.createThread(project.id);
    repository.saveMessage({ threadId: thread.id, role: "user", content: "Searchable backup evidence" });
    const file = repository.createFile({
      projectId: project.id,
      threadId: thread.id,
      originalName: "evidence.txt",
      storedName: "00000000-0000-4000-8000-000000000001.txt",
      mimeType: "text/plain",
      sizeBytes: 8,
      sha256: "backup-file",
    }).file;
    await fs.writeFile(path.join(uploadsDir, file.storedName), "evidence", { mode: 0o600 });
    repository.replaceFileChunks(file.id, [{ content: "Searchable restored evidence", tokenEstimate: 4 }]);
    repository.updateFile(file.id, { status: "ready" });
    const job = repository.createJob("extract-file", { fileId: file.id });

    const archive = await backup.createBackupArchive();
    expect(archive.toString("utf8")).not.toContain("local-test-secret");
    const zip = await JSZip.loadAsync(archive);
    expect(zip.file("secrets.env")).toBeNull();
    expect(zip.file(".secrets-key")).toBeNull();

    await backup.restoreBackupArchive(archive);

    expect(repository.getProject(project.id)?.name).toBe("Backup project");
    expect(repository.getJob(String(job.id))?.status).toBe("cancelled");
    expect(repository.searchFileChunks([file.id], "restored evidence", 5)[0]?.content).toContain("Searchable");
    expect(await fs.readFile(path.join(uploadsDir, file.storedName), "utf8")).toBe("evidence");
    expect(config.getApiKey()).toBe("local-test-secret");
  });

  it("rejects restored traversal paths before changing live data", async () => {
    const existingProject = repository.createProject("Must survive failed restore");
    const archive = await backup.createBackupArchive();
    const zip = await JSZip.loadAsync(archive);
    const manifestFile = zip.file("workbench.json");
    expect(manifestFile).not.toBeNull();
    const manifest = JSON.parse(await manifestFile!.async("string")) as {
      tables: { files: Array<Record<string, unknown>> };
    };
    expect(manifest.tables.files.length).toBeGreaterThan(0);
    manifest.tables.files[0].stored_name = "../../outside.txt";
    zip.file("workbench.json", JSON.stringify(manifest));

    await expect(backup.restoreBackupArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(/unsafe stored file name/i);
    expect(repository.getProject(existingProject.id)?.name).toBe("Must survive failed restore");
  });

  it("does not let a backup replace the live Azure endpoint", async () => {
    const archive = await backup.createBackupArchive();
    const zip = await JSZip.loadAsync(archive);
    const manifestFile = zip.file("workbench.json")!;
    const manifest = JSON.parse(await manifestFile.async("string")) as { config: Record<string, unknown> };
    manifest.config.endpoint = "https://attacker.example/openai";
    manifest.config.endpointKind = "azure-openai";
    manifest.config.configured = true;
    manifest.config.hasCredential = true;
    zip.file("workbench.json", JSON.stringify(manifest));

    await backup.restoreBackupArchive(await zip.generateAsync({ type: "nodebuffer" }));

    expect(config.readConfig().endpoint).toBe("https://example-resource.openai.azure.com/openai/v1");
    expect(config.getApiKey()).toBe("local-test-secret");
  });
});
