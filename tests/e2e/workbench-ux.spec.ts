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
];

async function mockConfiguredWorkbench(page: Page) {
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
      threads: [{ id: "thread-1", projectId: "project-1", title: "New conversation", summary: "", deploymentId: null, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }],
      deployments,
      files: [],
    }),
  }));
  await page.route("**/api/threads/thread-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      thread: { id: "thread-1", projectId: "project-1", title: "New conversation", summary: "", deploymentId: null, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" },
      messages: [],
      memories: [],
      candidates: [],
      receipt: null,
      runs: [],
    }),
  }));
}

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
  if (testInfo.project.name === "desktop") expect(bounds!.width).toBeGreaterThanOrEqual(700);
  else expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
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

  const composer = page.getByPlaceholder("Ask a question or work through an idea…");
  await composer.fill("Show me a visible pending state");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Show me a visible pending state")).toBeVisible();
  await expect(page.getByRole("status").getByText(/Connecting to DeepSeek-V4-Pro/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thinking..." })).toBeVisible();
  await expect(page.getByRole("status").getByText("Reasoning…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(composer).toHaveValue("Show me a visible pending state");
});
