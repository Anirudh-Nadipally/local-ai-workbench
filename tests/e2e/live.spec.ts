import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { probePdf } from "../../src/server/probes";
test("live model receives approved brief, document, original PDF, and image", async ({
  page,
  request,
}, info) => {
  test.skip(
    process.env.WORKBENCH_LIVE !== "1" || info.project.name !== "desktop",
    "Explicit live validation only.",
  );
  test.setTimeout(240000);
  if (process.env.WORKBENCH_LEGACY_DIR) {
    const transfer = await request.post("/api/migration/connection", {
      data: {},
    });
    expect(transfer.ok()).toBe(true);
  }
  const modelName = process.env.WORKBENCH_TEST_MODEL;
  expect(modelName, "Set WORKBENCH_TEST_MODEL to the deployment to test.").toBeTruthy();
  const boot = await (await request.get("/api/boot")).json();
  const model = boot.models.find(
    (m: { name: string }) => m.name === modelName,
  );
  expect(model).toBeTruthy();
  for (const capability of ["probe", "image", "pdf"]) {
    if (capability === "probe" ? model.verifiedAt : model[capability]) continue;
    const response = await request.post(
      "/api/models/" + model.id + "/" + capability,
      { data: {}, timeout: 90000 },
    );
    expect(await response.text(), capability).not.toContain('"error"');
  }
  const project = await (
    await request.post("/api/projects", {
      data: { name: "Live validation", objective: "Verify portable context." },
    })
  ).json();
  const accepted = await request.post("/api/briefs", {
    data: {
      projectId: project.id,
      content: "## Accepted decision\nThe project budget ceiling is $500.",
      previousId: null,
      evidence: [],
      accept: true,
    },
  });
  expect(accepted.ok()).toBe(true);
  const thread = await (
    await request.post("/api/threads", {
      data: { projectId: project.id, title: "Real attachment check" },
    })
  ).json();
  const files = [
    {
      name: "evidence.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Launch evidence\nThe launch code is MARBLE-73."),
    },
    { name: "source.pdf", mimeType: "application/pdf", buffer: probePdf() },
    {
      name: "color.png",
      mimeType: "image/png",
      buffer: fs.readFileSync("tests/fixtures/red.png"),
    },
  ];
  const selections = [];
  for (const file of files) {
    const response = await request.post("/api/sources", {
      multipart: { threadId: thread.id, projectId: project.id, files: file },
    });
    expect(response.ok()).toBe(true);
    const [source] = await response.json();
    selections.push({
      id: source.id,
      mode: file.name.endsWith(".md") ? "full" : "original",
    });
  }
  await expect
    .poll(
      async () => {
        const v = await (await request.get("/api/threads/" + thread.id)).json();
        return v.sources.every((s: { status: string }) => s.status === "ready");
      },
      { timeout: 20000 },
    )
    .toBe(true);
  await request.patch("/api/threads/" + thread.id, {
    data: { modelId: model.id, sourceIds: selections },
  });
  await page.goto("/chat/" + thread.id);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(
      "Using the approved brief and all three attached sources, state the budget ceiling, exact launch code, exact text printed in the PDF, and the image color. Keep the answer short.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(
      async () => {
        const v = await (await request.get("/api/threads/" + thread.id)).json();
        if (v.generations[0]?.state === "failed")
          throw new Error(v.generations[0].error);
        return v.generations[0]?.state;
      },
      { timeout: 90000 },
    )
    .toBe("complete");
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "MARBLE-73",
    { timeout: 90000 },
  );
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "WORKBENCH-7319",
  );
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "500",
  );
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    /red/i,
  );
  await expect
    .poll(
      async () => {
        const v = await (await request.get("/api/threads/" + thread.id)).json();
        return v.generations[0].state;
      },
      { timeout: 90000 },
    )
    .toBe("complete");
  await page.reload();
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "MARBLE-73",
  );
  await page.getByRole("button", { name: /Context/ }).click();
  await page.screenshot({ path: "docs/live-conversation.png", fullPage: true });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByLabel("What should the next AI help you do?")
    .fill("Plan the document import acceptance tests.");
  await page.getByRole("button", { name: "Build preview" }).click();
  await expect(page.locator(".export-preview")).toContainText("500");
  await expect(page.locator(".export-preview")).toContainText("MARBLE-73");
  await page.screenshot({ path: "docs/export-preview.png", fullPage: true });
});
