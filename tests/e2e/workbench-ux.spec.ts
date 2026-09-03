import { expect, test, type Page } from "@playwright/test";

const endpoint = "https://example-resource.services.ai.azure.com/api/projects/example-project";
const longKimiDeployment = "Kimi-K2.6-with-an-intentionally-long-deployment-name-to-exercise-wrapping";

const deployments = [
  {
    id: "deployment-pro",
    name: "DeepSeek-V4-Pro",
    modelName: "DeepSeek-V4-Pro",
    protocol: "deepseek",
    capabilities: { textGeneration: true, streaming: true, structuredOutput: false, lastProbeLatencyMs: 720 },
    enabled: true,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
  {
    id: "deployment-flash",
    name: "DeepSeek-V4-Flash",
    modelName: "DeepSeek-V4-Flash",
    protocol: "deepseek",
    capabilities: { textGeneration: true, streaming: true, structuredOutput: true, lastProbeLatencyMs: 410 },
    enabled: true,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
  {
    id: "deployment-kimi",
    name: longKimiDeployment,
    modelName: "Kimi-K2.6",
    protocol: "chat",
    capabilities: { textGeneration: true, streaming: true, structuredOutput: true, lastProbeLatencyMs: 630 },
    enabled: true,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
  {
    id: "deployment-claude",
    name: "claude-sonnet-5",
    modelName: "claude-sonnet-5",
    protocol: "anthropic",
    capabilities: { textGeneration: true, streaming: true, thinkingObserved: true, cacheObserved: true },
    enabled: true,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
  {
    id: "deployment-luna",
    name: "gpt-5.6-luna",
    modelName: "gpt-5.6-luna",
    protocol: "responses",
    capabilities: { textGeneration: true, streaming: true, imageInput: true, reasoning: true, reasoningEffort: true },
    enabled: true,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
];

const defaultThread = { id: "thread-1", projectId: "project-1", title: "New conversation", summary: "", deploymentId: null as string | null, deletedAt: null, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" };

async function mockConfiguredWorkbench(
  page: Page,
  messages: Array<Record<string, unknown>> = [],
  threads = [defaultThread],
  files: Array<Record<string, unknown>> = [],
  memories: Array<Record<string, unknown>> = [],
  generations: Array<Record<string, unknown>> = [],
) {
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      config: {
        configured: true,
        hasCredential: true,
        endpoint,
        endpointKind: "foundry-project",
        defaultProjectId: "project-1",
        chatDeployment: "DeepSeek-V4-Pro",
        memoryDeployment: "DeepSeek-V4-Flash",
        branchDeployment: "DeepSeek-V4-Flash",
        criticDeployment: "DeepSeek-V4-Pro",
        synthesisDeployment: longKimiDeployment,
        mapperDeployment: longKimiDeployment,
        alternativeDeployment: "DeepSeek-V4-Flash",
        adversarialDeployment: "DeepSeek-V4-Pro",
        evidenceDeployment: longKimiDeployment,
        refinementDeployment: "DeepSeek-V4-Pro",
        reasoningEffort: "medium",
      },
      projects: [{ id: "project-1", name: "Personal workbench", description: "", instructions: "", createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }],
      threads,
      deployments,
      files,
    }),
  }));
  await page.route("**/api/threads/thread-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      thread: defaultThread,
      messages,
      memories,
      candidates: [],
      generations,
      receipt: null,
      runs: [],
    }),
  }));
}

async function selectExistingFile(page: Page, name: string) {
  await page.getByRole("button", { name: "Toggle context" }).click();
  await page.getByRole("checkbox", { name: `Select ${name}` }).check();
  await page.keyboard.press("Escape");
}

