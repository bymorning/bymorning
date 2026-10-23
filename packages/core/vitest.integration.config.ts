import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    // One PostgreSQL server per run; every file receives its own clone of the
    // migrated template as DATABASE_URL before its imports run.
    globalSetup: ["../testing/src/vitest/global-setup.ts"],
    setupFiles: ["../testing/src/vitest/file-database.ts"],
    server: {
      deps: {
        inline: ["@opencode-ai/ai", "@opencode-ai/schema"],
      },
    },
  },
})
