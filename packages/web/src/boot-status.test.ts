/// <reference types="node" />

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

const html = readFileSync(join(process.cwd(), "index.html"), "utf8")
const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8")

it("ships empty shell chrome in HTML before JS", () => {
  expect(html).toContain("<title>ByMorning</title>")
  expect(html).toMatch(/<noscript>[\s\S]*#boot-status[\s\S]*display:\s*none/)
  expect(html).toMatch(/id="boot-status"[^>]*data-component="shell"/)
  expect(html).toContain('data-slot="project-sidebar"')
  expect(html).toContain('data-slot="shell-content"')
  expect(html).not.toContain("Loading ByMorning")
})

it("selects theme before painting boot status", () => {
  expect(html.indexOf("/bymorning-theme-preload.js")).toBeLessThan(html.indexOf('id="boot-status"'))
})

it("paints boot chrome from theme tokens, not hardcoded dark hex", () => {
  const splash = html.slice(html.indexOf("#boot-status"), html.indexOf("</style>"))
  expect(splash).toContain("background: var(--color-bg-deep, Canvas)")
  expect(splash).toContain("background: var(--color-bg-surface, Canvas)")
  expect(splash).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  expect(html).toContain(':root[data-color-scheme="light"]')
  expect(html).toContain(':root[data-color-scheme="dark"]')
})

it("hides the boot status when the application mounts", () => {
  expect(main).toContain('document.getElementById("boot-status")?.remove()')
})
