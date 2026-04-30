import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8081";

export default defineConfig({
  testDir: "./frontend/e2e",
  outputDir: "artifacts/qa/playwright/test-results",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/qa/playwright/html", open: "never" }],
    ["junit", { outputFile: "artifacts/qa/playwright/junit.xml" }],
  ],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  workers: process.env.CI ? 1 : undefined,
});
