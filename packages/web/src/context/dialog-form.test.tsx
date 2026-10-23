import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { Show } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { Dialog } from "../ui/components/dialog"
import { Toast, toaster } from "../ui/components/toast"
import { createDialogForm, DialogProvider, useDialog } from "./dialog"

afterEach(() => {
  cleanup()
  toaster.dismiss()
})

function renderForm(input: {
  readonly submit: (values: { name: string }) => Promise<unknown> | undefined
  readonly onDone?: () => void
}) {
  function FormDialog() {
    const form = createDialogForm({
      values: { name: "" },
      submit: input.submit,
      fallback: "Could not save the thing",
      errorTitle: "Save failed",
      ...(input.onDone ? { onDone: input.onDone } : {}),
    })
    return (
      <Dialog aria-label="Form dialog">
        <form data-slot="test-form" onSubmit={form.onSubmit}>
          <input
            aria-label="Name"
            value={form.values.name}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
          <Show when={form.error()}>{(error) => <p role="alert">{error()}</p>}</Show>
          <button type="submit" disabled={form.pending()}>
            Save
          </button>
        </form>
      </Dialog>
    )
  }
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <FormDialog />)}>
          Open
        </button>
        <Toast.Region />
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
}

it("submits the form values and closes the dialog on success", async () => {
  const submit = vi.fn((values: { name: string }) => Promise.resolve("saved"))
  renderForm({ submit })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.type(screen.getByRole("textbox", { name: "Name" }), "hello")
  await user.click(screen.getByRole("button", { name: "Save" }))

  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0]?.[0]).toMatchObject({ name: "hello" })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("calls onDone instead of closing when provided", async () => {
  const submit = vi.fn(() => Promise.resolve("saved"))
  const onDone = vi.fn()
  renderForm({ submit, onDone })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Save" }))

  await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  expect(screen.getByRole("dialog", { name: "Form dialog" })).toBeInTheDocument()
})

it("toasts failures, keeps the dialog open, and re-enables the controls", async () => {
  const submit = vi.fn(() => Promise.reject(new Error("Network down")))
  renderForm({ submit })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Save" }))

  const dialog = screen.getByRole("dialog", { name: "Form dialog" })
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Network down"))
  expect(await screen.findByText("Save failed")).toBeInTheDocument()
  expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeEnabled()
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled()
})

it("uses the fallback message when the cause is not an Error", async () => {
  const submit = vi.fn(() => Promise.reject("denied"))
  renderForm({ submit })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Save" }))

  const dialog = await screen.findByRole("dialog", { name: "Form dialog" })
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Could not save the thing"))
  expect(await screen.findByText("Save failed")).toBeInTheDocument()
})

it("ignores submissions while one is pending and closes once it settles", async () => {
  let finish!: (value: unknown) => void
  const submit = vi.fn(() => new Promise((resolve) => (finish = resolve)))
  renderForm({ submit })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Save" }))
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!)
  expect(submit).toHaveBeenCalledOnce()

  finish("done")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("prevents the default form submission", async () => {
  const submit = vi.fn(() => Promise.resolve())
  renderForm({ submit })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  const event = new Event("submit", { bubbles: true, cancelable: true })
  fireEvent(screen.getByRole("dialog").querySelector("form")!, event)

  expect(event.defaultPrevented).toBe(true)
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
})

it("retains the dialog when the legacy callback returns undefined", async () => {
  const submit = vi.fn(() => undefined)
  const onDone = vi.fn()
  renderForm({ submit, onDone })
  await userEvent.click(screen.getByRole("button", { name: "Open" }))
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  expect(onDone).not.toHaveBeenCalled()
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
})
