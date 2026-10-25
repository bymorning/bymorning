import { fireEvent, render } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { describe, expect, it } from "vitest"

import { ProjectFileReference, type ProjectFileReferenceEditorHandle, type ProjectFileReferenceEditorState } from "."

describe("Project File references", () => {
  it("quotes paths that contain spaces or quotes", () => {
    expect(ProjectFileReference.format("README.md")).toBe("@README.md")
    expect(ProjectFileReference.format('my "notes".md')).toBe('@"my \\"notes\\".md"')
  })

  it("styles only complete references to known paths", () => {
    const view = render(() => (
      <ProjectFileReference.Text
        value={'Read @README.md and @missing.md plus user@README.md and @"my notes.md"'}
        paths={["README.md", "my notes.md"]}
      />
    ))

    expect(view.container.querySelectorAll('[data-component="project-file-reference"]')).toHaveLength(2)
    expect(
      view.container.querySelector('[data-component="project-file-reference"][data-path="README.md"]'),
    ).toHaveTextContent("@README.md")
    expect(
      view.container.querySelector('[data-component="project-file-reference"][data-path="my notes.md"]'),
    ).toHaveTextContent('@"my notes.md"')
  })

  it("renders known skill IDs as skill references and gives them precedence over matching files", () => {
    const view = render(() => (
      <ProjectFileReference.Text
        value="Use @browser-control and @unknown"
        paths={["browser-control"]}
        skills={[{ id: "browser-control", name: "Browser Control" }]}
      />
    ))

    expect(view.container.querySelector('[data-component="skill-reference"]')).toHaveTextContent("@browser-control")
    expect(view.container.querySelector('[data-component="skill-reference"]')).toHaveAttribute(
      "data-skill-id",
      "browser-control",
    )
    expect(view.container.querySelector('[data-component="skill-reference"]')).toHaveAttribute(
      "title",
      "Browser Control",
    )
    expect(view.container.querySelector('[data-component="project-file-reference"]')).not.toBeInTheDocument()
  })

  it("renders stored Agent offsets without a catalog and gives them precedence over inferred references", () => {
    const view = render(() => (
      <ProjectFileReference.Text
        value="Ask @review now"
        paths={["review"]}
        skills={[{ id: "review", name: "Review skill" }]}
        agents={[{ name: "review", mention: { start: 4, end: 11, text: "@review" } }]}
      />
    ))

    expect(
      view.container.querySelector('[data-component="agent-reference"][data-agent-id="review"]'),
    ).toHaveTextContent("@review")
    expect(view.container.querySelector('[data-component="skill-reference"]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="project-file-reference"]')).not.toBeInTheDocument()
  })

  it("ignores malformed historical Agent ranges", () => {
    const view = render(() => (
      <ProjectFileReference.Text
        value="Ask @review now"
        paths={[]}
        agents={[
          { name: "nan", mention: { start: Number.NaN, end: 11, text: "@review" } },
          { name: "infinite", mention: { start: 4, end: Number.POSITIVE_INFINITY, text: "@review" } },
          { name: "fractional", mention: { start: 4.5, end: 11, text: "@review" } },
          { name: "outside", mention: { start: 4, end: 99, text: "@review" } },
          { name: "mismatch", mention: { start: 4, end: 11, text: "@other" } },
        ]}
      />
    ))

    expect(view.container).toHaveTextContent("Ask @review now")
    expect(view.container.querySelector('[data-component="agent-reference"]')).not.toBeInTheDocument()
  })

  it("sorts historical Agent ranges and ignores overlaps without duplicating text", () => {
    const view = render(() => (
      <ProjectFileReference.Text
        value="Ask @review and @explore"
        paths={[]}
        agents={[
          { name: "explore", mention: { start: 16, end: 24, text: "@explore" } },
          { name: "overlap", mention: { start: 8, end: 19, text: "iew and @ex" } },
          { name: "review", mention: { start: 4, end: 11, text: "@review" } },
        ]}
      />
    ))

    expect(view.container.textContent).toBe("Ask @review and @explore")
    expect(
      [...view.container.querySelectorAll('[data-component="agent-reference"]')].map((element) => [
        element.getAttribute("data-agent-id"),
        element.textContent,
      ]),
    ).toEqual([
      ["review", "@review"],
      ["explore", "@explore"],
    ])
  })

  it("preserves the combobox accessibility contract", () => {
    const { editor } = renderEditor({ controls: "reference-list", expanded: true, activeDescendant: "reference-2" })

    expect(editor).toHaveAttribute("role", "combobox")
    expect(editor).toHaveAccessibleName("Message")
    expect(editor).toHaveAttribute("aria-multiline", "true")
    expect(editor).toHaveAttribute("aria-autocomplete", "list")
    expect(editor).toHaveAttribute("aria-controls", "reference-list")
    expect(editor).toHaveAttribute("aria-expanded", "true")
    expect(editor).toHaveAttribute("aria-activedescendant", "reference-2")
    expect(editor.id).toMatch(/-editor$/)
  })

  it("reports pasted files without preventing the browser text paste", () => {
    const pasted: Array<FileList> = []
    const { editor } = renderEditor({ onPasteFiles: (files) => pasted.push(files) })
    const files = { 0: new File(["content"], "notes.txt"), length: 1, item: () => null } as unknown as FileList
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: { files } })

    editor.dispatchEvent(event)

    expect(pasted).toEqual([files])
    expect(event.defaultPrevented).toBe(false)
  })

  it("groups adjacent typing into one undo entry and restores the selection", () => {
    const { editor, states } = renderEditor()

    edit(editor, "insertText", { start: 0, end: 0 }, "a", 1)
    edit(editor, "insertText", { start: 1, end: 1 }, "ab", 2)
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true })

    expect(editor).toHaveTextContent("")
    expect(states.at(-1)).toMatchObject({ value: "", selection: { start: 0, end: 0 } })
  })

  it("keeps paste edits in separate history entries and clears redo after a branch", () => {
    const { editor, states } = renderEditor()

    edit(editor, "insertFromPaste", { start: 0, end: 0 }, "a", 1)
    edit(editor, "insertFromPaste", { start: 1, end: 1 }, "ab", 2)
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true })
    expect(states.at(-1)?.value).toBe("a")
    edit(editor, "insertText", { start: 1, end: 1 }, "ac", 2)
    fireEvent.keyDown(editor, { key: "y", ctrlKey: true })

    expect(states.at(-1)?.value).toBe("ac")
  })

  it("commits composition as one edit while reporting intermediate input", () => {
    const { editor, states } = renderEditor()

    fireEvent.compositionStart(editor)
    beforeInput(editor, "insertCompositionText", { start: 0, end: 0 })
    editor.textContent = "に"
    setSelection(editor, 1)
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "に" })
    editor.textContent = "日本"
    setSelection(editor, 2)
    fireEvent.input(editor, { inputType: "insertCompositionText", data: "本" })
    fireEvent.compositionEnd(editor, { data: "日本" })

    expect(states.map((state) => state.value)).toEqual(["に", "日本", "日本"])
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true })
    expect(states.at(-1)?.value).toBe("")
  })

  it("enforces max length and restores a clamped caret after rendering references", () => {
    const { editor, states } = renderEditor({ maxLength: 5, paths: ["read"] })

    edit(editor, "insertFromPaste", { start: 0, end: 0 }, "@reader", 7)

    expect(editor.textContent).toBe("@read")
    expect(editor.querySelector('[data-component="project-file-reference"]')).toHaveTextContent("@read")
    expect(states.at(-1)).toMatchObject({ value: "@read", selection: { start: 5, end: 5 } })
    expect(selectionOffsets(editor)).toEqual({ start: 5, end: 5 })
  })

  it("transforms Agent ranges around replacements and removes overlapping mentions", () => {
    const agents = [{ name: "review", mention: { start: 4, end: 11, text: "@review" } }]
    const shifted = renderEditor({ value: "Ask @review", agents })
    shifted.handle().replace({ start: 0, end: 0 }, "Please ")

    expect(shifted.states.at(-1)?.agents).toEqual([
      { name: "review", mention: { start: 11, end: 18, text: "@review" } },
    ])

    const removed = renderEditor({ value: "Ask @review", agents })
    removed.handle().replace({ start: 6, end: 8 }, "x")
    expect(removed.states.at(-1)?.agents).toEqual([])
  })
})

