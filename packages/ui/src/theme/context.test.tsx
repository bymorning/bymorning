import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider, useTheme } from "@bymorning/ui/theme"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  document.documentElement.style.removeProperty("background-color")
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe("ThemeProvider", () => {
  it("preserves the canonical prepaint surface when applying and changing the theme", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
    })
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    const meta = document.head.appendChild(document.createElement("meta"))
    meta.name = "theme-color"
    document.documentElement.style.backgroundColor = "var(--color-bg-deep)"

    render(() => (
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    ))

    await waitFor(() => expect(document.documentElement.dataset.colorScheme).toBe("dark"))
    expect(document.documentElement.style.backgroundColor).toBe("var(--color-bg-deep)")
    expect(meta.content).toBe("var(--color-bg-deep)")

    await userEvent.setup().click(screen.getByRole("button", { name: "Use light mode" }))
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(document.documentElement.style.backgroundColor).toBe("var(--color-bg-deep)")
    expect(meta.content).toBe("var(--color-bg-deep)")
  })

  it("synchronizes storage and system changes and removes browser listeners", async () => {
    const values: Record<string, string> = {
      "bymorning-theme-id": "ink",
      "bymorning-color-scheme": "system",
    }
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => (values[key] = value),
    })
    let mediaListener: EventListener | undefined
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: EventListener) => (mediaListener = listener)),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal("matchMedia", () => media)
    const removeWindowListener = vi.spyOn(window, "removeEventListener")

    const result = render(() => (
      <ThemeProvider>
        <ThemeState />
      </ThemeProvider>
    ))

    await waitFor(() => expect(screen.getByText("ink:system:light")).toBeInTheDocument())
    media.matches = true
    mediaListener?.(new Event("change"))
    await waitFor(() => expect(screen.getByText("ink:system:dark")).toBeInTheDocument())

    window.dispatchEvent(new StorageEvent("storage", { key: "bymorning-theme-id", newValue: "bymorning" }))
    window.dispatchEvent(new StorageEvent("storage", { key: "bymorning-color-scheme", newValue: "light" }))
    await waitFor(() => expect(screen.getByText("bymorning:light:light")).toBeInTheDocument())

    result.unmount()
    expect(removeWindowListener).toHaveBeenCalledWith("storage", expect.any(Function))
    expect(media.removeEventListener).toHaveBeenCalledWith("change", mediaListener)
  })
})

function ThemeControls() {
  const theme = useTheme()
  return <button onClick={() => theme.setScheme("light")}>Use light mode</button>
}

function ThemeState() {
  const theme = useTheme()
  return <output>{`${theme.theme()}:${theme.scheme()}:${theme.mode()}`}</output>
}
