import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExecutionErrorCard } from "./execution-error-card"
import { Composer, type ComposerModel } from "./session-composer"
import { ModelPickerProvider, SessionSelection } from "./session-selection"
import { BmUiI18nProvider, createBmUiI18n } from "../../../ui/context/i18n"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, "", "/")
})

describe("Composer selection", () => {
  it("keeps the hidden current Model label but excludes it from picker search", async () => {
    const select = vi.fn()
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [
          { key: "old", label: "Older model", hidden: true },
          { key: "new", label: "New model" },
        ],
        current: () => "old",
        pending: () => false,
        select,
      },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection)} />)
    const trigger = screen.getByRole("button", { name: "Model, Older model" })
    await userEvent.click(trigger)
    expect(screen.getByRole("option", { name: "New model" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Older model" })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole("combobox", { name: "Search models" }), "Older")
    expect(screen.getByText("No models found")).toBeInTheDocument()
    expect(select).not.toHaveBeenCalled()
  })

  it("returns focus to the composer after picking a Model, even while the choice is saving", async () => {
    const [pending, setPending] = createSignal(false)
    const [current, setCurrent] = createSignal("old")
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [
          { key: "old", label: "Older model" },
          { key: "new", label: "New model" },
        ],
        current,
        pending,
        select: (key) => {
          setPending(true)
          setCurrent(key)
        },
      },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection)} />)
    await userEvent.click(screen.getByRole("button", { name: "Model, Older model" }))
    await userEvent.click(screen.getByRole("option", { name: "New model" }))
    await waitFor(() => expect(screen.queryByRole("option", { name: "Older model" })).not.toBeInTheDocument())
    ;(document.activeElement as HTMLElement | null)?.blur()
    setPending(false)

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Message" })).toHaveFocus())
  })

  it("picks multiple attachments and resets the native input", async () => {
    const add = vi.fn()
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    const composer = composerModel(selection, add, {
      search: () => [{ id: "review", title: "Review", slash: "review" }],
      select: () => true,
    })
    render(() => <Composer model={composer} />)
    const picker = screen.getByRole("button", { name: "Add to prompt" })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Missing file input")
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")]

    expect(screen.queryByRole("group", { name: "Agent" })).not.toBeInTheDocument()
    expect(picker.compareDocumentPosition(screen.getByRole("group", { name: "Model" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const click = vi.spyOn(input, "click")
    await userEvent.click(picker)
    const menu = screen.getByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Images and files" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Commands /" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Context @" })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Images and files" }))
    expect(click).toHaveBeenCalledOnce()
    await userEvent.upload(input, files)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ length: 2 }))
    expect(input.value).toBe("")
    expect(input).toHaveAttribute("tabindex", "-1")
  })

  it("returns focus to the editor after files are chosen", () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection)} />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Missing file input")
    input.focus()
    fireEvent.change(input)
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveFocus()
  })

  it("hides the Commands entry when no command is available", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection, vi.fn(), { search: () => [], select: () => false })} />)
    await userEvent.click(screen.getByRole("button", { name: "Add to prompt" }))
    const menu = screen.getByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Images and files" })).toBeInTheDocument()
    expect(within(menu).queryByRole("menuitem", { name: "Commands /" })).not.toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Context @" })).toBeInTheDocument()
  })

  it("inserts Context at a mid-string cursor and restores focus with completion open", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection, vi.fn(), undefined, { value: "alpha omega", cursor: 6 })} />)
    const editor = screen.getByRole("combobox", { name: "Message" })
    editor.focus()

    await userEvent.click(screen.getByRole("button", { name: "Add to prompt" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Context @" }))
    expect(editor).toHaveTextContent("alpha @omega")
    expect(editor).toHaveFocus()
    await waitFor(() => expect(screen.getByRole("listbox", { name: "References" })).toBeInTheDocument(), {
      timeout: 3_000,
    })
  })

  it("keyboard-activates Commands at the cursor and lets completion Enter win over submit", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    const submit = vi.fn()
    const select = vi.fn(() => true)
    render(() => (
      <Composer
        model={composerModel(
          selection,
          vi.fn(),
          {
            search: (value) =>
              value === "/"
                ? [{ id: "review", title: "Review", description: "Review changes", slash: "review" }]
                : undefined,
            select,
          },
          { value: "alpha omega", cursor: 6, submit },
        )}
      />
    ))
    const editor = screen.getByRole("combobox", { name: "Message" })
    editor.focus()

    const add = screen.getByRole("button", { name: "Add to prompt" })
    add.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Images and files" })).toHaveAttribute("data-highlighted"),
    )
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(editor).toHaveTextContent("alpha /omega")
    expect(editor).toHaveFocus()
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument(), {
      timeout: 3_000,
    })
    expect(screen.getByRole("option", { name: /review.*Review changes/i })).toBeInTheDocument()

    fireEvent.keyDown(editor, { key: "Enter" })
    expect(select).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it("does not reopen stale Commands results after newer input", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    const model = composerModel(selection, vi.fn(), {
      search: (value) =>
        value === "/" ? [{ id: "review", title: "Review", description: "Review changes", slash: "review" }] : undefined,
      select: () => true,
    })
    render(() => <Composer model={model} />)
    const editor = screen.getByRole("combobox", { name: "Message" })
    await userEvent.click(screen.getByRole("button", { name: "Add to prompt" }))
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })

    await userEvent.click(screen.getByRole("menuitem", { name: "Commands /" }))
    editor.textContent = "/x"
    fireEvent.input(editor, { inputType: "insertText" })
    expect(model.value()).toBe("/x")
    while (frames.length > 0) frames.shift()!(performance.now())

    expect(editor).toHaveTextContent("/x")
    expect(model.value()).toBe("/x")
    expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument()
  })

  it("localizes the add menu in an alternate locale", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    const language = createBmUiI18n(() => "es", {
      "ui.session.composer.add": "Añadir al mensaje",
      "ui.session.composer.attach": "Imágenes y archivos",
      "ui.session.composer.commands": "Comandos",
      "ui.session.composer.context": "Contexto",
    })
    render(() => (
      <BmUiI18nProvider value={language}>
        <Composer
          model={composerModel(selection, vi.fn(), {
            search: () => [{ id: "review", title: "Review", slash: "review" }],
            select: () => true,
          })}
        />
      </BmUiI18nProvider>
    ))

    await userEvent.click(screen.getByRole("button", { name: "Añadir al mensaje" }))
    expect(screen.getByRole("menuitem", { name: "Imágenes y archivos" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Comandos /" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Contexto @" })).toBeInTheDocument()
  })

  it("selects a model and restores picker trigger focus on close", async () => {
    const modelSelect = vi.fn()
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [{ key: "beta", label: "Beta" }],
        current: () => undefined,
        pending: () => false,
        select: modelSelect,
      },
      variant: {
        options: () => [{ key: "default", label: "Default" }],
        current: () => "default",
        pending: () => false,
        select: vi.fn(),
      },
      error: () => undefined,
    }
    const composer = composerModel(selection)
    render(() => <Composer model={composer} />)
    const input = screen.getByRole("combobox", { name: "Message" })
    input.focus()
    const trigger = within(screen.getByRole("group", { name: "Model" })).getByRole("button")
    expect(trigger).toHaveAccessibleName(/model/i)
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole("option", { name: "Beta" }))
    expect(modelSelect).toHaveBeenCalledWith("beta")
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("searches models by normalized name and provider and wraps keyboard selection", async () => {
    const modelSelect = vi.fn()
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [
          { key: "anthropic:claude", label: "Claude", group: "Anthropic" },
          { key: "google:gemini", label: "Gemini", group: "Google" },
          { key: "openai:gpt-5", label: "GPT-5", group: "OpenAI" },
        ],
        current: () => "anthropic:claude",
        pending: () => false,
        select: modelSelect,
      },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection)} />)

    await userEvent.click(within(screen.getByRole("group", { name: "Model" })).getByRole("button"))
    const search = screen.getByRole("combobox", { name: "Search models" })
    await waitFor(() => expect(search).toHaveFocus())
    expect(screen.getByText("Anthropic")).toBeInTheDocument()
    expect(screen.getByText("Google")).toBeInTheDocument()
    expect(screen.getByText("OpenAI")).toBeInTheDocument()

    await userEvent.type(search, "gpt5")
    expect(screen.getByRole("option", { name: "GPT-5" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Claude" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Clear model search" }))
    await userEvent.type(search, "openai")
    expect(screen.getByRole("option", { name: "GPT-5" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Clear model search" }))
    await userEvent.type(search, "missing")
    expect(screen.getByText("No models found")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Clear model search" }))
    await userEvent.type(search, "{ArrowUp}{Enter}")
    expect(modelSelect).toHaveBeenCalledWith("openai:gpt-5")
  })

  it("selects Variant options and keeps controlled menus mutually exclusive", async () => {
    const variantSelect = vi.fn()
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [{ key: "model-a", label: "Alpha" }],
        current: () => "model-a",
        pending: () => false,
        select: vi.fn(),
      },
      variant: {
        options: () => [
          { key: "default", label: "Default" },
          { key: "fast", label: "fast" },
        ],
        current: () => "default",
        pending: () => false,
        select: variantSelect,
      },
      error: () => undefined,
    }
    const composer = composerModel(selection)
    render(() => <Composer model={composer} />)

    const input = screen.getByRole("combobox", { name: "Message" })
    const modelTrigger = within(screen.getByRole("group", { name: "Model" })).getByRole("button")
    const variant = within(screen.getByRole("group", { name: "Variant" })).getByRole("button")

    await userEvent.click(modelTrigger)
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument()
    await userEvent.click(variant)
    await waitFor(() => expect(modelTrigger).toHaveAttribute("aria-expanded", "false"))
    expect(variant).toHaveAttribute("aria-expanded", "true")
    await Promise.resolve()
    expect(input).not.toHaveFocus()

    await userEvent.click(screen.getByRole("option", { name: "fast" }))
    expect(variantSelect).toHaveBeenCalledWith("fast")
  })

  it("links Manage models from the picker search row to the workspace models route", async () => {
    window.history.pushState({}, "", "/w/wrk_09028276d001ZOoNDkajkZEVIx/session/ses_1")
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [{ key: "model-a", label: "Alpha" }],
        current: () => "model-a",
        pending: () => false,
        select: vi.fn(),
      },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => <Composer model={composerModel(selection)} />)
    await userEvent.click(screen.getByRole("button", { name: "Model, Alpha" }))
    const manage = screen.getByRole("link", { name: "Manage models" })
    expect(manage).toHaveAttribute("href", "/w/wrk_09028276d001ZOoNDkajkZEVIx/gateway/models")
    expect(manage.compareDocumentPosition(screen.getByRole("combobox", { name: "Search models" }))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it("opens the model picker from a provider error recovery action", async () => {
    const selection: SessionSelection.Model = {
      agent: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      model: {
        options: () => [{ key: "model-a", label: "Alpha" }],
        current: () => "model-a",
        pending: () => false,
        select: vi.fn(),
      },
      variant: { options: () => [], current: () => undefined, pending: () => false, select: vi.fn() },
      error: () => undefined,
    }
    render(() => (
      <ModelPickerProvider>
        <ExecutionErrorCard
          failure={{
            type: "provider",
            summary: "Fireworks: authentication failed (401)",
            message: "Invalid API key",
          }}
        />
        <Composer model={composerModel(selection)} />
      </ModelPickerProvider>
    ))
    expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Choose a different model" }))
    expect(screen.getByRole("combobox", { name: "Search models" })).toBeVisible()
  })
})

function composerModel(
  selection: SessionSelection.Model,
  add = vi.fn(),
  slashCommands: ComposerModel["slashCommands"] = { search: () => undefined, select: () => false },
  prompt: { readonly value?: string; readonly cursor?: number; readonly submit?: () => void } = {},
): ComposerModel {
  const [value, setValue] = createSignal(prompt.value ?? "")
  const [cursor, setCursor] = createSignal(prompt.cursor)
  return {
    value,
    cursor,
    error: () => undefined,
    pending: () => false,
    command: () => "submit",
    slashCommands,
    selection,
    selectionVisibility: { agent: () => true, variant: () => true },
    projectFiles: { scope: () => undefined, list: () => [], search: async () => [] },
    skills: () => [],
    agents: () => [],
    agentAttachments: () => [],

    attachments: { items: () => [], disabled: () => false, add, remove: vi.fn() },
    blank: () => value().trim().length === 0,
    restoreFocus: () => {},
    edit: (next, nextCursor) => {
      setValue(next)
      if (nextCursor !== undefined) setCursor(nextCursor)
    },
    submit: prompt.submit ?? (() => {}),
    stop: () => {},
  }
}
