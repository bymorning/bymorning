import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    fileParallelism: false,
    server: {
      deps: {
        inline: ["@opencode-ai/ai", "@opencode-ai/schema"],
      },
    },
  },
})