test("visual attachments stay direct by default and expose explicit Azure preparation", async ({ page }) => {
  const claudeThread = { ...defaultThread, deploymentId: "claude-sonnet-5" };
  const image = {
    id: "file-image", projectId: "project-1", threadId: "thread-1", originalName: "strategy-screen.png", storedName: "strategy-screen.png",
    mimeType: "image/png", sizeBytes: 2400, status: "ready", error: null, summary: "Image ready for direct visual analysis.", sha256: "image-hash",
    createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z",
  };
  await mockConfiguredWorkbench(page, [], [claudeThread], [image]);
  await page.goto("/");
  const main = page.getByRole("main");

  await selectExistingFile(page, "strategy-screen.png");
  await expect(main.getByText("strategy-screen.png", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Direct", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Luna", exact: true })).toBeEnabled();
  await main.getByRole("button", { name: "Luna", exact: true }).click();
  await expect(main.getByRole("button", { name: "Luna", exact: true })).toHaveClass(/bg-background/);
  const accepted = await page.locator('input[type="file"]').first().getAttribute("accept");
  expect(accepted).toContain(".png");
});

test("large JSON stays visible and the current V4 preparation choice reaches the chat request", async ({ page }) => {
  const claudeThread = { ...defaultThread, deploymentId: "claude-sonnet-5" };
  const json = {
    id: "file-json", projectId: "project-1", threadId: "thread-1", originalName: "azure-cost-analysis.json", storedName: "azure-cost-analysis.json",
    mimeType: "application/json", sizeBytes: 354489, status: "ready", error: null, summary: "Large Azure cost export.", sha256: "json-hash",
    createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z",
  };
  let requestBody: Record<string, unknown> | null = null;
  await mockConfiguredWorkbench(page, [], [claudeThread], [json]);
  await page.route("**/api/chat", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Verification stop" }) });
  });
  await page.goto("/");
  const main = page.getByRole("main");

  await selectExistingFile(page, "azure-cost-analysis.json");
  await expect(main.getByText("azure-cost-analysis.json", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "V4 Flash", exact: true }).click();
  await expect(main.getByRole("button", { name: "V4 Flash", exact: true })).toHaveClass(/bg-background/);
  await main.getByRole("button", { name: "Reasoning effort: Medium" }).click();
  await page.getByRole("menuitemradio", { name: /High/ }).click();
  await page.getByPlaceholder("Ask about the attached source…").fill("What does this file contain?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => requestBody).not.toBeNull();
  const sentBody = requestBody as unknown as { attachments: unknown; reasoningEffort: string };
  expect(sentBody.attachments).toEqual([{ fileId: "file-json", mode: "prepare-text", preparationDeployment: "DeepSeek-V4-Flash" }]);
  expect(sentBody.reasoningEffort).toBe("high");
});

test("historical user messages keep only their own attachment chips", async ({ page }) => {
  const userMessages = [{
    id: "question-with-json", threadId: "thread-1", role: "user", content: "What does this file contain?", status: "complete",
    attachments: [{ fileId: "file-json", originalName: "azure-cost-analysis.json", mimeType: "application/json", sizeBytes: 354489, mode: "direct" }],
    createdAt: "2026-06-24T00:00:00.000Z",
  }, {
    id: "question-without-file", threadId: "thread-1", role: "user", content: "Now answer without a file.", status: "complete", attachments: [],
    createdAt: "2026-06-24T00:01:00.000Z",
  }];
  await mockConfiguredWorkbench(page, userMessages);
  await page.goto("/");

  const attachmentRows = page.getByLabel("1 attachment on this message");
  await expect(attachmentRows).toHaveCount(1);
  await expect(attachmentRows.getByText("azure-cost-analysis.json", { exact: true })).toBeVisible();
  await expect(page.getByText("For your next message")).toHaveCount(0);
});

test("file chooser and page drop both create visible composer attachments", async ({ page }) => {
  const uploaded: Array<Record<string, unknown>> = [];
  await mockConfiguredWorkbench(page);
  await page.route("**/api/files**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: uploaded }) });
      return;
    }
    const index = uploaded.length;
    const image = index === 0;
    const file = {
      id: `uploaded-${index + 1}`, projectId: "project-1", threadId: "thread-1", originalName: image ? "board.png" : "notes.json", storedName: image ? "board.png" : "notes.json",
      mimeType: image ? "image/png" : "application/json", sizeBytes: 32, status: "ready", error: null, summary: "Ready", sha256: `upload-${index + 1}`,
      createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z",
    };
    uploaded.unshift(file);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [file] }) });
  });
  await page.goto("/");
  const main = page.getByRole("main");

  await page.getByLabel("Choose files or images").setInputFiles({ name: "board.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(main.getByText("board.png", { exact: true })).toBeVisible();

  await page.locator(".workbench-shell").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{"cost":1300}'], "notes.json", { type: "application/json" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(main.getByText("notes.json", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "V4 Flash", exact: true })).toBeVisible();
});

