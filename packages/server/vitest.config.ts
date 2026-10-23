import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One PostgreSQL server per run; PostgreSQL suites clone its migrated template.
    globalSetup: ["../testing/src/vitest/global-setup.ts"],
    // OIDC and Application suites start listeners and real runtimes.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        inline: ["@opencode-ai/ai", "@opencode-ai/schema"],
      },
    },
  },
})
