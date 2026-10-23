import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createStore, reconcile } from "solid-js/store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DialogProvider } from "../../../context/dialog"
import { renderForm as render } from "../../../ui/form-query.test-support"
import { RightSidebar } from "../../../session/right-sidebar"
import type { ProjectFileController, ProjectFileListState, ProjectFilePreviewState } from "../project-file-controller"
import { FileBrowser } from "./file-browser"

beforeEach(() =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  ),
)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Menu items render in a portal whose accessible names jsdom does not compute. */
const menuItem = (name: string) =>
  screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === name)!

function mount(
  initial: ProjectFileListState = { state: "idle" },
  tree?: { shown: boolean; change: (shown: boolean) => void },
) {
  const [state, setState] = createStore<{
    open: boolean
    filter: string
    path: string | undefined
    folder: string | undefined
    list: ProjectFileListState
    preview: ProjectFilePreviewState
  }>({ open: true, filter: "", path: undefined, folder: undefined, list: initial, preview: { state: "empty" } })
  const reload = vi.fn()
  const upload = vi.fn(async () => undefined)
  const download = vi.fn(async () => undefined)
  const move = vi.fn(async (_from: string, _to: string) => undefined)
  const remove = vi.fn(async (_path: string) => undefined)
  const moveFolder = vi.fn(async (_from: string, _to: string) => undefined)
  const removeFolder = vi.fn(async (_folder: string) => undefined)
  const preview = (value: ProjectFilePreviewState) => setState("preview", reconcile(value))
  const model: ProjectFileController = {
    filter: () => state.filter,
    activePath: () => state.path,
    list: () => state.list,
    visiblePaths: () =>
      state.list.state === "ready"
        ? state.list.paths.filter((path) => path.toLowerCase().includes(state.filter.toLowerCase()))
        : [],
    preview: () => state.preview,
    setFilter: (value) => setState("filter", value),
    select: (path) => {
      setState("path", path)
      preview({ state: "ready", path, file: { kind: "unsupported", path } })
    },
    folder: () => state.folder,
    uploading: () => false,
    selectFolder: (path) => setState("folder", path),
    upload,
    download,
    filesIn: (folder) =>
      state.list.state === "ready" ? state.list.paths.filter((path) => path.startsWith(`${folder}/`)) : [],
    move,
    remove,
    moveFolder,
    removeFolder,
    refresh: vi.fn(),
    reload,
  }
  render(() => (
    <DialogProvider>
      <FileBrowser open={state.open} model={model} tree={tree?.shown} onTreeChange={tree?.change}>
        {(view) => (
          <RightSidebar
            open={state.open}
            size={{ width: () => 720, min: 480, max: () => 960, full: () => 1440, resize: () => {}, reset: () => {} }}
            close={() => setState("open", false)}
            restoreFocus={() => {}}
            header={view.actions}
          >
            {view.content}
          </RightSidebar>
        )}
      </FileBrowser>
    </DialogProvider>
  ))
  return {
    model,
    reload,
    upload,
    download,
    move,
    remove,
    moveFolder,
    removeFolder,
    preview,
    setOpen: (open: boolean) => setState("open", open),
    list: (value: ProjectFileListState) => setState("list", reconcile(value)),
  }
}

