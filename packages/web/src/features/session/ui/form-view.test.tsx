import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createStore } from "solid-js/store"
import { describe, expect, it, vi } from "vitest"
import type { FormField, FormFieldValue, FormViewModel } from "./form-model"
import { FormView } from "./form-view"

function viewItem(fields: ReadonlyArray<FormField>, overrides: Partial<FormViewModel> = {}): FormViewModel {
  return {
    id: "frm_view",
    title: "Questions",
    fields,
    sections: [{ fields }],
    choicePresentation: "select",
    canGoBack: false,
    submitLabel: "Submit",
    ...overrides,
  }
}

describe("FormView", () => {
  it("renders declared and custom choices and dispatches submit and cancel", async () => {
    const [answers, setAnswers] = createStore<Record<string, FormFieldValue | undefined>>({})
    const submit = vi.fn()
    const cancel = vi.fn()
    render(() => (
      <FormView
        item={viewItem([
          {
            key: "choice",
            title: "Choice",
            type: "string",
            options: [{ value: "A", label: "Option A", description: "First option" }],
            custom: true,
            required: true,
          },
        ])}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={cancel}
      />
    ))
    expect(screen.getByText("Option A")).toBeInTheDocument()
    expect(screen.queryByText("Response requested")).not.toBeInTheDocument()
    expect(screen.queryByText(/answered$/)).not.toBeInTheDocument()
    expect(screen.queryByText("Required")).not.toBeInTheDocument()
    expect(screen.queryByText("Or write your own answer")).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Missing required form field: choice")
    await fireEvent.input(screen.getByLabelText("Choice custom value"), { target: { value: "Other" } })
    expect(answers.choice).toBe("Other")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(submit).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("requires at least one answer before submitting Questions", async () => {
    const [answers, setAnswers] = createStore<Record<string, FormFieldValue | undefined>>({})
    const submit = vi.fn()
    const view = render(() => (
      <FormView
        item={viewItem(
          [
            {
              key: "q0",
              title: "Name",
              type: "string",
              options: [{ value: "Type your name", label: "Type your name" }],
              custom: true,
            },
            {
              key: "q1",
              title: "Colors",
              type: "multiselect",
              options: [{ value: "Red", label: "Red" }],
              custom: true,
            },
          ],
          { answerRequired: true },
        )}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={vi.fn()}
      />
    ))
    const current = within(view.container)
    await fireEvent.input(current.getByLabelText("Name custom value"), { target: { value: "   " } })
    setAnswers("q1", [])
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).not.toHaveBeenCalled()
    expect(current.getByRole("alert")).toHaveTextContent("Answer at least one question, or choose Cancel to skip.")

    await fireEvent.input(current.getByLabelText("Name custom value"), { target: { value: "Ada" } })
    expect(current.queryByRole("alert")).not.toBeInTheDocument()
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).toHaveBeenCalledOnce()
  })

  it("renders card choices with back navigation and a custom submit label", async () => {
    const back = vi.fn()
    const action = {
      key: "__wizard_action",
      type: "string",
      default: "next",
      options: [
        { value: "next", label: "Next" },
        { value: "back", label: "Back" },
      ],
    } as const
    const formatField = {
      key: "format",
      title: "Format",
      type: "string",
      required: true,
      options: [
        { value: "mcp", label: "MCP server", description: "Remote server" },
        { value: "openapi", label: "OpenAPI", description: "JSON specification" },
      ],
    } as const
    render(() => (
      <FormView
        item={viewItem([action, formatField], {
          sections: [{ fields: [formatField] }],
          choicePresentation: "cards",
          canGoBack: true,
          submitLabel: "Continue",
        })}
        answers={{ format: "mcp" }}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onBack={back}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByRole("radiogroup", { name: "Format" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Format" })).not.toBeInTheDocument()
    expect(screen.queryByText("Next", { selector: "label" })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(back).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument()
  })

  it("renders wizard navigation with dropdown choices", async () => {
    const back = vi.fn()
    const action = {
      key: "__wizard_action",
      type: "string",
      default: "next",
      options: [
        { value: "next", label: "Next" },
        { value: "back", label: "Back" },
      ],
    } as const
    const toolField = {
      key: "tool",
      title: "Tool",
      type: "string",
      required: true,
      options: [
        { value: "Read", label: "Read" },
        { value: "Write", label: "Write" },
      ],
    } as const
    const view = render(() => (
      <FormView
        item={viewItem([action, toolField], {
          sections: [{ fields: [toolField] }],
          canGoBack: true,
          submitLabel: "Next",
        })}
        answers={{ tool: "Read" }}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onBack={back}
        onCancel={() => undefined}
      />
    ))

    const current = within(view.container)
    const tool = current.getByRole("group", { name: "Tool" })
    expect(tool).toHaveAttribute("data-component", "select-root")
    expect(within(tool).getByRole("button", { name: "Read" })).toHaveAttribute("aria-haspopup", "listbox")
    expect(current.queryByRole("radiogroup", { name: "Tool" })).not.toBeInTheDocument()
    expect(current.queryByRole("group", { name: "__wizard_action" })).not.toBeInTheDocument()
    expect(current.getByRole("button", { name: "Next" })).toBeInTheDocument()
    await fireEvent.click(current.getByRole("button", { name: "Back" }))
    expect(back).toHaveBeenCalledOnce()
  })

  it("labels an unanswered dropdown instead of rendering a blank trigger", () => {
    render(() => (
      <FormView
        item={viewItem([
          {
            key: "decision",
            title: "Decision",
            type: "string",
            options: [
              { value: "continue", label: "Continue" },
              { value: "decline", label: "Decline" },
            ],
          },
        ])}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByText("Select an option")).toBeInTheDocument()
  })

  it("renders requested string options as a large searchable selector", async () => {
    const [answers, setAnswers] = createStore<Record<string, FormFieldValue | undefined>>({})
    const view = render(() => (
      <FormView
        item={viewItem(
          [
            {
              key: "tool",
              title: "Tool",
              type: "string",
              required: true,
              options: [
                { value: "read-files", label: "Read files", description: "Inspect the local filesystem" },
                { value: "web.search", label: "Web Search", description: "Search the public internet" },
              ],
            },
          ],
          { choicePresentation: "search" },
        )}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    const current = within(view.container)
    const selector = current.getByRole("group", { name: "Tool" })
    expect(selector).toHaveAttribute("data-component", "model-selector")
    expect(current.queryByRole("radiogroup", { name: "Tool" })).not.toBeInTheDocument()
    expect(selector).not.toHaveAttribute("data-component", "select-root")
    expect(within(selector).getByRole("button", { name: "Tool" })).toHaveTextContent("Select Tool")

    await userEvent.click(within(selector).getByRole("button", { name: "Tool" }))
    const search = screen.getByRole("combobox", { name: "Search tool" })
    expect(screen.getByRole("listbox", { name: "Tool" })).toBeInTheDocument()
    expect(search.closest('[data-slot="model-selector-popover"]')).toHaveAttribute("data-size", "large")

    await fireEvent.input(search, { target: { value: "public internet" } })
    expect(screen.getByRole("option", { name: /Web Search.*Search the public internet/i })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Read files/i })).not.toBeInTheDocument()

    await fireEvent.input(search, { target: { value: "readfiles" } })
    expect(screen.getByRole("option", { name: /Read files/i })).toBeInTheDocument()
    await fireEvent.input(search, { target: { value: "web search" } })
    expect(screen.getByRole("option", { name: /Web Search/i })).toBeInTheDocument()
    await fireEvent.input(search, { target: { value: "missing tool" } })
    expect(screen.getByText("No tool options found")).toBeInTheDocument()

    await fireEvent.input(search, { target: { value: "" } })
    await fireEvent.keyDown(search, { key: "ArrowDown" })
    await fireEvent.keyDown(search, { key: "Enter" })
    await waitFor(() => expect(answers.tool).toBe("web.search"))
    expect(within(selector).getByRole("button", { name: "Tool" })).toHaveTextContent("Web Search")
  })

  it("renders the projected submit label", () => {
    render(() => (
      <FormView
        item={viewItem([{ key: "name", title: "Name", type: "string" }], { submitLabel: "Create policy" })}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByRole("button", { name: "Create policy" })).toBeInTheDocument()
  })

  it("collapses sections labelled as advanced settings", async () => {
    const urlField = { key: "url", type: "string", title: "Server URL", required: true } as const
    const authField = {
      key: "auth",
      type: "string",
      title: "Authentication",
      required: true,
      options: [
        { value: "oauth", label: "MCP OAuth" },
        { value: "none", label: "No authentication" },
      ],
    } as const
    const codemodeField = { key: "codemode", type: "boolean", title: "Enable CodeMode" } as const
    render(() => (
      <FormView
        item={viewItem([urlField, authField, codemodeField], {
          sections: [
            { fields: [urlField] },
            { fields: [authField, codemodeField], collapsedLabel: "Authentication and Code Mode" },
          ],
          choicePresentation: "cards",
        })}
        answers={{ auth: "oauth", codemode: true }}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByLabelText("Server URL")).toBeVisible()
    const settings = screen.getByRole("button", { name: "Authentication and Code Mode" })
    expect(settings).toHaveAttribute("aria-expanded", "false")
    await fireEvent.click(settings)
    expect(settings).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("radio", { name: "MCP OAuth" })).toBeVisible()
    expect(screen.getByRole("switch", { name: "Enable CodeMode" })).toBeVisible()
  })

  it("renders the projected project path field with a folder icon", () => {
    render(() => (
      <FormView
        item={viewItem(
          [{ key: "documentPath", type: "string", title: "OpenAPI JSON file", placeholder: "specs/openapi.json" }],
          { projectPathField: "documentPath" },
        )}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    const path = screen.getByLabelText("OpenAPI JSON file")
    expect(path).toHaveAttribute("placeholder", "specs/openapi.json")
    expect(path.closest('[data-component="text-input"]')).toHaveAttribute("data-leading-icon")
  })

  it("labels option groups and disables every response while submitting", () => {
    const view = render(() => (
      <FormView
        item={viewItem([
          {
            key: "choice",
            title: "Choice",
            type: "string",
            options: [{ value: "A", label: "Option A", description: "First option" }],
            custom: true,
            required: true,
          },
        ])}
        answers={{ choice: "A" }}
        set={() => undefined}
        pendingAction="submit"
        error="The response could not be submitted."
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    const current = within(view.container)
    const group = current.getByRole("radiogroup", { name: "Choice" })
    expect(group).toHaveAttribute("aria-labelledby")
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)).toHaveTextContent("Choice")
    expect(group).not.toHaveAttribute("aria-label")
    expect(current.getByRole("radio", { name: /Option A/ })).toBeDisabled()
    expect(current.getByLabelText("Choice custom value")).toBeDisabled()
    expect(current.getByRole("alert")).toHaveTextContent("The response could not be submitted.")
    expect(current.getByRole("button", { name: "Submitting…" })).toBeDisabled()
    expect(current.getByRole("button", { name: "Cancel" })).toBeDisabled()
  })

  it("distinguishes external links and acknowledgements by field title", () => {
    render(() => (
      <FormView
        item={viewItem([
          { key: "terms", type: "external", title: "Review the plan", url: "https://example.com/plan" },
          { key: "privacy", type: "external", title: "Review privacy", url: "https://example.com/privacy" },
        ])}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByRole("link", { name: /Review the plan, opens in a new tab/i })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(screen.getByRole("link", { name: /Review privacy, opens in a new tab/i })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(screen.getByRole("link", { name: /Review the plan, opens in a new tab/i })).toHaveAttribute(
      "data-component",
      "button",
    )
    expect(screen.getByRole("checkbox", { name: /I opened and reviewed this page.*Review the plan/i })).toBeRequired()
    expect(screen.getByRole("checkbox", { name: /I opened and reviewed this page.*Review privacy/i })).toBeRequired()
  })

  it("reduces URL authorization to authorize and cancel actions", async () => {
    const set = vi.fn()
    const submit = vi.fn()
    const cancel = vi.fn()
    const view = render(() => (
      <FormView
        item={viewItem(
          [
            { key: "response", type: "string", options: [{ value: "accept", label: "Continue" }] },
            { key: "authorization", type: "external", url: "https://example.com/authorize" },
          ],
          {
            authorization: {
              url: "https://example.com/authorize",
              externalKey: "authorization",
              actionKey: "response",
              acceptValue: "accept",
            },
          },
        )}
        answers={{}}
        set={set}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={cancel}
      />
    ))

    const current = within(view.container)
    expect(current.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(current.queryByRole("radio")).not.toBeInTheDocument()
    expect(current.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument()
    const authorize = current.getByRole("link", { name: /Authorize.*opens in a new tab/ })
    expect(authorize).toHaveAttribute("href", "https://example.com/authorize")
    expect(authorize).toHaveAttribute("target", "_blank")
    await fireEvent.click(authorize)
    expect(set).toHaveBeenNthCalledWith(1, "authorization", true)
    expect(set).toHaveBeenNthCalledWith(2, "response", "accept")
    expect(submit).toHaveBeenCalledOnce()
    await fireEvent.click(current.getByRole("button", { name: "Cancel" }))
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("exposes a focus target when the first question allows multiple answers", () => {
    const primary = vi.fn()
    render(() => (
      <FormView
        item={viewItem([
          {
            key: "choices",
            title: "Choices",
            type: "multiselect",
            options: [{ value: "A", label: "Option A" }],
            custom: true,
          },
        ])}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        primary={primary}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(primary).toHaveBeenCalledOnce()
    expect(primary.mock.calls[0]?.[0]).toBe(screen.getByLabelText("Choices custom values"))
  })

  it("edits multiline wizard fields in a textarea", async () => {
    const [answers, setAnswers] = createStore<Record<string, FormFieldValue | undefined>>({})
    const cancel = vi.fn()
    const submit = vi.fn()
    const view = render(() => (
      <FormView
        item={viewItem(
          [{ key: "document", title: "OpenAPI 3.x JSON document", type: "string", multiline: true, required: true }],
          { title: "Configure OpenAPI service" },
        )}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={cancel}
      />
    ))
    const current = within(view.container)
    const textarea = current.getByRole("textbox", { name: "OpenAPI 3.x JSON document" })
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea).toHaveAttribute("rows", "8")
    await fireEvent.input(textarea, { target: { value: '{\n  "openapi": "3.1.0"\n}' } })
    expect(answers.document).toContain("3.1.0")
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).toHaveBeenCalledOnce()
    await fireEvent.click(current.getByRole("button", { name: "Cancel" }))
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("does not expose server regex patterns to the browser's incompatible pattern grammar", () => {
    render(() => (
      <FormView
        item={viewItem([
          {
            key: "shortName",
            title: "Short name",
            type: "string",
            pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
          },
        ])}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ))

    expect(screen.getByRole("textbox", { name: "Short name" })).not.toHaveAttribute("pattern")
  })

  it("accepts an explicit false answer for a required boolean", async () => {
    const submit = vi.fn()
    const view = render(() => (
      <FormView
        item={viewItem([{ key: "enabled", title: "Enable previews", type: "boolean", required: true }])}
        answers={{ enabled: false }}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={() => undefined}
      />
    ))

    const current = within(view.container)
    expect(current.getByRole("switch", { name: "Enable previews" })).toHaveAttribute("aria-required", "true")
    expect(current.getByRole("switch", { name: "Enable previews" })).not.toHaveAttribute("required")
    expect(current.getAllByText("Enable previews").filter((node) => !node.classList.contains("sr-only"))).toHaveLength(
      1,
    )
    expect(current.queryByText("Required")).not.toBeInTheDocument()
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).toHaveBeenCalledOnce()
  })

  it("preserves multiselect custom answers and conditional fields", async () => {
    const [answers, setAnswers] = createStore<Record<string, FormFieldValue | undefined>>({})
    const submit = vi.fn()
    const view = render(() => (
      <FormView
        item={viewItem([
          {
            key: "features",
            title: "Features",
            type: "multiselect",
            required: true,
            custom: true,
            options: [{ value: "logs", label: "Logs", description: "Retain diagnostic history" }],
          },
          {
            key: "details",
            title: "Feature details",
            type: "string",
            when: [{ key: "features", op: "eq", value: "logs" }],
          },
        ])}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={submit}
        onCancel={() => undefined}
      />
    ))

    const current = within(view.container)
    expect(current.getByRole("group", { name: "Features" })).toHaveAttribute("aria-required", "true")
    expect(current.queryByRole("textbox", { name: "Feature details" })).not.toBeInTheDocument()
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).not.toHaveBeenCalled()
    expect(current.getByRole("alert")).toHaveTextContent("Missing required form field: features")
    await fireEvent.click(current.getByRole("checkbox", { name: /Logs/ }))
    expect(current.queryByRole("alert")).not.toBeInTheDocument()
    expect(current.getByRole("textbox", { name: "Feature details" })).toBeInTheDocument()
    await fireEvent.input(current.getByLabelText("Features custom values"), { target: { value: "metrics, traces" } })
    expect(answers.features).toEqual(["logs", "metrics", "traces"])
    expect(current.queryByText("Select all that apply")).not.toBeInTheDocument()
    expect(current.queryByText("Or add your own")).not.toBeInTheDocument()
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    expect(submit).toHaveBeenCalledOnce()
  })
})
