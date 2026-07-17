import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSupportedFile, extractFile, MAX_FILE_BYTES, safeOriginalName } from "@/lib/files/extract";

describe("local parsers", () => {
  let directory = "";
  beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-parsers-")); });
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  async function fixture(name: string, content: string) { const file = path.join(directory, name); await fs.writeFile(file, content); return file; }

  it("extracts text, HTML, CSV, JSON, and JSONL", async () => {
    const inputs = [
      ["notes.md", "# Decision\nUse the local-first design."],
      ["page.html", "<html><head><script>bad()</script></head><body><h1>Useful</h1><p>Source text</p></body></html>"],
      ["rows.csv", "name,value\nalpha,42"],
      ["data.json", '{"answer":42}'],
      ["events.jsonl", '{"id":1}\n{"id":2}'],
    ] as const;
    for (const [name, content] of inputs) {
      const result = await extractFile(await fixture(name, content), name);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });
  it("reports malformed JSONL precisely", async () => {
    await expect(extractFile(await fixture("bad.jsonl", '{"ok":1}\nnope'), "bad.jsonl")).rejects.toThrow(/line 2/);
  });
  it("blocks unsupported, empty, and oversized files", () => {
    expect(() => assertSupportedFile("archive.zip", 10)).toThrow(/Unsupported/);
    expect(() => assertSupportedFile("empty.txt", 0)).toThrow(/empty/);
    expect(() => assertSupportedFile("huge.txt", MAX_FILE_BYTES + 1)).toThrow(/100 MB/);
  });
  it("blocks path traversal names", () => {
    expect(() => safeOriginalName("../secret.txt")).toThrow(/Unsafe/);
    expect(() => safeOriginalName("folder/secret.txt")).toThrow(/Unsafe/);
    expect(safeOriginalName("safe notes.txt")).toBe("safe notes.txt");
  });
});
