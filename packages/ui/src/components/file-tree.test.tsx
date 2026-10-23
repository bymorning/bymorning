import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FileTree } from "@bymorning/ui/file-tree"

afterEach(cleanup)

describe("FileTree", () => {
  it("projects shared folders once and sorts directories before files at every level", () => {
    render(() => (
      <FileTree
        paths={["src/ui/button.tsx", "README.md", "src/index.ts", "src/ui/input.tsx"]}
        onSelect={() => undefined}
      />
    ))

    const tree = screen.getByRole("tree", { name: "Project files" })
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((row) => row.textContent),
    ).toEqual(["src", "ui", "button.tsx", "input.tsx", "index.ts", "README.md"])
    expect(screen.getByRole("treeitem", { name: "button.tsx" })).toHaveAttribute("aria-level", "3")
  })

  it("represents a file and directory when object keys share the same prefix", async () => {
    const onSelect = vi.fn()
    render(() => <FileTree paths={["foo", "foo/z.md", "foo/a.md"]} activePath="foo" onSelect={onSelect} />)

    const collisions = screen.getAllByRole("treeitem", { name: "foo" })
    expect(collisions).toHaveLength(2)
    expect(collisions[0]!).toHaveAttribute("data-node-type", "directory")
    expect(collisions[0]!).toHaveAttribute("aria-expanded", "true")
    expect(collisions[1]!).toHaveAttribute("data-node-type", "file")
    expect(collisions[1]!).toHaveAttribute("aria-selected", "true")
    expect(collisions[1]!).toHaveAttribute("tabindex", "0")
    expect(screen.getAllByRole("treeitem").map((row) => row.textContent)).toEqual(["foo", "a.md", "z.md", "foo"])

    await userEvent.setup().click(collisions[1]!)
    expect(onSelect).toHaveBeenCalledWith("foo")
    expect(collisions[0]!).toHaveAttribute("aria-expanded", "true")
  })

  it("collapses and expands folders without changing controlled active selection", async () => {
    render(() => (
      <FileTree paths={["src/index.ts", "src/ui/button.tsx"]} activePath="src/index.ts" onSelect={() => undefined} />
    ))

    const src = screen.getByRole("treeitem", { name: "src" })
    expect(src).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("treeitem", { name: "index.ts" })).toHaveAttribute("aria-selected", "true")

    await userEvent.setup().click(src)
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("treeitem", { name: "index.ts" })).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole("treeitem", { name: "src" }))
    expect(screen.getByRole("treeitem", { name: "index.ts" })).toHaveAttribute("data-selected")
  })

  it("emits the complete relative path and renders file icons", async () => {
    const onSelect = vi.fn()
    render(() => <FileTree paths={["src/ui/button.tsx"]} onSelect={onSelect} />)

    const file = screen.getByRole("treeitem", { name: "button.tsx" })
    expect(file.querySelector('[data-component="file-icon"]')).toBeInTheDocument()
    await userEvent.setup().click(file)
    expect(onSelect).toHaveBeenCalledWith("src/ui/button.tsx")
  })

  it("navigates visible rows with the keyboard and scrolls the highlighted row", async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const onSelect = vi.fn()
    render(() => <FileTree paths={["README.md", "src/index.ts"]} onSelect={onSelect} />)

    const src = screen.getByRole("treeitem", { name: "src" })
    src.focus()
    fireEvent.keyDown(src, { key: "ArrowDown" })
    await Promise.resolve()
    expect(screen.getByRole("treeitem", { name: "index.ts" })).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })

    fireEvent.keyDown(screen.getByRole("treeitem", { name: "index.ts" }), { key: "ArrowLeft" })
    await Promise.resolve()
    expect(src).toHaveFocus()
    fireEvent.keyDown(src, { key: "ArrowRight" })
    await Promise.resolve()
    expect(screen.getByRole("treeitem", { name: "index.ts" })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "index.ts" }), { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith("src/index.ts")
  })

  it("uses arrow keys to collapse and reopen a folder", () => {
    render(() => <FileTree paths={["src/index.ts"]} onSelect={() => undefined} />)
    const src = screen.getByRole("treeitem", { name: "src" })

    fireEvent.keyDown(src, { key: "ArrowLeft" })
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("treeitem", { name: "index.ts" })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole("treeitem", { name: "src" }), { key: "ArrowRight" })
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("treeitem", { name: "index.ts" })).toBeInTheDocument()
  })
})
