import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const modulePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    // The store development build imports `solid-js` and requires its matching
    // development runtime for DEV.registerGraph. Keep this browser-only setup
    // scoped to focused Solid tests rather than Client SDK tests.
    alias: [
      { find: "solid-js/store", replacement: modulePath("./node_modules/solid-js/store/dist/dev.js") },
      { find: "solid-js", replacement: modulePath("./node_modules/solid-js/dist/dev.js") },
    ],
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    include: ["test/solid/**/*.test.ts"],
    server: { deps: { inline: ["solid-js"] } },
  },
})
