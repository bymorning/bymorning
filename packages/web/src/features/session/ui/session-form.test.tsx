/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixture implements only the exercised Session seam. */
import { fireEvent, render, within } from "@solidjs/testing-library"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createFormController as createController } from "../../../test/form-controller"
import type { FormItem } from "./form-model"
import { SessionForm } from "./session-form"

describe("SessionForm", () => {
  it.each([
    { action: "Cancel", pending: "Cancelling…" },
    { action: "Submit", pending: "Submitting…" },
  ] as const)("shows action-specific pending copy for delayed $action", async ({ action, pending }) => {
    const [forms] = createSignal<ReadonlyArray<FormItem>>([formWithTitle("frm_pending", "Pending form")])
    const operation = Promise.withResolvers<void>()
    const model = createRoot(() =>
      createController({
        data: { forms },
        form: {
          reply: vi.fn(() => operation.promise),
          cancel: vi.fn(() => operation.promise),
        },
      } as never),
    )
    const view = render(() => <SessionForm model={model} primary={() => undefined} />)
    const current = within(view.container)

    await fireEvent.click(current.getByRole("button", { name: action }))

    expect(current.getByRole("button", { name: pending })).toBeDisabled()
    expect(current.getByRole("button", { name: action === "Cancel" ? "Submit" : "Cancel" })).toBeDisabled()
    operation.resolve()
    await operation.promise
    await vi.waitFor(() => expect(current.getByRole("button", { name: action })).toBeEnabled())
  })

  it("remounts controls and submits only the replacement form defaults", async () => {
    const first = formWithTitle("frm_first", "Choose a format", [{ key: "format", type: "string" }])
    const second = formWithTitle("frm_second", "Choose a region", [
      { key: "region", type: "string", default: "us-east-1" },
    ])
    const [forms, setForms] = createSignal<ReadonlyArray<FormItem>>([first])
    const reply = vi.fn(() => Promise.resolve())
    const primary = vi.fn()

    const view = render(() => {
      const model = createController({ data: { forms }, form: { reply, cancel: vi.fn() } } as never)
      return <SessionForm model={model} primary={primary} />
    })
    const current = within(view.container)
    const firstInput = current.getByRole<HTMLInputElement>("textbox", { name: "format" })
    await fireEvent.input(firstInput, { target: { value: "openapi" } })
    firstInput.setCustomValidity("Already touched")
    firstInput.focus()

    setForms([second])

    const secondInput = current.getByRole<HTMLInputElement>("textbox", { name: "region" })
    expect(document.body.contains(firstInput)).toBe(false)
    expect(secondInput).toHaveValue("us-east-1")
    expect(secondInput.checkValidity()).toBe(true)
    expect(primary.mock.lastCall?.[0]).toBe(secondInput)
    await fireEvent.click(current.getByRole("button", { name: "Submit" }))
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(second, { region: "us-east-1" }, "submit"))
  })

  it("does not leak a delayed action into the next Form", async () => {
    const first = formWithTitle("frm_first_pending", "First form")
    const second = formWithTitle("frm_second_ready", "Second form")
    const [forms, setForms] = createSignal<ReadonlyArray<FormItem>>([first])
    const operation = Promise.withResolvers<void>()
    const model = createRoot(() =>
      createController({
        data: { forms },
        form: { reply: vi.fn(() => operation.promise), cancel: vi.fn(() => operation.promise) },
      } as never),
    )
    const view = render(() => <SessionForm model={model} primary={() => undefined} />)
    const current = within(view.container)

    await fireEvent.click(current.getByRole("button", { name: "Cancel" }))
    expect(current.getByRole("button", { name: "Cancelling…" })).toBeDisabled()
    setForms([second])

    expect(current.getByRole("form", { name: "Second form" })).toBeInTheDocument()
    expect(current.getByRole("button", { name: "Cancel" })).toBeEnabled()
    expect(current.getByRole("button", { name: "Submit" })).toBeEnabled()
    operation.resolve()
    await operation.promise
  })
})

function formWithTitle(
  id: string,
  title: string,
  fields: FormItem["fields"] = [{ key: "answer", type: "string", default: "Ready" }],
): FormItem {
  return { id, title, fields }
}
