import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("secret encryption and redaction", () => {
  const original = process.env.WORKBENCH_DATA_DIR;
  afterEach(() => { process.env.WORKBENCH_DATA_DIR = original; vi.resetModules(); });
  it("stores authenticated ciphertext and redacts the live key", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-secret-"));
    process.env.WORKBENCH_DATA_DIR = directory;
    vi.resetModules();
    const config = await import("@/lib/config");
    config.writeApiKey("not-a-real-key-1234");
    config.writeConfig({});
    (await import("@/lib/db")).getSqlite();
    const stored = await fs.readFile(path.join(directory, "secrets.env"), "utf8");
    expect(stored).toContain("AZURE_API_KEY_ENC=");
    expect(stored).not.toContain("not-a-real-key-1234");
    expect(config.getApiKey()).toBe("not-a-real-key-1234");
    expect(config.redactSecrets("failure for not-a-real-key-1234")).toBe("failure for [REDACTED]");
    for (const name of ["config.json", "secrets.env", ".secrets-key", "workbench.db"]) {
      expect((await fs.stat(path.join(directory, name))).mode & 0o777).toBe(0o600);
    }
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    await fs.writeFile(path.join(directory, "secrets.env"), "AZURE_API_KEY_ENC=broken\n", { mode: 0o600 });
    expect(config.getApiKey()).toBe("");
    await fs.rm(directory, { recursive: true, force: true });
  });
});