test("memory is opt-in and generation receipts expose cache and thinking", async ({ page }) => {
  const assistant = { id: "answer-receipt", threadId: "thread-1", role: "assistant", content: "A verified answer.", status: "complete", createdAt: "2026-06-24T00:01:00.000Z" };
  const memory = {
    id: "memory-1", projectId: "project-1", threadId: "thread-1", type: "preference", title: "Concise outputs", content: "Prefer concise explanations.",
    scope: "conversation", status: "accepted", sensitivity: "normal", confidence: 1, explicit: true, evidence: [], supersedesId: null,
    createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z",
  };
  const generation = {
    id: "generation-1", messageId: "answer-receipt", threadId: "thread-1", deploymentId: "claude-sonnet-5", status: "complete", stage: "response",
    settings: { reasoningEffort: "medium" }, inputTokens: 2873, outputTokens: 1898, uncachedInputTokens: 2, cacheReadTokens: 1939,
    cacheWriteTokens: 932, thinkingTokens: 748, cacheStatus: "hit", durationMs: 2788, finishReason: "stop", error: null,
    providerMetadata: {}, contextReceiptId: "receipt-1", startedAt: "2026-06-24T00:00:00.000Z", completedAt: "2026-06-24T00:00:03.000Z",
  };
  const preparation = {
    id: "generation-prep", messageId: null, threadId: "thread-1", deploymentId: "DeepSeek-V4-Flash", status: "complete", stage: "attachment-preparation",
    settings: { parentGenerationId: "generation-1", fileName: "strategy.json" }, inputTokens: 26178, outputTokens: 3277, uncachedInputTokens: 26178,
    cacheReadTokens: 0, cacheWriteTokens: 0, thinkingTokens: 0, cacheStatus: "not-reported", durationMs: 31576, finishReason: "stop", error: null,
    providerMetadata: {}, outputText: "## Current state\nThe decision remains unresolved.", contextReceiptId: null, startedAt: "2026-06-24T00:00:00.000Z", completedAt: "2026-06-24T00:00:31.000Z",
  };
  await mockConfiguredWorkbench(page, [assistant], [defaultThread], [], [memory], [generation, preparation]);
  await page.goto("/");

  await expect(page.getByText("1.9K reused")).toBeVisible();
  await expect(page.getByText("Cache read")).not.toBeVisible();
  await page.getByText("1.9K reused").click();
  await expect(page.getByText("Cache read")).toBeVisible();
  await expect(page.getByText("748", { exact: true })).toBeVisible();
  await page.getByText("strategy.json", { exact: true }).click();
  await expect(page.getByText("The decision remains unresolved.")).toBeVisible();

  await page.getByRole("button", { name: "Toggle context" }).click();
  await page.getByRole("tab", { name: "Memory" }).click();
  await page.getByRole("checkbox", { name: "Use Concise outputs in the next message" }).check();
  await expect(page.getByText(/tokens selected/)).not.toHaveText("~0 tokens selected");
});

test("editing a user message rewrites the current conversation from that turn", async ({ page }) => {
  const messages = [
    { id: "branch-q1", threadId: "thread-1", role: "user", content: "Compare the plans", status: "complete", attachments: [], createdAt: "2026-06-24T00:00:00.000Z" },
    { id: "branch-a1", threadId: "thread-1", role: "assistant", content: "Plan A is safer.", status: "complete", attachments: [], createdAt: "2026-06-24T00:01:00.000Z" },
    { id: "branch-q2", threadId: "thread-1", role: "user", content: "What about price?", status: "complete", attachments: [], createdAt: "2026-06-24T00:02:00.000Z" },
  ];
  let chatBody: Record<string, unknown> | null = null;
  let branchRequests = 0;
  await mockConfiguredWorkbench(page, messages);
  await page.route("**/api/threads", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    branchRequests += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Branch should not be created" }) });
  });
  await page.route("**/api/chat", async (route) => {
    chatBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Verification stop" }) });
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Edit message" }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Branch from here" }).last()).toBeVisible();
  await expect(page.getByText("Edit", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Branch", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Edit message" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit message" });
  await expect(dialog.getByText(/removes 2 later messages/)).toBeVisible();
  await dialog.getByLabel("Revised message").fill("Compare total cost and risk");
  await dialog.getByRole("button", { name: "Update & regenerate" }).click();

  await expect.poll(() => chatBody).not.toBeNull();
  expect(chatBody).toMatchObject({ threadId: "thread-1", editedMessageId: "branch-q1" });
  expect((chatBody as unknown as { messages: Array<{ id: string }> }).messages.map((message) => message.id)).toEqual(["branch-q1"]);
  expect(branchRequests).toBe(0);
  await expect(page.getByText("Compare total cost and risk", { exact: true })).toBeVisible();
  await expect(page.getByText("What about price?", { exact: true })).toHaveCount(0);
});

