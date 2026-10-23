import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const api = process.env.VITE_API_ORIGIN
if (!api) console.warn("VITE_API_ORIGIN is not set; proxying to http://localhost:3210")
const target = api ?? "http://localhost:3210"

export default defineConfig({
  plugins: [solid()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Markdown is loaded from the workspace package, so Vite cannot discover all
  // of its worker dependencies before the first browser request. Prebundling
  // them up front avoids a dependency-discovery full reload that otherwise
  // tears down an active module worker.
  optimizeDeps: {
    include: [
      "@bymorning/session-ui > @shikijs/stream",
      "@bymorning/session-ui > shiki",
      "@bymorning/session-ui > katex",
      "@bymorning/session-ui > marked",
      "@bymorning/session-ui > marked-shiki",
      "@bymorning/session-ui > remend",
    ],
  },
  // Session UI's Markdown transport creates an ESM module worker. Vite's
  // default IIFE worker output cannot bundle its split worker imports.
  worker: { format: "es" },
  server: {
    proxy: Object.fromEntries(
      [
        "/.well-known",
        "/auth",
        "/api",
        "/inference",
        "/mcp",
        "/oauth/authorize",
        "/oauth/register",
        "/oauth/token",
        "/system",
      ].map((path) => [path, { target, changeOrigin: true }]),
    ),
  },
})
