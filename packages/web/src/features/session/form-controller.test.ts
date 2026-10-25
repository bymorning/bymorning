/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixtures implement only the exercised Session seam. */
import { Form } from "@bymorning/schema/form"
import { Session } from "@bymorning/schema/session"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createFormController as createController } from "../../test/form-controller"

const form = Form.Info.make({
  id: Form.ID.create("frm_web"),
  sessionID: Session.ID.make(crypto.randomUUID()),
  title: "Questions",
  fields: [{ key: "name", type: "string", default: "Ava" }],
})

describe("form controller", () => {
  it("initializes defaults and submits the current answer", async () => {
    const [forms] = createSignal<ReadonlyArray<Form.Info>>([form])
    const reply = vi.fn(() => Promise.resolve())
    const controller = createRoot(() =>
      createController({ data: { forms }, form: { reply, cancel: vi.fn() } } as never),
    )
    const view = controller.item()
    expect(view?.id).toBe(form.id)
    expect(view?.fields).toEqual(form.fields)
    expect(view?.sections).toEqual([{ fields: form.fields }])
    expect(view?.choicePresentation).toBe("select")
    expect(view?.canGoBack).toBe(false)
    expect(view?.submitLabel).toBe("Submit")
    expect(controller.answers()).toEqual({ name: "Ava" })
    controller.set("name", "Grace")
    await controller.submit()
    expect(reply).toHaveBeenCalledWith(form, { name: "Grace" }, "submit")
  })

  it("resets every lifecycle value before submitting a replacement form", async () => {
    const next = Form.Info.make({
      id: form.id,
      sessionID: form.sessionID,
      title: "Next questions",
      fields: [{ key: "region", type: "string", default: "us-east-1" }],
    })
    const final = Form.Info.make({
      id: Form.ID.create("frm_web_final"),
      sessionID: form.sessionID,
      title: "Final questions",
      fields: [{ key: "enabled", type: "boolean", default: true }],
    })
    const first = Form.Info.make({ ...form, fields: [{ key: "format", type: "string" }] })
    const [forms, setForms] = createSignal<ReadonlyArray<Form.Info>>([first])
    const stale = Promise.withResolvers<void>()
    const reply = vi.fn((current: Form.Info) => (current.id === next.id ? stale.promise : Promise.resolve()))
    const controller = createRoot(() =>
      createController({
        data: { forms },
        form: { reply, cancel: vi.fn(() => Promise.reject(new Error("First form failed"))) },
      } as never),
    )

    controller.set("format", "openapi")
    setForms([Form.Info.make({ ...first })])
    expect(controller.answers()).toEqual({ format: "openapi" })
    await controller.cancel()
    expect(controller.error()).toBe("First form failed")
    setForms([next])
    expect(controller.error()).toBeUndefined()
    const staleSubmission = controller.submit()
    expect(controller.pendingAction()).toBe("submit")
    setForms([final])

    expect(controller.answers()).toEqual({ enabled: true })
    expect(controller.pendingAction()).toBeUndefined()
    expect(controller.error()).toBeUndefined()
    await controller.submit()
    expect(reply).toHaveBeenCalledWith(final, { enabled: true }, "submit")
    stale.resolve()
    await staleSubmission
    expect(controller.error()).toBeUndefined()
  })

  it("cancels once and retains an operation failure", async () => {
    const [forms] = createSignal([form])
    let reject!: (cause: Error) => void
    const cancel = vi.fn(() => new Promise<void>((_, fail) => (reject = fail)))
    const controller = createRoot(() =>
      createController({ data: { forms }, form: { reply: vi.fn(), cancel } } as never),
    )
    const first = controller.cancel()
    await controller.cancel()
    expect(cancel).toHaveBeenCalledOnce()
    reject(new Error("Connection lost"))
    await first
    expect(controller.pendingAction()).toBeUndefined()
    expect(controller.error()).toBe("Connection lost")
  })

  it("replies with the external-server back action without current field values", async () => {
    const wizard = Form.Info.make({
      ...form,
      metadata: {
        kind: "external-server-creator",
        canGoBack: true,
        navigation: { actionKey: "__externalServerWizardAction", backValue: "back" },
      },
      fields: [
        {
          key: "__externalServerWizardAction",
          type: "string",
          default: "next",
          options: [
            { value: "next", label: "Next" },
            { value: "back", label: "Back" },
          ],
        },
        { key: "url", type: "string", required: true },
      ],
    })
    const [forms] = createSignal<ReadonlyArray<Form.Info>>([wizard])
    const reply = vi.fn(() => Promise.resolve())
    const controller = createRoot(() =>
      createController({ data: { forms }, form: { reply, cancel: vi.fn() } } as never),
    )

    await controller.back()

    expect(reply).toHaveBeenCalledWith(wizard, { __externalServerWizardAction: "back" }, "back")
  })

  it("keeps unsupported back navigation as local validation", async () => {
    const reply = vi.fn()
    const controller = createRoot(() =>
      createController({ data: { forms: () => [form] }, form: { reply, cancel: vi.fn() } } as never),
    )
    await controller.back()
    expect(controller.error()).toBe("This form does not support back navigation.")
    expect(controller.pendingAction()).toBeUndefined()
    expect(reply).not.toHaveBeenCalled()
  })
})