function renderEditor(
  options: {
    value?: string
    paths?: ReadonlyArray<string>
    agents?: ReadonlyArray<{ readonly name: string; readonly mention?: { start: number; end: number; text: string } }>
    maxLength?: number
    controls?: string
    expanded?: boolean
    activeDescendant?: string
    onPasteFiles?: (files: FileList) => void
  } = {},
) {
  const states: Array<ProjectFileReferenceEditorState> = []
  let handle: ProjectFileReferenceEditorHandle | undefined
  const view = render(() => (
    <ProjectFileReference.Editor
      value={options.value ?? ""}
      cursor={undefined}
      paths={options.paths ?? []}
      agents={options.agents ?? []}
      disabled={false}
      label="Message"
      placeholder="Type a message"
      maxLength={options.maxLength ?? 100}
      controls={options.controls}
      expanded={options.expanded ?? false}
      activeDescendant={options.activeDescendant}
      onStateChange={(state) => states.push(state)}
      onKeyDown={() => undefined}
      onBlur={() => undefined}
      onPasteFiles={options.onPasteFiles ?? (() => undefined)}
      onEditor={(editor) => (handle = editor)}
    />
  ))
  return {
    editor: view.getByRole("combobox", { name: "Message" }) as HTMLDivElement,
    states,
    handle: () => handle!,
  }
}

function edit(
  editor: HTMLDivElement,
  inputType: string,
  selection: { readonly start: number; readonly end: number },
  value: string,
  caret: number,
) {
  setSelection(editor, selection.start, selection.end)
  beforeInput(editor, inputType, selection)
  editor.textContent = value
  setSelection(editor, caret)
  fireEvent.input(editor, { inputType })
}

function beforeInput(
  editor: HTMLDivElement,
  inputType: string,
  selection: { readonly start: number; readonly end: number },
) {
  setSelection(editor, selection.start, selection.end)
  editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType }))
}

function setSelection(editor: HTMLDivElement, start: number, end = start) {
  const node = editor.firstChild ?? editor
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
}

function selectionOffsets(editor: HTMLDivElement) {
  const selection = document.getSelection()!
  const start = document.createRange()
  start.selectNodeContents(editor)
  start.setEnd(selection.anchorNode!, selection.anchorOffset)
  const end = document.createRange()
  end.selectNodeContents(editor)
  end.setEnd(selection.focusNode!, selection.focusOffset)
  return { start: start.toString().length, end: end.toString().length }
}
