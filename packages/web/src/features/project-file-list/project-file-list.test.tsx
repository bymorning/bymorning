import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectFileListState } from "./project-file-list-model"
import { ProjectFileList } from "./project-file-list"

afterEach(cleanup)

describe("ProjectFileList", () => {
  it("keeps no-project and loading states while empty and errors show example tables", () => {
    render(() => {
      const [state, setState] = createSignal<ProjectFileListState>({ status: "no-project" })
      return (
        <>
          <button type="button" onClick={() => setState({ status: "loading" })}>
            Load
          </button>
          <button type="button" onClick={() => setState({ status: "empty" })}>
            Empty
          </button>
          <button type="button" onClick={() => setState({ status: "error", message: "Files unavailable" })}>
            Error
          </button>
          <ProjectFileList state={state()} onOpen={() => undefined} />
        </>
      )
    })

    expect(screen.getByText("Select a project to view its files.")).toBeVisible()
    screen.getByRole("button", { name: "Load" }).click()
    expect(screen.getByRole("status")).toHaveTextContent(/^Loading project files…$/)
    expect(document.querySelector('[data-slot*="skeleton"]')).not.toBeInTheDocument()
    screen.getByRole("button", { name: "Empty" }).click()
    expect(
      screen.queryByText("This project has no files yet. Here are example files you could add."),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("table", { name: "Example project files" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "Path" })).toBeVisible()
    expect(screen.getAllByRole("cell")).toHaveLength(3)
    screen.getByRole("button", { name: "Error" }).click()
    expect(screen.getByRole("alert")).toHaveTextContent("Files unavailable")
    expect(screen.getByText("Showing example files while the project directory is unavailable.")).toBeVisible()
    expect(screen.getByRole("table", { name: "Example project files" })).toBeVisible()
  })

  it("renders real files semantically and opens their paths", async () => {
    const onOpen = vi.fn()
    render(() => (
      <ProjectFileList
        state={{ status: "ready", items: [{ path: "src/features/project-file-list.tsx" }] }}
        onOpen={onOpen}
      />
    ))

    const table = screen.getByRole("table", { name: "Files in the selected project" })
    expect(table).toBeVisible()
    expect(screen.getByRole("region", { name: "Project files table" })).toHaveAttribute("tabindex", "0")
    expect(screen.getByText("1 file")).toBeVisible()
    expect(screen.queryByText("package.json")).not.toBeInTheDocument()
    const row = screen.getByRole("button", { name: "src/features/project-file-list.tsx" })
    expect(row).toHaveAttribute("title", "src/features/project-file-list.tsx")
    await userEvent.setup().click(row)
    expect(onOpen).toHaveBeenCalledWith("src/features/project-file-list.tsx")
  })

  it("filters loaded rows without changing the truthful total", async () => {
    render(() => (
      <ProjectFileList
        state={{ status: "ready", items: [{ path: "README.md" }, { path: "src/app.ts" }] }}
        onOpen={() => undefined}
      />
    ))

    await userEvent.type(screen.getByRole("searchbox", { name: "Search project files" }), "read")
    expect(screen.getByRole("button", { name: "README.md" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "src/app.ts" })).not.toBeInTheDocument()
    expect(screen.getByText("2 files")).toBeVisible()
  })

  it("replaces example rows when real files become available", () => {
    render(() => {
      const [state, setState] = createSignal<ProjectFileListState>({ status: "empty" })
      return (
        <>
          <button type="button" onClick={() => setState({ status: "ready", items: [{ path: "src/app.ts" }] })}>
            Refresh
          </button>
          <ProjectFileList state={state()} onOpen={() => undefined} />
        </>
      )
    })

    expect(screen.getByText("package.json")).toBeVisible()
    screen.getByRole("button", { name: "Refresh" }).click()
    expect(screen.queryByText("package.json")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "src/app.ts" })).toBeVisible()
    expect(screen.getByRole("table", { name: "Files in the selected project" })).toBeVisible()
  })

  it("keeps a 10,000-file table bounded while scrolling without unmounting focus", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({
      path: `src/file-${index.toString().padStart(5, "0")}.ts`,
    }))
    render(() => <ProjectFileList state={{ status: "ready", items }} onOpen={() => undefined} />)

    const table = screen.getByRole("table", { name: "Files in the selected project" })
    const region = screen.getByRole("region", { name: "Project files table" })
    const first = screen.getByRole("button", { name: items[0]!.path })
    expect(table).toHaveAttribute("data-total-rows", "10000")
    expect(table).toHaveAttribute("aria-rowcount", "10001")
    expect(table.querySelectorAll("tbody tr").length).toBeLessThan(64)
    first.focus()
    await new Promise(requestAnimationFrame)

    region.scrollTop = 140_000
    fireEvent.scroll(region)
    await waitFor(() => expect(screen.getByRole("button", { name: items[5000]!.path })).toBeVisible())
    expect(screen.getByRole("button", { name: items[5000]!.path }).closest("tr")).toHaveAttribute(
      "aria-rowindex",
      "5002",
    )
    expect(first).toHaveFocus()
    expect(table.querySelectorAll("tbody tr").length).toBeLessThan(64)

    region.scrollTop = 280_000
    fireEvent.scroll(region)
    await waitFor(() => expect(screen.getByRole("button", { name: items.at(-1)!.path })).toBeVisible())
    expect(table.querySelectorAll("tbody tr").length).toBeLessThan(64)
    expect(screen.getByRole("columnheader", { name: "Path" })).toBeVisible()
    expect(screen.getAllByRole("cell").length).toBeLessThan(32)
  })
})
