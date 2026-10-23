import { defineConfig } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 41783)

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 900, height: 700 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `vite --config test/browser/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
