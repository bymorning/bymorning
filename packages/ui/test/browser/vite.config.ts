import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// This fixture is a consumer: resolve the preload through the supported export.
const preload = readFileSync(fileURLToPath(import.meta.resolve("@bymorning/ui/theme-preload.js")), "utf8")

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/ui/",
  plugins: [
    {
      name: "fixture-theme-preload",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html.replace("<!-- theme-preload -->", `<script>${preload}</script>`),
      },
    },
    solid(),
  ],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    manifest: true,
  },
})
