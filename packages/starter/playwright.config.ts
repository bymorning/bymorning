import { defineConfig, devices } from "@playwright/test"
import { existsSync } from "node:fs"

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (process.env.PLAYWRIGHT_MANAGED_CHROMIUM === "1"
    ? undefined
    : existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : undefined)

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results/application",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
})
