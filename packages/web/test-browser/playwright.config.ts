import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4178)
const hotReload = process.env.HOT_RELOAD_WORKSPACE_ID !== undefined
const baseURL = hotReload ? (process.env.HOT_RELOAD_WEB_URL ?? "http://localhost:3000") : `http://127.0.0.1:${port}`
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined)

export default defineConfig({
  testDir: ".",
  testMatch: hotReload ? "plugin-hot-reload.spec.ts" : "timeline-*.spec.ts",
  fullyParallel: false,
  workers: 1,
  // A cold Vite server re-optimizes dependencies the first time a spec imports a route module and reloads the
  // page; the retry runs against the warm server.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "../test-results/timeline",
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1100, height: 700 },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: hotReload ? "on" : "retain-on-failure",
  },
  ...(hotReload
    ? {}
    : {
        webServer: {
          command: `bun run vite --host 127.0.0.1 --port ${port} --strictPort`,
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          url: `${baseURL}/test-browser/timeline-harness.html`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
})
