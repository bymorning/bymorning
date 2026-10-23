import { defineConfig, devices } from "@playwright/test"
import { existsSync } from "node:fs"

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4179)
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (process.env.PLAYWRIGHT_MANAGED_CHROMIUM === "1"
    ? undefined
    : existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : undefined)

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "application/**",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  ...(externalBaseURL === undefined
    ? {
        webServer: {
          command: `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
})