describe("form view projection", () => {
  const actionField: Form.Field = {
    key: "__externalServerWizardAction",
    type: "string",
    default: "next",
    options: [
      { value: "next", label: "Next" },
      { value: "back", label: "Back" },
    ],
  }
  const formatField: Form.Field = {
    key: "format",
    title: "Format",
    type: "string",
    required: true,
    options: [
      { value: "mcp", label: "MCP server", description: "Remote server" },
      { value: "openapi", label: "OpenAPI", description: "JSON specification" },
    ],
  }

  function project(item: Form.Info) {
    const [forms] = createSignal<ReadonlyArray<Form.Info>>([item])
    return createRoot(() =>
      createController({ data: { forms }, form: { reply: vi.fn(), cancel: vi.fn() } } as never),
    ).item()
  }

  it("presents external-server choices as cards with back navigation and a custom submit label", () => {
    const wizard = Form.Info.make({
      ...form,
      metadata: {
        kind: "external-server-creator",
        canGoBack: true,
        nextLabel: "Continue",
        navigation: { actionKey: "__externalServerWizardAction", backValue: "back" },
      },
      fields: [actionField, formatField],
    })

    const view = project(wizard)

    expect(view?.choicePresentation).toBe("cards")
    expect(view?.canGoBack).toBe(true)
    expect(view?.submitLabel).toBe("Continue")
    expect(view?.sections).toEqual([{ fields: [formatField] }])
    expect(view?.fields).toEqual([actionField, formatField])
  })

  it("collapses external-server MCP settings behind the Authentication and Code Mode disclosure", () => {
    const urlField: Form.Field = { key: "url", type: "string", title: "Server URL", required: true }
    const authField: Form.Field = {
      key: "auth",
      type: "string",
      title: "Authentication",
      required: true,
      options: [
        { value: "oauth", label: "MCP OAuth" },
        { value: "none", label: "No authentication" },
      ],
    }
    const codemodeField: Form.Field = { key: "codemode", type: "boolean", title: "Enable CodeMode" }
    const wizard = Form.Info.make({
      ...form,
      metadata: { kind: "external-server-creator", stage: "mcp" },
      fields: [urlField, authField, codemodeField],
    })

    const view = project(wizard)

    expect(view?.sections).toEqual([
      { fields: [urlField] },
      { fields: [authField, codemodeField], collapsedLabel: "Authentication and Code Mode" },
    ])
    expect(view?.choicePresentation).toBe("cards")
  })

  it("presents the OpenAPI document path as a file field", () => {
    const documentPathField: Form.Field = {
      key: "documentPath",
      type: "string",
      title: "OpenAPI JSON file",
      placeholder: "specs/openapi.json",
    }
    const wizard = Form.Info.make({
      ...form,
      metadata: { kind: "external-server-creator", stage: "openapi" },
      fields: [documentPathField],
    })

    expect(project(wizard)?.projectPathField).toBe("documentPath")
  })

  it("requires an answer only for Questions", () => {
    expect(
      project(Form.Info.make({ ...form, metadata: { kind: "question" }, fields: [formatField] }))?.answerRequired,
    ).toBe(true)
    expect(project(Form.Info.make({ ...form, fields: [formatField] }))?.answerRequired).toBeUndefined()
  })

  it("keeps a metadata-requested search presentation ahead of the external-server cards", () => {
    const wizard = Form.Info.make({
      ...form,
      metadata: { kind: "external-server-creator", choicePresentation: "search" },
      fields: [formatField],
    })

    expect(project(wizard)?.choicePresentation).toBe("search")
  })

  it("presents URL elicitation as a single authorization action", () => {
    const response: Form.Field = {
      key: "__bymorning_elicit_action",
      type: "string",
      title: "Response",
      required: true,
      options: [
        { value: "accept", label: "Continue" },
        { value: "decline", label: "Decline" },
      ],
    }
    const authorization: Form.Field = {
      key: "__bymorning_elicit_url",
      type: "external",
      title: "Complete authorization in your browser.",
      url: "https://example.com/authorize",
    }
    const request = Form.Info.make({
      ...form,
      metadata: { kind: "tool-elicitation", mode: "url" },
      fields: [response, authorization],
    })

    const view = project(request)

    expect(view?.sections).toEqual([{ fields: [authorization, response] }])
    expect(view?.choicePresentation).toBe("cards")
    expect(view?.authorization).toEqual({
      url: "https://example.com/authorize",
      externalKey: "__bymorning_elicit_url",
      actionKey: "__bymorning_elicit_action",
      acceptValue: "accept",
    })
  })
})