describe("FileBrowser", () => {
  it("starts with the tree in its persisted state and reports toggles", async () => {
    const change = vi.fn()
    mount({ state: "idle" }, { shown: true, change })
    const browser = document.querySelector('[data-component="file-browser"]')!
    expect(browser).toHaveAttribute("data-tree-open")
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide file tree" }))
    expect(change).toHaveBeenCalledWith(false)
  })

  it("animates file tree toggles with the right sidebar width transition", async () => {
    mount()
    const browser = document.querySelector('[data-component="file-browser"]')!
    const sidebar = browser.querySelector('[data-slot="file-browser-sidebar"]')!
    expect(browser).not.toHaveAttribute("data-animating")
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    expect(browser).toHaveAttribute("data-tree-open")
    expect(browser).toHaveAttribute("data-animating")
    const end = new Event("transitionend", { bubbles: true })
    Object.defineProperty(end, "propertyName", { value: "width" })
    fireEvent(sidebar, end)
    expect(browser).not.toHaveAttribute("data-animating")
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide file tree" }))
    expect(browser).not.toHaveAttribute("data-tree-open")
    expect(browser).toHaveAttribute("data-animating")
  })

  it("renders directory lifecycle states, retries, and file-tree controls", async () => {
    const state = mount()
    await Promise.resolve()
    expect(screen.getByRole("searchbox", { name: "Filter project files" })).not.toHaveFocus()
    expect(document.querySelector('[data-component="file-browser"]')).not.toHaveAttribute("data-tree-open")
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    expect(screen.getByRole("searchbox", { name: "Filter project files" })).toHaveFocus()
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Project files")
    state.list({ state: "loading" })
    expect(screen.getByRole("status")).toHaveTextContent("Loading Project files")
    state.list({ state: "ready", paths: [] })
    expect(screen.getByText("This Project has no files.")).toBeVisible()
    state.list({ state: "error", message: "Unable to load Project files." })
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Project files")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(state.reload).toHaveBeenCalledOnce()
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide file tree" }))
    expect(screen.getByRole("button", { name: "Show file tree" })).toHaveAttribute("aria-pressed", "false")
    expect(document.querySelector('[data-component="file-browser"]')).not.toHaveAttribute("data-tree-open")
  })

  it("uploads chosen files and marks the selected folder as the upload target", async () => {
    const state = mount({ state: "ready", paths: ["README.md", "docs/guide.md"] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Show file tree" }))
    expect(screen.getByRole("button", { name: "Upload files" })).toHaveAttribute(
      "title",
      "Upload files to Project root",
    )
    await user.click(screen.getByRole("treeitem", { name: "docs" }))
    expect(screen.getByText("Uploads go to docs/")).toBeVisible()
    expect(screen.getByRole("button", { name: "Upload files" })).toHaveAttribute("title", "Upload files to docs")
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    await user.upload(screen.getByLabelText("Choose files to upload"), file)
    expect(state.upload).toHaveBeenCalledWith([file])
    await user.click(screen.getByRole("button", { name: "Use root" }))
    expect(screen.queryByText("Uploads go to docs/")).not.toBeInTheDocument()
  })

  it("keeps Upload unavailable until the file list is ready", async () => {
    const state = mount()
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    expect(screen.getByRole("button", { name: "Upload files" })).toBeDisabled()
    state.list({ state: "ready", paths: [] })
    expect(screen.getByRole("button", { name: "Upload files" })).toBeEnabled()
  })

  it("downloads from the preview header and from a file row menu", async () => {
    const state = mount({ state: "ready", paths: ["docs/guide.md"] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Show file tree" }))
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Actions for docs/guide.md" }))
    await user.click(screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Download")!)
    expect(state.download).toHaveBeenCalledWith("docs/guide.md")
    state.download.mockClear()
    await user.click(screen.getByRole("treeitem", { name: "guide.md" }))
    await user.click(screen.getByRole("button", { name: "Download guide.md" }))
    expect(state.download).toHaveBeenCalledWith("docs/guide.md")
  })

  it("renames a file through its full path, keeping the dialog open with an inline conflict", async () => {
    const state = mount({ state: "ready", paths: ["docs/guide.md", "docs/taken.md"] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Show file tree" }))
    await user.click(screen.getByRole("button", { name: "Actions for docs/guide.md" }))
    await user.click(menuItem("Rename…"))
    const dialog = await screen.findByRole("dialog", { name: "Rename guide.md" })
    const input = within(dialog).getByRole("textbox", { name: "File path" })
    expect(input).toHaveValue("docs/guide.md")
    await waitFor(() => expect(input).toHaveFocus())
    // The file name without its extension is selected, so typing renames in place.
    expect([(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd]).toEqual([5, 10])
    expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled()

    state.move.mockRejectedValueOnce(new Error("A file already exists at docs/taken.md"))
    await user.clear(input)
    await user.type(input, "docs/taken.md")
    await user.click(within(dialog).getByRole("button", { name: "Rename" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A file already exists at docs/taken.md")
    expect(state.move).toHaveBeenLastCalledWith("docs/guide.md", "docs/taken.md")

    await user.clear(input)
    await user.type(input, " archive/guide.md ")
    await user.click(within(dialog).getByRole("button", { name: "Rename" }))
    expect(state.move).toHaveBeenLastCalledWith("docs/guide.md", "archive/guide.md")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename guide.md" })).not.toBeInTheDocument())
  })

  it("deletes a file only after confirmation", async () => {
    const state = mount({ state: "ready", paths: ["docs/guide.md"] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Show file tree" }))
    await user.click(screen.getByRole("button", { name: "Actions for docs/guide.md" }))
    await user.click(menuItem("Delete…"))
    const dialog = await screen.findByRole("dialog", { name: "Delete guide.md?" })
    expect(dialog).toHaveTextContent("This cannot be undone.")
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(state.remove).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Actions for docs/guide.md" }))
    await user.click(menuItem("Delete…"))
    await user.click(
      within(await screen.findByRole("dialog", { name: "Delete guide.md?" })).getByRole("button", { name: "Delete" }),
    )
    expect(state.remove).toHaveBeenCalledWith("docs/guide.md")
  })

  it("renames and deletes folders, naming how many files the deletion removes", async () => {
    const state = mount({ state: "ready", paths: ["docs/a.md", "docs/nested/b.md", "readme.md"] })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Show file tree" }))
    await user.click(screen.getByRole("button", { name: "Actions for folder docs" }))
    await user.click(menuItem("Rename folder…"))
    const rename = await screen.findByRole("dialog", { name: "Rename folder docs" })
    const input = within(rename).getByRole("textbox", { name: "Folder path" })
    await user.clear(input)
    await user.type(input, "guides")
    await user.click(within(rename).getByRole("button", { name: "Rename" }))
    expect(state.moveFolder).toHaveBeenCalledWith("docs", "guides")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename folder docs" })).not.toBeInTheDocument())

    await user.click(screen.getByRole("button", { name: "Actions for folder docs" }))
    await user.click(menuItem("Delete folder…"))
    const confirm = await screen.findByRole("dialog", { name: "Delete docs?" })
    expect(confirm).toHaveTextContent("This deletes 2 files in docs/. This cannot be undone.")
    await user.click(within(confirm).getByRole("button", { name: "Delete 2 files" }))
    expect(state.removeFolder).toHaveBeenCalledWith("docs")
  })

  it("filters the existing file tree and clears the filter with Escape", async () => {
    mount({ state: "ready", paths: ["README.md", "docs/architecture.md", "docs/guide.md"] })
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    const input = screen.getByRole("searchbox", { name: "Filter project files" })
    await userEvent.setup().type(input, "architecture")
    expect(screen.getByRole("treeitem", { name: "architecture.md" })).toBeVisible()
    expect(screen.queryByRole("treeitem", { name: "README.md" })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(input).toHaveValue("")
    expect(screen.getByRole("treeitem", { name: "README.md" })).toBeVisible()
  })

  it("renders empty, loading, error, and ready previews", async () => {
    const state = mount({ state: "ready", paths: ["archive.zip"] })
    expect(screen.getByText("Select a file to preview.")).toBeVisible()
    state.preview({ state: "loading", path: "README.md" })
    const loading = screen.getByRole("status")
    expect(loading).toHaveTextContent("Loading file")
    expect(loading.querySelector('[data-component="spinner"]')).toBeVisible()
    state.preview({ state: "error", path: "README.md", message: "Unable to load README.md." })
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load README.md")
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }))
    expect(state.reload).toHaveBeenCalledOnce()
    state.model.select("archive.zip")
    expect(screen.getByText("Preview is not available for this file type.")).toBeVisible()
  })

  it("keeps desktop keyboard focus on the selected tree item", async () => {
    mount({ state: "ready", paths: ["README.md"] })
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    const file = screen.getByRole("treeitem", { name: "README.md" })
    file.focus()
    fireEvent.click(file)
    await Promise.resolve()
    expect(file).toHaveFocus()
  })

  it("focuses mobile preview on selection and returns to the filter", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    )
    mount({ state: "ready", paths: ["README.md"] })
    await userEvent.setup().click(screen.getByRole("button", { name: "Show file tree" }))
    fireEvent.click(screen.getByRole("treeitem", { name: "README.md" }))
    await Promise.resolve()
    const back = screen.getByRole("button", { name: "Back to files" })
    expect(back).toHaveFocus()
    fireEvent.click(back)
    expect(screen.getByRole("searchbox", { name: "Filter project files" })).toHaveFocus()
    expect(document.querySelector('[data-component="file-browser"]')).not.toHaveAttribute("data-mobile-preview")
  })

  it("reveals an externally selected file when the mobile sidebar opens", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    )
    const state = mount({ state: "ready", paths: ["README.md"] })
    state.setOpen(false)
    state.model.select("README.md")
    state.setOpen(true)
    await Promise.resolve()
    expect(document.querySelector('[data-component="file-browser"]')).toHaveAttribute("data-mobile-preview")
    expect(screen.getByRole("button", { name: "Back to files" })).not.toHaveFocus()
  })
})
