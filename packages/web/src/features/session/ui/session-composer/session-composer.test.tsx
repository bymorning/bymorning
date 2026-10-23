/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixture implements only the exercised session seam. */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { batch, createRoot, createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createPromptState } from "../../../../context/prompt-state"
import { createController } from "../../composer-controller"
import { directoryFixture } from "../../../../test/directory"
import { QueryClient, useMutation } from "@tanstack/solid-query"
import { Composer, type ComposerModel } from "."
import type { ComposerAgent } from "./model"
import { draftLimit } from "./input"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderComposer(model: ComposerModel) {
  render(() => <Composer model={model} />)
}

function edit(input: HTMLDivElement, value: string, caret = value.length) {
  input.textContent = value
  setEditorSelection(input, caret)
  fireEvent.input(input)
}

function editorSelection(input: HTMLDivElement) {
  const range = document.createRange()
  range.selectNodeContents(input)
  const selection = document.getSelection()!
  range.setEnd(selection.focusNode!, selection.focusOffset)
  return { start: range.toString().length }
}

function setEditorSelection(input: HTMLDivElement, caret: number) {
  const range = document.createRange()
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let offset = 0
  while (node && offset + (node.textContent?.length ?? 0) < caret) {
    offset += node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  range.setStart(node ?? input, caret - offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function setup(
  initial = "Hello",
  process: "idle" | "running" = "idle",
  search = vi.fn().mockResolvedValue([]),
  slashCommands: ComposerModel["slashCommands"] = { search: () => undefined, select: () => false },
  projectFiles: ReadonlyArray<string> = [],
  initialSkills: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string }> = [],
  initialAgents: ReadonlyArray<ComposerAgent> = [],
) {
  const [text, setText] = createSignal(initial)
  const [cursor, setCursor] = createSignal<number>()
  const [command, setCommand] = createSignal<"submit" | "stop" | undefined>(process === "idle" ? "submit" : "stop")
  const [error, setError] = createSignal<string>()
  const [pending, setPending] = createSignal(false)
  const [projectScope, setProjectScope] = createSignal<ReturnType<ComposerModel["projectFiles"]["scope"]>>(
    "project" as never,
  )
  const [paths, setProjectFiles] = createSignal(projectFiles)
  const skills = () => initialSkills
  const agents = () => initialAgents
  const [agentAttachments, setAgentAttachments] = createSignal<ReturnType<ComposerModel["agentAttachments"]>>([])

  const [attachments, setAttachments] = createSignal<
    ComposerModel["attachments"]["items"] extends () => infer A ? A : never
  >([])
  const submit = vi.fn()
  const stop = vi.fn()
  const add = vi.fn()
  renderComposer({
    value: text,
    cursor,
    error,
    pending,
    command,
    slashCommands,
    selection: {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
      model: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
      error: () => undefined,
    },
    selectionVisibility: { agent: () => false, variant: () => false },
    projectFiles: { scope: projectScope, list: paths, search },
    skills,
    agents,
    agentAttachments,
    attachments: {
      items: attachments,
      disabled: () => projectScope() === undefined,
      add,
      remove: (id) => setAttachments((items) => items.filter((item) => item.id !== id)),
    },
    blank: () => text().trim().length === 0 && !attachments().some((item) => item.state === "ready"),
    restoreFocus: () => {},
    edit: (value, nextCursor, nextAgents = []) =>
      batch(() => {
        setText(value)
        setAgentAttachments(nextAgents)
        if (nextCursor !== undefined) setCursor(nextCursor)
      }),
    submit,
    stop,
  })
  return {
    text,
    setText,
    setCommand,
    setError,
    setPending,
    setProjectScope,
    setProjectFiles,
    agentAttachments,
    setAttachments,
    submit,
    stop,
    add,
  }
}

describe("Composer", () => {
  it("renders reactive input, error, and actions", () => {
    const state = setup()
    const input = screen.getByRole("combobox", { name: "Message" })
    expect(input).toHaveAttribute("data-component", "project-file-reference-editor")
    expect(input).toHaveAttribute("data-slot", "session-composer-editor")
    expect(input).toHaveTextContent("Hello")
    state.setText("Updated")
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveTextContent("Updated")
    state.setCommand("stop")
    state.setError("Network lost")
    expect(screen.getByRole("alert")).toHaveTextContent("Network lost")
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()
  })

  it("styles exact Project File references and unwraps them after text editing", () => {
    const state = setup("Review @README.md")
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement

    state.setProjectFiles(["README.md"])
    const reference = input.querySelector<HTMLElement>('[data-component="project-file-reference"]')!

    expect(reference).toHaveTextContent("@README.md")
    reference.textContent = "@README.m"
    setEditorSelection(input, input.textContent.length)
    fireEvent.input(input)

    expect(state.text()).toBe("Review @README.m")
    expect(input.querySelector('[data-component="project-file-reference"]')).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: "z", ctrlKey: true })
    expect(state.text()).toBe("Review @README.md")
    expect(input.querySelector('[data-component="project-file-reference"]')).toHaveTextContent("@README.md")

    fireEvent.keyDown(input, { key: "z", ctrlKey: true, shiftKey: true })
    expect(state.text()).toBe("Review @README.m")
    expect(input.querySelector('[data-component="project-file-reference"]')).not.toBeInTheDocument()
  })

  it("strips browser formatting from unmatched editable text", () => {
    const state = setup("")
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    input.innerHTML = '<font color="blue">@missing.md</font>'
    setEditorSelection(input, input.textContent.length)
    fireEvent.input(input)

    expect(state.text()).toBe("@missing.md")
    expect(input.innerHTML).toBe("@missing.md")
  })

  it("restores the caret where an undone edit began", () => {
    const state = setup("Hello")
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    setEditorSelection(input, 2)
    fireEvent(
      input,
      new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "X", inputType: "insertText" }),
    )
    input.textContent = "HeXllo"
    setEditorSelection(input, 3)
    fireEvent.input(input)

    fireEvent.keyDown(input, { key: "z", ctrlKey: true })

    expect(state.text()).toBe("Hello")
    expect(editorSelection(input).start).toBe(2)
  })

  it("enforces the draft limit while preserving IME-safe submission", () => {
    const state = setup("")
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement

    // A long pasted document (well past the former 8,000 character limit) is kept whole and sends.
    edit(input, "a".repeat(120_000))
    expect(state.text()).toHaveLength(120_000)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(state.submit).toHaveBeenCalledOnce()
    state.submit.mockClear()

    edit(input, "a".repeat(draftLimit + 1))
    expect(state.text()).toHaveLength(draftLimit)
    expect(input.textContent).toHaveLength(draftLimit)

    fireEvent.keyDown(input, { key: "Enter", isComposing: true })
    expect(state.submit).not.toHaveBeenCalled()
  })

  it("renders uploading, ready, and failed attachments without blocking editing or submission", () => {
    const state = setup("Question")
    state.setAttachments([
      { id: "uploading", state: "uploading", path: "large.png" },
      { id: "ready", state: "ready", path: "notes.txt" },
      { id: "error", state: "error", path: "broken.pdf" },
      { id: "image", state: "ready", path: "photo.png" },
    ])

    expect(screen.getByRole("status")).toHaveTextContent("Uploading large.png")
    expect(screen.getByText("Upload failed")).toBeInTheDocument()
    const strip = screen.getByRole("group", { name: "Attachments" })
    expect(strip).toHaveAttribute("data-slot", "session-composer-attachments-scroll")
    expect(strip.querySelectorAll('[data-slot="session-composer-attachment"]')).toHaveLength(4)
    expect(screen.getByText("Image")).toBeInTheDocument()
    expect(strip.querySelector('[data-state="uploading"]')).toHaveAttribute("aria-busy", "true")
    expect(strip.querySelector('[data-state="ready"]')).toHaveTextContent("Text")
    expect(screen.getByRole("combobox", { name: "Message" })).not.toBeDisabled()
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled()
    expect(screen.queryByRole("button", { name: "Remove large.png" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }))
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove broken.pdf" }))
    expect(screen.queryByText("broken.pdf")).not.toBeInTheDocument()
  })

  it("moves focus to the next attachment, then back to the editor, as chips are removed", async () => {
    const state = setup("Question")
    state.setAttachments([
      { id: "a", state: "ready", path: "a.txt" },
      { id: "b", state: "ready", path: "b.txt" },
    ])
    const first = screen.getByRole("button", { name: "Remove a.txt" })
    first.focus()
    fireEvent.click(first)
    const second = screen.getByRole("button", { name: "Remove b.txt" })
    expect(second).toHaveFocus()
    fireEvent.click(second)
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveFocus()
  })

  it("returns focus to the editor when Stop is clicked", async () => {
    const state = setup("  \n", "running")
    state.stop.mockResolvedValue(undefined)
    const stop = screen.getByRole("button", { name: "Stop" })
    stop.focus()
    fireEvent.click(stop)
    expect(state.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveFocus()
  })

  it("adds dropped and pasted files while preserving native text paste", () => {
    const state = setup("Question")
    const files = [new File(["image"], "image.png", { type: "image/png" })]

    fireEvent.drop(screen.getByRole("form", { name: "Prompt" }), { dataTransfer: { files, types: ["Files"] } })
    expect(
      fireEvent.paste(screen.getByRole("combobox", { name: "Message" }), {
        clipboardData: { files, getData: () => "ordinary text" },
      }),
    ).toBe(true)
    expect(state.add).toHaveBeenCalledTimes(2)
    expect(state.add).toHaveBeenNthCalledWith(1, files)
    expect(state.add).toHaveBeenNthCalledWith(2, files)
  })

  it("associates labels with unique inputs across composer instances", () => {
    setup()
    setup("Second")
    const inputs = screen.getAllByRole("combobox", { name: "Message" })
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.id).not.toBe(inputs[1]?.id)
  })

  it("morphs blank active Send to Stop and uses native keyboard submission", () => {
    const state = setup("  \n", "running")
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(state.stop).toHaveBeenCalledOnce()
    state.setCommand("submit")
    state.setText("Question")
    const input = screen.getByRole("combobox", { name: "Message" })
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(state.submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(state.submit).toHaveBeenCalledOnce()
    state.setCommand(undefined)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(state.submit).toHaveBeenCalledOnce()
  })

  it("morphs Send to Stop while pending even before the draft clears", () => {
    const state = setup("Hello")
    state.setPending(true)
    state.setCommand("stop")
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
  })

  it("enables whitespace with a ready attachment as attachment-only input", () => {
    const state = setup(" \n")
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
    state.setAttachments([{ id: "ready", state: "ready", path: "notes.txt" }])
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled()
  })

  it("suppresses rapid stop shortcuts through the controller and presents stop pending", async () => {
    let resolve!: () => void
    const cancel = vi.fn(() => new Promise<void>((done) => (resolve = done)))
    const controller = createRoot(() => {
      const query = new QueryClient()
      const mutation = useMutation(
        () => ({ mutationFn: cancel, retry: false }),
        () => query,
      )
      return createController({
        data: {
          draft: () => "draft",
          detail: () => ({ state: "ready", data: {} }),
          transcript: () => ({
            state: "ready",
            data: [{ message: { type: "pending-user" }, activity: { state: "running" } }],
          }),
        },
        prompt: createPromptState({ text: "draft" }),
        composer: {
          pending: () => mutation.isPending,
          error: () => mutation.error?.message,
          submit: vi.fn(),
          cancel: mutation.mutateAsync,
        },
        commands: { register: vi.fn(), slash: { search: () => undefined, select: () => false } },
        projectDirectory: { search: vi.fn().mockResolvedValue([]), ...directoryFixture() },
        skills: () => [],
        agents: () => [],

        selection: {
          agent: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          model: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          variant: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          error: () => undefined,
        },
        selectionVisibility: { agent: () => false, variant: () => false },
      } as never)
    })
    renderComposer(controller)
    const input = screen.getByRole("combobox", { name: "Message" })
    fireEvent.keyDown(input, { key: "Enter", isComposing: true })
    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.keyDown(input, { key: "g", ctrlKey: true })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(screen.getByRole("form", { name: "Prompt" })).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled()
    resolve()
    await vi.waitFor(() => expect(controller.pending()).toBe(false))
  })

  it("debounces project file search, exposes listbox state, and inserts before submission", async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockResolvedValue(Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`))
    const state = setup("", "idle", search)
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    edit(input, "Review (@src) later", 12)

    expect(screen.getByRole("listbox", { name: "References" })).toBeInTheDocument()
    expect(screen.getByRole("listbox", { name: "References" })).toHaveAttribute(
      "data-component",
      "session-composer-completions",
    )
    expect(screen.getByRole("status")).toHaveTextContent("Searching")
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(search).toHaveBeenCalledWith("src", expect.any(AbortSignal))
    expect(screen.getAllByRole("option")).toHaveLength(10)
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("data-slot", "session-composer-completion-row")
    expect(screen.getAllByRole("option")[0]!.querySelector('bdi[dir="auto"]')).toHaveTextContent("src/file-0.ts")
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]!.id)

    fireEvent.keyDown(input, { key: "n", ctrlKey: true })
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1]!.id)
    fireEvent.keyDown(input, { key: "p", ctrlKey: true })
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]!.id)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    await vi.runAllTimersAsync()
    expect(state.submit).not.toHaveBeenCalled()
    expect(input.textContent).toBe("Review (@src/file-1.ts ) later")
    expect(editorSelection(input).start).toBe(23)
    expect(screen.queryByRole("listbox", { name: "References" })).not.toBeInTheDocument()
  })

  it("shows cached project files immediately and retains them when refresh fails", async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockRejectedValue(new Error("offline"))
    setup("", "idle", search, undefined, ["src/main.ts", "README.md"])
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    edit(input, "@")

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["src/main.ts", "README.md"])
    expect(screen.getAllByRole("option")[0]!.querySelector('[data-component="file-icon"]')).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)

    expect(search).toHaveBeenCalledWith("", expect.any(AbortSignal))
    expect(screen.getByRole("status")).toHaveTextContent("could not be searched")
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["src/main.ts", "README.md"])
  })

  it("closes the reference picker on Escape without clearing the draft, even after the key-up re-syncs", () => {
    setup("", "idle", vi.fn().mockResolvedValue([]), undefined, ["src/main.ts"])
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    edit(input, "Review @")
    expect(screen.getByRole("listbox", { name: "References" })).toBeInTheDocument()

    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.keyUp(input, { key: "Escape" })

    expect(screen.queryByRole("listbox", { name: "References" })).not.toBeInTheDocument()
    expect(input.textContent).toBe("Review @")

    edit(input, "Review @s")
    expect(screen.getByRole("listbox", { name: "References" })).toBeInTheDocument()
  })

  it("lists skills with files and inserts the selected stable skill ID", () => {
    setup(
      "",
      "idle",
      vi.fn().mockResolvedValue(["src/browser.ts"]),
      undefined,
      ["README.md"],
      [{ id: "browser-control", name: "Browser Control", description: "Automate the visible browser." }],
    )
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    edit(input, "@browser")

    const skill = screen.getByRole("option", { name: /Browser Control.*Automate the visible browser/ })
    expect(skill).toHaveAttribute("data-kind", "skill")
    fireEvent.keyDown(input, { key: "Enter" })

    expect(input.textContent).toBe("@browser-control ")
    expect(input.querySelector('[data-component="skill-reference"]')).toHaveAttribute(
      "data-skill-id",
      "browser-control",
    )
    expect(screen.queryByRole("listbox", { name: "References" })).not.toBeInTheDocument()
  })

  it("filters skills by name and ID, not by description", () => {
    setup(
      "",
      "idle",
      vi.fn().mockResolvedValue([]),
      undefined,
      [],
      [
        { id: "bymorning", name: "Bymorning", description: "Shape a hosted workflow for scheduled output" },
        { id: "scheduled-task", name: "Scheduled tasks", description: "Run something on a schedule" },
      ],
    )
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement

    edit(input, "@Sho")
    expect(screen.queryByRole("option", { name: /Bymorning/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Scheduled tasks/ })).not.toBeInTheDocument()

    edit(input, "@sched")
    expect(screen.getByRole("option", { name: /Scheduled tasks/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Bymorning/ })).not.toBeInTheDocument()
  })

  it("returns focus to the editor after a submission settles", () => {
    const state = setup("Hi")
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    input.focus()
    edit(input, "Hi there")
    expect(input).toHaveFocus()

    state.setPending(true)
    input.setAttribute("contenteditable", "false")
    input.blur()
    state.setPending(false)
    return Promise.resolve().then(() => expect(input).toHaveFocus())
  })

  it("hides Agents from reference suggestions", () => {
    setup(
      "",
      "idle",
      vi.fn().mockResolvedValue([]),
      undefined,
      [],
      [{ id: "review", name: "Review Skill", description: "Inspect proposed changes" }],
      [agent("code-reviewer", "Review Agent", "all", false, "Inspect proposed changes")],
    )
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement

    edit(input, "@Review")
    expect(screen.getByRole("option", { name: /Review Skill/ })).toHaveAttribute("data-kind", "skill")
    expect(screen.queryByRole("option", { name: /Review Agent/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Agents")).not.toBeInTheDocument()
  })

  it("keeps cached files bounded while retaining every fixed suggestion", () => {
    setup(
      "",
      "idle",
      undefined,
      undefined,
      Array.from({ length: 5 }, (_, index) => `src/file-${index}.ts`),
      Array.from({ length: 7 }, (_, index) => ({ id: `skill-${index}`, name: `Skill ${index}`, description: "Skill" })),
      Array.from({ length: 7 }, (_, index) => agent(`agent-${index}`, `Agent ${index}`, "all")),
    )
    edit(screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement, "@")

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(12)
    expect(options.filter((option) => option.dataset.kind === "skill")).toHaveLength(7)
    expect(options.filter((option) => option.dataset.kind === "agent")).toHaveLength(0)
    expect(options.filter((option) => option.dataset.kind === "file")).toHaveLength(5)
  })

  it("searches files for @subagent without showing Agents", async () => {
    vi.useFakeTimers()
    const search = vi.fn().mockResolvedValue(["subagent.ts"])
    setup(
      "",
      "idle",
      search,
      undefined,
      ["subagent.ts"],
      [],
      [
        agent("explore", "Explore", "subagent"),
        agent("review", "Review", "all"),
        agent("specialist", "Subagent Specialist", "all"),
        agent("build", "Build", "primary"),
        agent("secret", "Secret", "subagent", true),
      ],
    )
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement

    edit(input, "@subagent")
    await vi.advanceTimersByTimeAsync(100)
    expect(search).toHaveBeenCalledWith("subagent", expect.any(AbortSignal))
    expect(screen.getByRole("option", { name: "subagent.ts" })).toHaveAttribute("data-kind", "file")
    expect(screen.queryByText("Agents")).not.toBeInTheDocument()
  })

  it("accepts the active project file with Tab instead of moving focus", async () => {
    vi.useFakeTimers()
    setup("", "idle", vi.fn().mockResolvedValue(["src/main.ts"]))
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    input.focus()
    edit(input, "@src")
    await vi.advanceTimersByTimeAsync(100)

    fireEvent.keyDown(input, { key: "Tab" })
    await vi.runAllTimersAsync()
    expect(input.textContent).toBe("@src/main.ts ")
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: "z", ctrlKey: true })
    expect(input.textContent).toBe("@src")
    fireEvent.keyDown(input, { key: "z", ctrlKey: true, shiftKey: true })
    expect(input.textContent).toBe("@src/main.ts ")
  })

  it("aborts stale searches and keeps rejected completion failure inside the listbox", async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ReadonlyArray<string>>()
    const second = Promise.withResolvers<ReadonlyArray<string>>()
    const signals: AbortSignal[] = []
    const search = vi.fn((_query: string, signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? first.promise : second.promise
    })
    setup("", "idle", search)
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    edit(input, "@s")
    await vi.advanceTimersByTimeAsync(100)
    edit(input, "@sr")
    expect(signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    first.resolve(["stale.ts"])
    second.reject(new Error("offline"))
    await vi.runAllTimersAsync()

    expect(screen.queryByRole("option", { name: "stale.ts" })).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("could not be searched")
  })

  it("aborts and restarts completion when the Project identity changes", async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<ReadonlyArray<string>>()
    const signals: AbortSignal[] = []
    const search = vi.fn((_query: string, signal: AbortSignal) => {
      signals.push(signal)
      return pending.promise
    })
    const state = setup("", "idle", search)
    const input = screen.getByRole("combobox", { name: "Message" })
    edit(input as HTMLDivElement, "@src")
    await vi.advanceTimersByTimeAsync(100)

    state.setProjectScope("other-project" as never)
    expect(signals[0]?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(search).toHaveBeenCalledTimes(2)
    expect(signals[1]?.aborted).toBe(false)
  })

  it("closes completion when the composer becomes unavailable", async () => {
    vi.useFakeTimers()
    const state = setup("", "idle", vi.fn().mockResolvedValue(["src/main.ts"]))
    const input = screen.getByRole("combobox", { name: "Message" })
    edit(input as HTMLDivElement, "@src")
    await vi.advanceTimersByTimeAsync(100)

    expect(screen.getByRole("listbox", { name: "References" })).toHaveAttribute("aria-busy", "false")
    state.setPending(true)
    expect(screen.queryByRole("listbox", { name: "References" })).not.toBeInTheDocument()
  })

  it("selects with the pointer without moving focus and lets completion Escape win over stop", async () => {
    vi.useFakeTimers()
    const state = setup("", "running", vi.fn().mockResolvedValue(["src/main.ts"]))
    const input = screen.getByRole("combobox", { name: "Message" }) as HTMLDivElement
    input.focus()
    edit(input, "@src")
    await vi.advanceTimersByTimeAsync(100)
    const option = screen.getByRole("option", { name: "src/main.ts" })
    expect(fireEvent.mouseDown(option)).toBe(false)
    expect(document.activeElement).toBe(input)
    fireEvent.click(option)
    await vi.runAllTimersAsync()
    expect(document.activeElement).toBe(input)
    expect(input.textContent).toBe("@src/main.ts ")

    edit(input, "@src")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(state.stop).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(state.stop).toHaveBeenCalledOnce()
  })

  it("runs a whole-draft slash command immediately without submitting prompt text", () => {
    const compact = { id: "session.compact", title: "Compact session", slash: "compact" }
    const select = vi.fn(() => true)
    const state = setup("", "idle", undefined, {
      search: (input) => (/^\/([^\s]*)$/.test(input) ? [compact] : undefined),
      select,
    })
    const input = screen.getByRole("combobox", { name: "Message" })

    edit(input as HTMLDivElement, "/co")
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "/compact Compact session" })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Enter" })

    expect(select).toHaveBeenCalledWith(compact)
    expect(input.textContent).toBe("")
    expect(state.submit).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument()
  })
})

function agent(
  id: string,
  name: string,
  mode: ComposerAgent["mode"],
  hidden = false,
  description?: string,
): ComposerAgent {
  return {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    mode,
    hidden,
  }
}
