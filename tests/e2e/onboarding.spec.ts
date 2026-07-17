import { expect, test } from "@playwright/test";

test("local onboarding is keyboard accessible and responsive", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      config: {
        configured: false,
        hasCredential: false,
        endpoint: "",
        endpointKind: "azure-openai",
        defaultProjectId: "",
        chatDeployment: "",
        memoryDeployment: "",
        branchDeployment: "",
        criticDeployment: "",
        synthesisDeployment: "",
        reasoningEffort: "medium",
      },
      projects: [],
      threads: [],
      deployments: [],
      files: [],
    }),
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A quiet place to think with your models." })).toBeVisible();
  await page.getByLabel("Endpoint").focus();
  await expect(page.getByLabel("Endpoint")).toBeFocused();
  await expect(page.getByText("The key never enters browser storage")).toBeVisible();
});
