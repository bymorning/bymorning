import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createStore } from "solid-js/store"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OverlayHost } from "../../ui/components/overlay-host"
import { SessionListRow } from "./session-list-row"
import type { SessionListStatus } from "./session-list-model"

const item = {
  key: "session-1",
  id: "session-1",
  title: "Morning plan",
  updatedAt: new Date("2026-08-31T14:14:00.000Z"),
  project: { name: "Planning" },
}

afterEach(cleanup)

describe("SessionListRow", () => {
  it("disables pending archive actions and renders the row's native mutation failure", async () => {
    const [state, setState] = createStore<{ pending: boolean; error: string | undefined }>({
      pending: true,
      error: undefined,
    })
    const onSelect = vi.fn()
    render(() => (
      <OverlayHost>
        <SessionListRow
          item={item}
          scope="project"
          status={() => ({ open: false, indicator: "idle" })}
          statusLabel={() => undefined}
          href="/session/test"
          onOpen={() => undefined}
          archive={{ archived: false, onSelect, pending: () => state.pending, error: () => state.error }}
        />
      </OverlayHost>
    ))
    expect(screen.getByRole("button", { name: "Session actions" })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole("button", { name: "Session actions" }))
    expect(onSelect).not.toHaveBeenCalled()
    setState({ pending: false, error: "Session was deleted" })
    expect(screen.getByRole("button", { name: "Session actions" })).not.toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Session was deleted")
  })
  it("offers a visible Restore action on archived rows", async () => {
    const onSelect = vi.fn()
    render(() => (
      <OverlayHost>
        <SessionListRow
          item={item}
          scope="project"
          status={() => ({ open: false, indicator: "idle" })}
          statusLabel={() => undefined}
          href="/session/test"
          onOpen={() => undefined}
          archive={{ archived: true, onSelect }}
        />
      </OverlayHost>
    ))
    expect(screen.queryByRole("button", { name: "Session actions" })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Restore session: Morning plan" }))
    expect(onSelect).toHaveBeenCalledWith(item)
  })
  it("exposes the full title as a tooltip for truncated titles", () => {
    renderRow({ open: false, indicator: "idle" })
    expect(screen.getByText("Morning plan")).toHaveAttribute("title", "Morning plan")
  })
  it("shows a spinner while preserving the avatar width when working", () => {
    renderRow({ open: false, indicator: "working" })

    const row = screen.getByRole("link", { name: /Morning plan.*Session status: Working/ })
    expect(row.querySelector('[data-slot="session-list-row-avatar"]')).toHaveAttribute("data-loading")
    expect(row.querySelector('[data-component="project-avatar"]')).toBeInTheDocument()
    expect(row.querySelector('[data-component="spinner"]')).toBeInTheDocument()
  })

  it.each([
    ["attention", "Needs attention"],
    ["unread", "Unread"],
  ] as const)("exposes %s status while preserving the unread treatment", (indicator, label) => {
    renderRow({ open: false, indicator })

    const row = screen.getByRole("link", { name: new RegExp(`Morning plan.*Session status: ${label}`) })
    expect(row.querySelector('[data-slot="session-list-row-avatar"]')).not.toHaveAttribute("data-loading")
    expect(row.querySelector('[data-component="project-avatar"]')).toHaveAttribute("data-unread")
  })

  it("renders Untitled without colliding with New session", () => {
    render(() => (
      <SessionListRow
        item={{ ...item, title: "Untitled" }}
        scope="project"
        status={() => ({ open: false, indicator: "idle" })}
        statusLabel={() => undefined}
        href="/session/test"
        onOpen={() => undefined}
      />
    ))

    expect(screen.getByRole("link", { name: /Untitled/ })).toHaveTextContent("Untitled")
    expect(screen.queryByText("New session")).not.toBeInTheDocument()
  })

  it("shows the scheduled-task clock badge only for Sessions a Scheduled Task started", () => {
    render(() => (
      <SessionListRow
        item={{ ...item, scheduledTask: true }}
        scope="project"
        status={() => ({ open: false, indicator: "idle" })}
        statusLabel={() => undefined}
        href="/session/test"
        onOpen={() => undefined}
      />
    ))
    const row = screen.getByRole("link", { name: /Morning plan/ })
    expect(row.querySelector('[data-slot="session-list-row-scheduled"]')).toBeInTheDocument()

    cleanup()
    renderRow({ open: false, indicator: "idle" })
    const attended = screen.getByRole("link", { name: /Morning plan/ })
    expect(attended.querySelector('[data-slot="session-list-row-scheduled"]')).not.toBeInTheDocument()
  })

  it("adds no status text to the accessible name when idle", () => {
    renderRow({ open: false, indicator: "idle" })

    expect(screen.getByRole("link", { name: /Morning plan/ })).not.toHaveAccessibleName(/Session status:/)
  })

  it("renders the actual project avatar when enabled for sidebar rows", () => {
    renderRow({ open: false, indicator: "idle" }, true, "/planning.png")

    const row = screen.getByRole("link", { name: /Morning plan/ })
    expect(row.querySelector('[data-component="project-avatar"]')).toBeVisible()
    expect(row.querySelector('[data-slot="project-avatar-image"]')).toHaveAttribute("src", "/planning.png")
  })

  it("reserves an empty leading slot without a project avatar when idle", () => {
    renderRow({ open: false, indicator: "idle" }, false)

    const row = screen.getByRole("link", { name: /Morning plan/ })
    expect(row).toHaveAttribute("data-has-leading")
    expect(row.querySelector('[data-slot="session-list-row-leading"]')).toBeEmptyDOMElement()
    expect(row.querySelector('[data-component="project-avatar"]')).not.toBeInTheDocument()
    expect(row.querySelector('[data-component="spinner"]')).not.toBeInTheDocument()
  })

  it.each(["working", "attention", "unread"] as const)(
    "keeps a compact %s affordance without a project avatar",
    (indicator) => {
      renderRow({ open: false, indicator }, false)

      const row = screen.getByRole("link", { name: /Morning plan.*Session status:/ })
      expect(row).toHaveAttribute("data-has-leading")
      expect(row.querySelector('[data-component="project-avatar"]')).not.toBeInTheDocument()
      expect(row.querySelector('[data-slot="session-list-row-status"]')).toHaveAttribute("data-indicator", indicator)
    },
  )

  it("keeps the current Session active from the URL match", () => {
    renderRow({ open: true, indicator: "idle" })

    const row = screen.getByRole("link", { name: /Morning plan/ })
    expect(row).toHaveAttribute("aria-current", "page")
    expect(row).toHaveAttribute("data-current")
    expect(row.closest("[data-slot='session-list-row-wrap']")).toHaveAttribute("data-current")
  })

  it("does not mark a Session current when another route is open", () => {
    renderRow({ open: false, indicator: "idle" })

    const row = screen.getByRole("link", { name: /Morning plan/ })
    expect(row).not.toHaveAttribute("aria-current")
    expect(row).not.toHaveAttribute("data-current")
  })

  it("keeps modified clicks native while routing normal clicks through the SPA", () => {
    const onOpen = vi.fn()
    renderRow({ open: false, indicator: "idle" }, undefined, undefined, onOpen)
    const row = screen.getByRole("link", { name: /Morning plan/ })

    fireEvent.click(row, { ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(row).toHaveAttribute("href", "/session/test")
  })

  it("archives from the row actions without opening the Session", async () => {
    const onOpen = vi.fn()
    const onSelect = vi.fn()
    render(() => (
      <OverlayHost>
        <SessionListRow
          item={item}
          scope="project"
          status={() => ({ open: false, indicator: "idle" })}
          statusLabel={() => undefined}
          href="/session/test"
          onOpen={onOpen}
          archive={{ archived: false, onSelect }}
        />
      </OverlayHost>
    ))

    await userEvent.setup().click(screen.getByRole("button", { name: "Session actions" }))
    await userEvent
      .setup()
      .click(
        screen.getAllByRole("menuitem", { hidden: true }).find((element) => element.textContent === "Archive session")!,
      )
    expect(onSelect).toHaveBeenCalledWith(item)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

function renderRow(status: SessionListStatus, showAvatar?: boolean, avatar?: string, onOpen = () => undefined) {
  return render(() => (
    <SessionListRow
      item={{ ...item, project: avatar ? { ...item.project, avatar } : item.project }}
      scope="project"
      showAvatar={showAvatar}
      status={() => status}
      statusLabel={(indicator) =>
        indicator === "idle"
          ? undefined
          : `Session status: ${
              indicator === "attention" ? "Needs attention" : indicator === "unread" ? "Unread" : "Working"
            }`
      }
      href="/session/test"
      onOpen={onOpen}
    />
  ))
}