test("branch remains a separate non-destructive action", async ({ page }) => {
  const messages = [
    { id: "branch-only-q1", threadId: "thread-1", role: "user", content: "Compare the plans", status: "complete", attachments: [], createdAt: "2026-06-24T00:00:00.000Z" },
    { id: "branch-only-a1", threadId: "thread-1", role: "assistant", content: "Plan A is safer.", status: "complete", attachments: [], createdAt: "2026-06-24T00:01:00.000Z" },
  ];
  const branchThread = { ...defaultThread, id: "thread-branch", title: "New conversation · branch", parentThreadId: "thread-1", branchFromMessageId: "branch-only-a1" };
  let branchBody: Record<string, unknown> | null = null;
  await mockConfiguredWorkbench(page, messages);
  await page.route("**/api/threads/thread-branch", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ thread: branchThread, messages, memories: [], candidates: [], generations: [], receipt: null, runs: [] }),
  }));
  await page.route("**/api/threads", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    branchBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ thread: branchThread }) });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Branch from here" }).last().click();
  await expect.poll(() => branchBody).not.toBeNull();
  expect(branchBody).toMatchObject({ projectId: "project-1", branchFrom: { threadId: "thread-1", messageId: "branch-only-a1", includeMessage: true } });
  await expect(page.locator("header").getByText("Branch", { exact: true })).toBeVisible();
});

test("two-stage requests show honest preparation progress before the final model streams", async ({ page }) => {
  const kimiThread = { ...defaultThread, deploymentId: longKimiDeployment };
  const json = {
    id: "file-json", projectId: "project-1", threadId: "thread-1", originalName: "advising-history.json", storedName: "advising-history.json",
    mimeType: "application/json", sizeBytes: 354489, status: "ready", error: null, summary: "Long transcript.", sha256: "progress-json-hash",
    createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z",
  };
  const parent = {
    id: "generation-live", messageId: null, threadId: "thread-1", deploymentId: longKimiDeployment, status: "streaming", stage: "response",
    settings: { reasoningEffort: "medium" }, inputTokens: null, outputTokens: null, uncachedInputTokens: null, cacheReadTokens: null,
    cacheWriteTokens: null, thinkingTokens: null, cacheStatus: null, durationMs: null, finishReason: null, error: null, providerMetadata: {}, outputText: "", contextReceiptId: null,
    startedAt: new Date(Date.now() - 4_000).toISOString(), completedAt: null,
  };
  const preparation = {
    ...parent, id: "generation-live-prep", deploymentId: "DeepSeek-V4-Flash", stage: "attachment-preparation",
    settings: { parentGenerationId: "generation-live", fileName: "advising-history.json" },
  };
  await mockConfiguredWorkbench(page, [], [kimiThread], [json], [], [parent, preparation]);
  await page.route("**/api/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Verification stop" }) });
  });
  await page.goto("/");
  await selectExistingFile(page, "advising-history.json");
  await page.getByRole("button", { name: "V4 Flash", exact: true }).click();
  await page.getByPlaceholder("Ask about the attached source…").fill("Preserve the full decision state.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Preparing your source")).toBeVisible();
  await expect(page.getByText("advising-history.json · DeepSeek-V4-Flash")).toBeVisible();
  await expect(page.getByText(new RegExp(`${longKimiDeployment} answers after preparation`))).toBeVisible();
  await expect(page.getByText("Thinking tokens appear only when the provider reports them.", { exact: false })).toBeVisible();
});

