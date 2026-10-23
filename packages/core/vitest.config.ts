import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ["@opencode-ai/ai", "@opencode-ai/schema"],
      },
    },
  },
})
