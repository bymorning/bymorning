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
  testDir: "./e2e/application",
  outputDir: "./test-results/application",
  fullyParallel: true,
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["line"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
})