async function openSettings(page: Page) {
  const navigationButton = page.getByRole("button", { name: "Open navigation" });
  if (await navigationButton.isVisible()) await navigationButton.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test("settings is a single smooth, overflow-safe model workspace", async ({ page }, testInfo) => {
  await mockConfiguredWorkbench(page);
  await page.goto("/");
  await openSettings(page);

  const dialog = page.getByRole("dialog", { name: "Settings" });
  const overflow = await dialog.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.clientHeight).toBeLessThanOrEqual(page.viewportSize()!.height * 0.92);
  await expect(dialog.getByText(endpoint)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /add model/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /sync/i })).toBeVisible();

  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (testInfo.project.name === "desktop") expect(bounds!.width).toBeGreaterThanOrEqual(680);
  else expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
});

test("answer text size has three device-local choices", async ({ page }, testInfo) => {
  const assistant = { id: "answer-size", threadId: "thread-1", role: "assistant", content: "Readable answer text", status: "complete", attachments: [], createdAt: "2026-06-24T00:01:00.000Z" };
  await mockConfiguredWorkbench(page, [assistant]);
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("tab", { name: "Appearance" }).click();

  const sizes = page.getByRole("radiogroup", { name: "Answer text size" });
  await expect(sizes.getByRole("radio")).toHaveCount(3);
  await sizes.getByRole("radio", { name: "Large" }).click();
  await expect(sizes.getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Readable answer text", { exact: true })).toHaveCSS("font-size", testInfo.project.name === "mobile" ? "17px" : "18px");

  await page.reload();
  await openSettings(page);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
});

test("chat keeps visible activity from submit through provider failure", async ({ page }) => {
  await mockConfiguredWorkbench(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          window.setTimeout(() => {
            controller.enqueue(encoder.encode('data: {"type":"reasoning-start","id":"reasoning-1"}\n\n'));
          }, 450);
          window.setTimeout(() => {
            controller.enqueue(encoder.encode('data: {"type":"error","errorText":"Mock provider unavailable"}\n\n'));
            controller.close();
          }, 1_250);
        },
      }), {
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      });
    };
  });
  await page.goto("/");

  const composer = page.getByPlaceholder("Message a model…");
  await composer.fill("Show me a visible pending state");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Show me a visible pending state")).toBeVisible();
  await expect(page.getByRole("status").getByText(/Connecting to DeepSeek-V4-Pro/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thinking..." })).toBeVisible();
  await expect(page.getByRole("status").getByText("Reasoning details are arriving")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(composer).toHaveValue("Show me a visible pending state");
});

test("desktop sidebar collapses to a persistent compact rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop navigation only");
  await mockConfiguredWorkbench(page);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("local-ai-workbench:sidebar-collapsed") === null) {
      window.localStorage.setItem("local-ai-workbench:sidebar-collapsed", "false");
    }
  });
  await page.goto("/");

  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeVisible();
  const expanded = await collapse.locator("xpath=ancestor::aside").boundingBox();
  expect(expanded?.width).toBeLessThanOrEqual(260);

  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toBeVisible();
  await expect.poll(async () => (await expand.locator("xpath=ancestor::aside").boundingBox())?.width).toBeLessThanOrEqual(64);

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("composer is one compact row at rest and expands only with content", async ({ page }) => {
  await mockConfiguredWorkbench(page);
  await page.goto("/");

  const composer = page.getByPlaceholder("Message a model…");
  const shell = page.locator("form.composer-shell");
  const rest = await shell.boundingBox();
  expect(rest?.height).toBeLessThanOrEqual(58);

  await composer.fill(Array.from({ length: 7 }, (_, index) => `A detailed line ${index + 1}`).join("\n"));
  await expect.poll(async () => (await shell.boundingBox())?.height).toBeGreaterThan(rest!.height + 48);
});

