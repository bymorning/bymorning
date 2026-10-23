import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createSessionListSearchController, SESSION_SEARCH_RESULT_LIMIT } from "./session-list-search-controller"
import { SessionListSearch } from "./session-list-search"

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")

afterEach(() => {
  cleanup()
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView)
    return
  }
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

describe("SessionListSearch", () => {
  it("caps matching options and keeps keyboard selection within the mounted results", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value() {},
      writable: true,
    })
    const openSession = vi.fn()
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      key: `session-${index}`,
      id: `session-${index}`,
      title: `Matching session ${index}`,
      updatedAt: new Date(0),
      project: { name: "Project" },
    }))
    render(() => {
      const controller = createSessionListSearchController({
        items: () => items,
        placeholder: () => "Search sessions",
        noResultsLabel: (query) => `No sessions matching ${query}`,
        loading: () => false,
        openSession,
      })
      return (
        <SessionListSearch
          controller={controller}
          scope="workspace"
          status={() => ({ open: false, indicator: "idle" })}
          statusLabel={() => undefined}
          sessionsLabel="Sessions"
          loadingLabel="Loading"
          href={(id) => `/session/${id}`}
        />
      )
    })

    const input = screen.getByRole("searchbox", { name: "Search sessions" })
    await userEvent.type(input, "matching")
    expect(screen.getAllByRole("option")).toHaveLength(SESSION_SEARCH_RESULT_LIMIT)
    expect(input).toHaveAttribute("aria-activedescendant", "session-list-search-option-session-0")

    await userEvent.keyboard("{ArrowUp}")
    expect(input).toHaveAttribute("aria-activedescendant", "session-list-search-option-session-63")
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toBeVisible()
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(openSession).toHaveBeenCalledWith("session-0")
  })

  it("renders the field's search affordance as an icon rather than a text glyph", () => {
    render(() => {
      const controller = createSessionListSearchController({
        items: () => [],
        placeholder: () => "Search sessions",
        noResultsLabel: (query) => `No sessions matching ${query}`,
        loading: () => false,
        openSession: vi.fn(),
      })
      return (
        <SessionListSearch
          controller={controller}
          scope="workspace"
          status={() => ({ open: false, indicator: "idle" })}
          statusLabel={() => undefined}
          sessionsLabel="Sessions"
          loadingLabel="Loading"
          href={(id) => `/session/${id}`}
        />
      )
    })
    const field = document.querySelector('[data-slot="session-list-search-input"]')!
    expect(field.querySelector('svg[data-slot="icon-svg"]')).toBeInTheDocument()
    expect(field).not.toHaveTextContent("⌕")
  })
})
