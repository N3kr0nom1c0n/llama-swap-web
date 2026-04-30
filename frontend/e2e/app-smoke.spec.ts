import { test as base, expect, type APIRequestContext, type ConsoleMessage } from "@playwright/test";

const tokenThatMustNotRender = "hf_release_smoke_secret_123456789";

const test = base.extend<{ consoleIssues: string[] }>({
  consoleIssues: async ({ page }, use) => {
    const issues: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !isAllowedConsoleError(message)) {
        const location = message.location();
        issues.push(`${message.text()} (${location.url}:${location.lineNumber})`);
      }
    });
    page.on("pageerror", (error) => issues.push(error.message));

    await use(issues);

    expect(issues).toEqual([]);
  },
});

test("dashboard loads against a healthy running app", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health).toBeOK();
  await expect(await health.json()).toMatchObject({ status: "ok" });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/config/i);
  await expect(page.getByRole("main")).toContainText(/models/i);
});

test("import model page exposes source controls", async ({ page }) => {
  await page.goto("/import");

  await expect(page.getByRole("heading", { name: /^import model$/i })).toBeVisible();
  await expect(page.getByLabel(/role/i)).toBeVisible();
  await expect(page.getByLabel(/desired name/i)).toBeVisible();
  await expect(page.getByLabel(/hugging face url/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /resolve/i })).toBeVisible();
});

test("models page loads the managed model editor", async ({ page }) => {
  await page.goto("/models");

  await expect(page.getByRole("heading", { name: /^(managed )?models$/i })).toBeVisible();
  await expect(page.getByLabel(/model id/i)).toBeVisible();
  await expect(page.getByLabel(/primary model file/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /save model/i })).toBeVisible();
});

test("gpu planner page loads planner controls", async ({ page }) => {
  await page.goto("/gpus");

  await expect(page.getByRole("heading", { name: /gpu planner/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /add gpu/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /save gpus/i })).toBeVisible();
});

test("config preview regenerates with seeded API data", async ({ page, request }) => {
  test.skip(!process.env.ALLOW_E2E_MUTATIONS, "Set ALLOW_E2E_MUTATIONS=1 only for disposable test targets.");
  const modelId = `qa-smoke-${Date.now()}`;
  await seedModel(request, modelId);

  await page.goto("/config");
  await expect(page.getByRole("heading", { name: /config preview/i })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(escapeRegExp(modelId)) })).toBeVisible();

  await page.getByRole("button", { name: /regenerate/i }).click();

  await expect(page.getByText(/staged preview id/i)).toBeVisible();
  await expect(page.getByText(modelId).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /generated yaml/i })).toBeVisible();
});

test("settings token control does not render raw token text", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  const tokenInput = page.getByLabel(/hf api token/i);
  await tokenInput.fill(tokenThatMustNotRender);

  await expect(page.getByText(tokenThatMustNotRender, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /save token/i })).toBeEnabled();
});

test("help page supports search and section navigation", async ({ page }) => {
  await page.goto("/help");

  await expect(page.getByRole("heading", { name: /^help$/i })).toBeVisible();
  await page.getByLabel(/search help/i).fill("gpu");
  await expect(page.getByTestId("help-results")).toContainText(/gpu/i);

  const firstSectionLink = page.locator('[aria-label="Help sections"] a').first();
  await expect(firstSectionLink).toBeVisible();
  await firstSectionLink.click();
  await expect(page).toHaveURL(/\/help#/);
});

function isAllowedConsoleError(message: ConsoleMessage): boolean {
  const location = message.location();
  return location.url.endsWith("/favicon.ico") || /favicon\.ico/i.test(message.text());
}

async function seedModel(request: APIRequestContext, id: string) {
  const modelFile = `/models/chat/${id}.gguf`;
  const matrixKey = `q${id.replace(/[^a-z0-9]/gi, "").slice(-7).toLowerCase()}`;
  const response = await request.post("/api/models", {
    data: {
      id,
      display_name: `QA Smoke ${id}`,
      role: "chat",
      source_type: "manual",
      hf_url: "",
      hf_revision: "main",
      manager_files: [],
      container_files: [modelFile],
      primary_model_file: modelFile,
      mmproj_file: "",
      chat_template_file: "",
      tokenizer_files: [],
      aliases: [],
      ttl: 300,
      gpu_devices: [],
      main_gpu: null,
      tensor_split: "",
      llama_flags: {
        ctx_size: 2048,
        cache_type_k: "q4_0",
        cache_type_v: "q4_0",
        flash_attn: "on",
        jinja: true,
        no_mmap: true,
      },
      raw_cmd_override: "",
      matrix_key: matrixKey,
      matrix_behavior: "with_support",
      matrix_expression: "",
      evict_cost: null,
      startup_preload: false,
    },
  });

  expect(response).toBeOK();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
