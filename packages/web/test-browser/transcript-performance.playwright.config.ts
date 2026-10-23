import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4179)
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined)

export default defineConfig({
  testDir: ".",
  testMatch: "transcript-performance.spec.ts",
  workers: 1,
  timeout: 900_000,
  outputDir: "../test-results/transcript-hot-path/playwright",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 1100, height: 700 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `TRANSCRIPT_BENCHMARK=1 bun run build && bun run preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: `http://127.0.0.1:${port}/test-browser/transcript-performance-harness.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
