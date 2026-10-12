import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const provider = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../src/server/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/connections")>()),
  modelFor: () => provider.current,
}));
const enabled = process.env.WORKBENCH_BROWSER_TEST === "1";
const baseURL = "http://127.0.0.1:3042";
let server: ChildProcess,
  browser: Browser,
  logs = "";
let store: typeof import("../src/server/db"),
  jobs: typeof import("../src/server/jobs");
const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: {
      total: 12,
      noCache: 12,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 8, text: 4, reasoning: 4 },
  },
};

// The browser, API, SQLite, and job runner are real. Only the paid provider is replaced.
describe.skipIf(!enabled)("draft recovery in the browser", () => {
  beforeAll(async () => {
    process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "workbench-browser-"),
    );
    store = await import("../src/server/db");
    jobs = await import("../src/server/jobs");
    store.db();
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3042",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, WORKBENCH_DATA_DIR: store.dataDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (data) => {
      logs += data;
    });
    server.stderr?.on("data", (data) => {
      logs += data;
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(logs);
      try {
        ready = (await fetch(baseURL + "/api/health")).ok;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error(logs);
    browser = await chromium.launch({ headless: true });
  }, 60000);
  afterAll(async () => {
    await browser?.close();
    server?.kill("SIGTERM");
  });

  for (const mobile of [false, true])
    it(`survives dismissal, navigation, reload and immediate edit-close (${mobile ? "mobile" : "desktop"})`, async () => {
      const page = await browser.newPage({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const workspace = await import("../src/server/workspace");
      const model = store.put("model", {
        ...store.base(),
        name: "Browser test model " + (mobile ? "mobile" : "desktop"),
        protocol: "anthropic",
        image: false,
        pdf: false,
        verifiedAt: new Date().toISOString(),
        contextTokens: 128000,
        reasoning: { mode: "adaptive", efforts: ["high"], summary: true },
      });
      const project = store.put("project", {
        ...store.base(),
        name: "Portable decisions",
        objective: "Test a local-first launch",
        briefId: null,
      });
      const thread = workspace.createThread(
        project.id,
        "A handoff worth carrying forward",
      );
      store.put("thread", { ...thread, modelId: model.id });
      store.put("message", {
        ...store.base(),
        threadId: thread.id,
        role: "user",
        content:
          "Keep our launch local-first and under $500. Challenge the plan before implementation.",
        status: "complete",
        sourceIds: [],
      });
      store.put("health", { ...store.base("worker"), heartbeat: Date.now() });
      await page.goto(baseURL + "/chat/" + thread.id);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page
        .getByLabel("What should the next AI help you do?")
        .fill("Challenge the launch plan");
      await page.getByRole("button", { name: "Build preview" }).click();
      await page
        .getByLabel("Drafting model", { exact: true })
        .selectOption(model.id);
      await page.getByLabel("Reasoning effort").last().selectOption("high");
      await page
        .getByRole("button", { name: "Draft handoff", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: "Drafting your handoff" }),
      ).toBeVisible();
      const draft = store.all("draft").find((d) => d.threadId === thread.id)!;
      expect(draft.effort).toBe("high");
      const job = store.all("job").find((j) => j.targetId === draft.id)!;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fake = new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async start(controller) {
              controller.enqueue({ type: "reasoning-start", id: "r" });
              controller.enqueue({
                type: "reasoning-delta",
                id: "r",
                delta: "Checking budget and scope.",
              });
              controller.enqueue({ type: "reasoning-end", id: "r" });
              controller.enqueue({ type: "text-start", id: "t" });
              controller.enqueue({
                type: "text-delta",
                id: "t",
                delta: "# Continue the launch\n\n",
              });
              await gate;
              controller.enqueue({
                type: "text-delta",
                id: "t",
                delta:
                  "Keep the launch local-first, under $500. Challenge assumptions before implementing.\n\nThe user set the budget; implementation choices are still open.",
              });
              controller.enqueue({ type: "text-end", id: "t" });
              controller.enqueue(finish);
              controller.close();
            },
          }),
        }),
      });
      provider.current = fake;
      const work = jobs.processJob(job);
      try {
        await browserExpect(
          page.getByRole("button", { name: "Markdown", exact: true }),
        ).toBeDisabled();
        // Outside click closes the editor while the request continues.
        await page
          .locator(".modal-overlay")
          .click({ position: { x: 2, y: 2 }, force: true });
        await browserExpect(page.getByRole("dialog")).toHaveCount(0);
        await page.goto(baseURL + "/");
        await page.goto(baseURL + "/chat/" + thread.id);
        await page.getByRole("button", { name: "Export", exact: true }).click();
        await browserExpect(
          page.getByRole("heading", { name: "Drafting your handoff" }),
        ).toBeVisible();
        expect(fake.doStreamCalls).toHaveLength(1);
      } finally {
        release();
        await work;
      }
      await browserExpect(
        page.getByRole("heading", { name: "Review your export" }),
      ).toBeVisible();
      await browserExpect(page.locator(".export-preview")).toContainText(
        "under $500",
      );
      await page.locator(".run-details summary").click();
      await browserExpect(page.locator(".run-details")).toContainText(
        "Checking budget and scope.",
      );
      expect(fake.doStreamCalls[0].providerOptions).toEqual({
        anthropic: {
          effort: "high",
          thinking: { type: "adaptive", display: "summarized" },
        },
      });
      await page
        .getByRole("button", { name: "Edit text", exact: true })
        .click();
      await page
        .getByLabel("Export text")
        .fill(
          "# Reviewed handoff\n\nKeep the budget under $500. Compare two launch approaches.",
        );
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await browserExpect(page.locator(".export-preview")).toContainText(
        "Compare two launch approaches.",
      );
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: "Markdown", exact: true }).click();
      const download = await downloadEvent;
      const downloadedPath = await download.path();
      const downloaded = fs.readFileSync(downloadedPath!, "utf8");
      expect(downloaded).toContain("Compare two launch approaches.");
      expect(downloaded).not.toContain(draft.id);
      expect(downloaded).not.toContain(draft.exportId);
      await page.screenshot({
        path: `docs/handoff-${mobile ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Draft again", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop drafting", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: "Review your export" }),
      ).toBeVisible();
      expect(
        store.all("draft").find((d) => d.threadId === thread.id)?.state,
      ).toBe("cancelled");
      expect(fake.doStreamCalls).toHaveLength(1);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      // Brief drafting is recoverable as a proposal on the project page.
      await page.goto(baseURL + "/projects/" + project.id);
      await page
        .getByRole("button", { name: "Write a brief", exact: true })
        .click();
      await page
        .getByLabel("Drafting model", { exact: true })
        .selectOption(model.id);
      await page
        .getByRole("button", { name: "Draft proposed brief", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      const briefDraft = store
        .all("draft")
        .find((d) => d.projectId === project.id && d.kind === "brief")!;
      await jobs.processJob(
        store.all("job").find((j) => j.targetId === briefDraft.id)!,
      );
      await page.reload();
      const proposal = store.required(
        "brief",
        store.required("draft", briefDraft.id).proposalId!,
      );
      expect(proposal.status).toBe("draft");
      const row = page
        .locator(".proposal")
        .filter({ hasText: "Continue the launch" });
      await row.getByRole("button", { name: "Review", exact: true }).click();
      await page
        .getByLabel("Proposed revision")
        .fill("## Objective\nA reviewed local-first launch.");
      await page
        .getByRole("button", { name: "Accept revision", exact: true })
        .click();
      await browserExpect(page.locator(".project-brief")).toContainText(
        "A reviewed local-first launch.",
      );
      await page.goto(baseURL + "/settings#reasoning");
      const settings = page
        .locator(".model-entry")
        .filter({ hasText: model.name });
      await settings.locator("summary").click();
      await settings.getByLabel("Low", { exact: true }).check();
      await settings
        .getByRole("button", { name: "Save reasoning controls" })
        .click();
      await page.reload();
      expect(store.required("model", model.id).reasoning?.efforts).toContain(
        "low",
      );
      expect(errors).toEqual([]);
      await page.close();
    }, 60000);
  it("passes the existing desktop and mobile workflow suite", async () => {
    const worker = spawn(
      process.execPath,
      ["--import", "tsx", "src/worker.ts"],
      {
        env: { ...process.env, WORKBENCH_DATA_DIR: store.dataDir },
        stdio: "ignore",
      },
    );
    try {
      const result = await new Promise<{ code: number | null; output: string }>(
        (resolve, reject) => {
          const runner = spawn(
            process.execPath,
            ["node_modules/@playwright/test/cli.js", "test"],
            {
              env: {
                ...process.env,
                WORKBENCH_TEST_URL: baseURL,
                WORKBENCH_LIVE: "0",
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let output = "";
          runner.stdout.on("data", (chunk) => {
            output += chunk;
          });
          runner.stderr.on("data", (chunk) => {
            output += chunk;
          });
          runner.on("error", reject);
          runner.on("exit", (code) => resolve({ code, output }));
        },
      );
      expect(result.code, result.output).toBe(0);
    } finally {
      worker.kill("SIGTERM");
    }
  }, 120000);
});
