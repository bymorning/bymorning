import devtools from "solid-devtools/vite"
import { defineConfig } from "vitest/config"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [devtools(), solidPlugin()],
  ...(process.env.TRANSCRIPT_BENCHMARK === "1"
    ? { build: { rollupOptions: { input: "test-browser/transcript-performance-harness.html" } } }
    : {}),
  test: {
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    exclude: ["e2e/**", "test-browser/**", "**/node_modules/**", "**/dist/**"],
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@bymorning/plugin-share"] },
  server: {
    port: 3000,
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
      ].map((path) => [path, { target: process.env.VITE_GATEWAY_URL ?? "http://localhost:3210", changeOrigin: true }]),
    ),
  },
})
