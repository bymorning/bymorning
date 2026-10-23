import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One PostgreSQL server per run; each Application clones its migrated template.
    globalSetup: ["./src/vitest/global-setup.ts"],
    // Real Application scenarios start listeners, runtimes, and a scripted model.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
