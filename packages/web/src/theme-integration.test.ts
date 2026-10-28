import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { cleanup, render, screen } from "@solidjs/testing-library"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import App from "./app"
import { showToast, toaster } from "./ui/components/toast"

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

  // theme:check only verifies the generated files; nothing else fails if the app stops importing them,
  // which would leave the whole UI without tokens or fonts.
  it("reaches the generated token and font stylesheets from the application entry stylesheet", () => {
    const reached = new Set<string>()
    const visit = (file: string) => {
      if (reached.has(file)) return
      reached.add(file)
      const css = readFileSync(file, "utf8")
      for (const [, specifier] of css.matchAll(/@import\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        const next = join(dirname(file), specifier!)
        if (existsSync(next)) visit(next)
      }
    }
    visit(join(process.cwd(), "src/main.css"))
    const names = [...reached].map((file) => file.slice(process.cwd().length + 1))
    for (const required of [
      "src/ui/theme/styles/tokens/colors.css",
      "src/ui/theme/styles/tokens/theme.css",
      "src/ui/theme/styles/fonts.css",
    ])
      expect(names).toContain(required)
  })
})
