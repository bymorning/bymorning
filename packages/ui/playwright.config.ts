import { defineConfig } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 41789)

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}/ui/`,
    viewport: { width: 1100, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && vite preview --config test/browser/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/ui/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
