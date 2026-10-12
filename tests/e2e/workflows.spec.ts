import { test, expect } from "@playwright/test";
const transcript =
  "## User\nWe chose a local-first app. Keep the budget under $500.\n\n## Assistant\nAgreed. Next: validate document imports.\n\n```js\nconst budget = 500;\n```";
test("home, theme, navigation, and responsive layout", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good work starts with context." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "Close navigation", exact: true })
      .click();
  await page.screenshot({
    path: `docs/home-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("import preview preserves roles, commits, reloads, and exports", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Import a conversation", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Portable project context");
  await page.locator(".import-text").fill(transcript);
  await page.getByRole("button", { name: "Review import" }).click();
  await expect(
    page.getByText("2 messages recognized.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Portable project context",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".message-user")).toContainText(
    "budget under $500",
  );
  await page.reload();
  await expect(page.locator(".message-assistant")).toContainText(
    "const budget = 500;",
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByLabel("What should the next AI help you do?")
    .fill("Validate document imports");
  await page.getByRole("button", { name: "Build preview" }).click();
  await expect(page.locator(".export-preview")).toContainText(
    "Validate document imports",
  );
  await expect(page.locator(".export-preview")).toContainText(
    "const budget = 500;",
  );
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Export text" })
    .fill("# Reviewed handoff\n\nBudget: $500. Next: test PDFs.");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const file = await download;
  const content = await new Promise<string>(async (resolve, reject) => {
    const s = await file.createReadStream();
    if (!s) return reject();
    const chunks: Buffer[] = [];
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
  expect(content).toContain("Reviewed handoff");
  expect(content).not.toContain("Agreed. Next:");
});
test("project brief review is versioned and included in new conversations", async ({
  page,
}, info) => {
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByLabel("Project name").fill("Launch " + info.project.name);
  await page
    .getByLabel("What are you working toward?")
    .fill("Launch a focused local workbench.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Launch " + info.project.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-open/);
  await page.getByRole("button", { name: "Write a brief" }).click();
  await page
    .getByLabel("Proposed revision")
    .fill(
      "## Objective\nLaunch the app.\n\n## Accepted decisions\nBudget under $500.",
    );
  await page.getByRole("button", { name: "Accept revision" }).click();
  await expect(page.locator(".project-brief")).toContainText(
    "Budget under $500",
  );
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByRole("button", { name: /Context/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Project brief", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Project brief", exact: true })
    .uncheck();
  await page.reload();
  await page.getByRole("button", { name: /Context/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Project brief", exact: true }),
  ).not.toBeChecked();
});
test("real document upload is extracted by worker and selection persists", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/threads", {
    data: { title: "Document check" },
  });
  const thread = await response.json();
  await page.goto("/chat/" + thread.id);
  await page.locator("input[type=file]").setInputFiles({
    name: "evidence.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Evidence\nThe launch code is MARBLE-73."),
  });
  await expect(page.locator(".composer-sources")).toContainText("evidence.md");
  await page.getByRole("button", { name: /Context/ }).click();
  await expect(page.locator(".source-status")).toHaveText("ready", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".source-preview")).toContainText("MARBLE-73");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.locator(".composer-sources")).toContainText("evidence.md");
  await page
    .getByRole("button", { name: "Remove evidence.md", exact: true })
    .click();
  await expect(page.locator(".composer-sources")).not.toBeVisible();
});
test("saved output revisions and safe print export work", async ({
  page,
  request,
}) => {
  const imported = await request.post("/api/imports/commit", {
    data: {
      original: transcript,
      title: "Saved work",
      projectId: null,
      asSource: false,
      messages: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "## Result\n\nA useful answer." },
      ],
    },
  });
  const thread = await imported.json();
  await page.goto("/chat/" + thread.id);
  await page
    .getByRole("button", { name: "Save output", exact: true })
    .last()
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Launch summary");
  await page
    .getByRole("button", { name: "Save output", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Launch summary" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit output" }).click();
  await page
    .locator(".output-editor")
    .fill("## Final result\n\nThis is the revised output.");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("link", { name: "View previous revision" }),
  ).toBeVisible();
  await expect(page.locator(".output-document")).toContainText(
    "revised output",
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Build preview" }).click();
  await expect(page.locator(".export-preview")).toContainText("revised output");
  await expect(page.locator(".export-preview")).not.toContainText(
    "A useful answer.",
  );
});
test("trash restores without deleting original messages", async ({
  page,
  request,
}, info) => {
  const r = await request.post("/api/threads", {
    data: { title: "Recoverable " + info.project.name },
  });
  const thread = await r.json();
  await page.goto("/chat/" + thread.id);
  await page
    .getByRole("button", { name: "Move conversation to trash" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good work starts with context." }),
  ).toBeVisible();
  await page.goto("/settings#data");
  const row = page
    .locator(".trash-row")
    .filter({ hasText: "Recoverable " + info.project.name });
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(row).not.toBeVisible();
  const state = await (await request.get("/api/threads/" + thread.id)).json();
  expect(state.thread.deletedAt).toBeNull();
});

test("temporary chats survive refresh, stay out of history and can be ended or kept", async ({
  page,
  request,
}, info) => {
  await page.goto("/");
  await page
    .locator(".home-actions")
    .getByRole("button", { name: "Temporary chat", exact: true })
    .click();
  await expect(page.locator(".temporary-banner")).toContainText(
    "This chat is temporary",
  );
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("TEMPORARY-BROWSER-CONTEXT");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/threads/" + id)).json()).thread.draft,
    )
    .toBe("TEMPORARY-BROWSER-CONTEXT");
  await page.locator("input[type=file]").setInputFiles({
    name: "temporary-scratch.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("TEMPORARY-SOURCE-CONTEXT"),
  });
  await expect(page.locator(".composer-sources")).toContainText(
    "temporary-scratch.md",
  );
  const state = await (await request.get("/api/threads/" + id)).json();
  const sourceId = state.sources[0].id;
  const boot = await (await request.get("/api/boot")).json();
  expect(boot.threads.some((t: { id: string }) => t.id === id)).toBe(false);
  expect(boot.temporaryThreads.some((t: { id: string }) => t.id === id)).toBe(
    true,
  );
  expect(await (await request.get("/api/search?q=TEMPORARY")).json()).toEqual(
    [],
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("TEMPORARY-BROWSER-CONTEXT");
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `docs/temporary-chat-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "End & delete", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good work starts with context." }),
  ).toBeVisible();
  expect((await request.get("/api/threads/" + id)).status()).toBe(400);
  expect((await request.get("/api/sources/" + sourceId)).status()).toBe(400);
  await page
    .locator(".home-actions")
    .getByRole("button", { name: "Temporary chat", exact: true })
    .click();
  await expect(page.locator(".temporary-banner")).toBeVisible();
  const keepId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Keep chat", exact: true }).click();
  await expect(page.locator(".temporary-banner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
  const after = await (await request.get("/api/boot")).json();
  expect(after.threads.some((t: { id: string }) => t.id === keepId)).toBe(true);
});
