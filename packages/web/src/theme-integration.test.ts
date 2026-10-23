/// <reference types="node" />

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { cleanup, render, screen } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"

import App from "./app"
import { showToast, toaster } from "./ui/components/toast"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
  window.history.replaceState({}, "", "/")
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.style.removeProperty("background-color")
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe("application theme integration", () => {
  it("owns the theme for the complete application provider lifetime", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...base,
      workspace: { ...base.workspace, list: vi.fn(async () => []) },
    } as ByMorningClient)
    // The tool-ui prototype route consumes the theme context and performs no backend requests.
    window.history.replaceState({}, "", "/__prototype/tool-ui")
    render(App)

    // The routed prototype is lazy, so the Router has rendered no content yet, while the
    // provider-owned canonical prepaint surface is already on the document element.
    expect(screen.queryByText("Tool UI prototype")).not.toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe("paper")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.documentElement.style.backgroundColor).toBe("var(--color-bg-deep)")

    // The route chunk loads lazily; allow for a slow transform on a busy machine.
    expect(await screen.findByRole("heading", { name: "Tool UI prototype" }, { timeout: 10_000 })).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe("paper")

    showToast({ variant: "success", title: "Toast region mounted by the app shell" })
    expect(await screen.findByText("Toast region mounted by the app shell")).toBeInTheDocument()
  })

  it("loads Tailwind before the complete canonical token foundation", () => {
    const styles = source("src/main.css")
    expect(styles.indexOf('@import "tailwindcss"')).toBeGreaterThanOrEqual(0)
    expect(styles.indexOf('@import "./ui/theme/styles/index.css"')).toBeGreaterThan(
      styles.indexOf('@import "tailwindcss"'),
    )
  })

  it("loads generated primitives, generated semantics, then fonts", () => {
    expect(source("src/ui/theme/styles/index.css")).toBe(
      '@import "./tokens/colors.css";\n' +
        '@import "./tokens/theme.css";\n' +
        '@import "./fonts.css";\n',
    )
  })
})
