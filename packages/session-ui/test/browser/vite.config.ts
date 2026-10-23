import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { fileURLToPath } from "node:url"

export default defineConfig({ plugins: [solid()], root: fileURLToPath(new URL(".", import.meta.url)) })