test("whole Markdown file fences render as a document instead of giant code panels", async ({ page }) => {
  await mockConfiguredWorkbench(page, [{
    id: "message-markdown-file",
    threadId: "thread-1",
    role: "assistant",
    content: [
      "Here is the file.",
      "",
      "```markdown",
      "# General Relativity",
      "",
      "```",
      "G_μν = 8πT_μν",
      "```",
      "",
      "## Notes",
      "- Curved spacetime",
      "```",
      "",
      "You can export it.",
    ].join("\n"),
    status: "complete",
    createdAt: "2026-06-24T00:00:00.000Z",
  }]);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "General Relativity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.locator('[data-streamdown="code-block"]')).toHaveCount(1);
  await expect(page.getByText("Curved spacetime", { exact: false })).toBeVisible();
});

test("assistant Markdown renders tables, lists, links, and code without redundant controls", async ({ page }) => {
  await mockConfiguredWorkbench(page, [{
    id: "message-assistant-markdown",
    threadId: "thread-1",
    role: "assistant",
    content: [
      "## Results",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      "| Cost | ₹50 |",
      "| Status | Ready |",
      "",
      "- First item",
      "- Second item",
      "",
      "[Azure documentation](https://learn.microsoft.com/azure)",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n"),
    status: "complete",
    createdAt: "2026-06-24T00:00:00.000Z",
  }]);
  await page.goto("/");

  await expect(page.locator('[data-streamdown="table"]')).toBeVisible();
  await expect(page.locator('[data-streamdown="table"] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-streamdown="unordered-list"] li')).toHaveCount(2);
  await expect(page.locator('[data-streamdown="link"]', { hasText: "Azure documentation" })).toBeVisible();
  await expect(page.locator('[data-streamdown="code-block"]')).toBeVisible();
  await expect(page.getByText("const answer = 42;", { exact: false })).toBeVisible();

  await expect(page.getByTitle("Copy table")).toHaveCount(1);
  await expect(page.getByTitle("Copy Code")).toHaveCount(1);
  await expect(page.getByTitle("Download table")).toHaveCount(0);
  await expect(page.getByTitle("Download table as CSV")).toHaveCount(0);
  await expect(page.getByTitle("Download file")).toHaveCount(0);
  await expect(page.getByTitle("View fullscreen")).toHaveCount(0);
});

test("selective Markdown export downloads only the requested message roles", async ({ page }) => {
  await mockConfiguredWorkbench(page, [
    { id: "question-1", threadId: "thread-1", role: "user", content: "What changed?", status: "complete", createdAt: "2026-06-24T00:00:00.000Z" },
    { id: "answer-1", threadId: "thread-1", role: "assistant", content: "| Item | State |\n| --- | --- |\n| Export | Ready |", status: "complete", createdAt: "2026-06-24T00:01:00.000Z" },
  ]);
  await page.goto("/");

  await page.getByRole("button", { name: "Export selected messages as Markdown" }).click();
  const dialog = page.getByRole("dialog", { name: "Export conversation" });
  await dialog.getByRole("button", { name: "Questions", exact: true }).click();
  await expect(dialog.getByText("1 of 2 selected")).toBeVisible();

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download .md" }).click();
  expect((await download).suggestedFilename()).toBe("new-conversation.md");
});

test("conversation management moves multiple selections to recoverable trash", async ({ page }) => {
  const secondThread = { ...defaultThread, id: "thread-2", title: "Research notes", createdAt: "2026-06-24T00:02:00.000Z", updatedAt: "2026-06-24T00:02:00.000Z" };
  await mockConfiguredWorkbench(page, [], [defaultThread, secondThread]);
  const actions: string[] = [];
  await page.route("**/api/threads?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.searchParams.get("trashed") === "1") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ threads: [{ ...secondThread, deletedAt: "2026-06-24T01:00:00.000Z" }] }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/threads", async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    const body = route.request().postDataJSON() as { action: string };
    actions.push(body.action);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ changed: 1 }) });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");

  const navigationButton = page.getByRole("button", { name: "Open navigation" });
  if (await navigationButton.isVisible()) await navigationButton.click();
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByRole("checkbox", { name: "Select Research notes" }).check();
  await page.getByRole("button", { name: "Move (1)" }).click();
  await expect(page.getByText("Research notes", { exact: true })).toHaveCount(0);
  expect(actions).toContain("trash");
});
