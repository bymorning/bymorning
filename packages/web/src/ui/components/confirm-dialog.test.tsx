import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { ConfirmDialog } from "./confirm-dialog"

afterEach(() => {
  cleanup()
})

function renderConfirm(input: {
  readonly title?: string
  readonly description?: string
  readonly confirmLabel?: string
  readonly danger?: boolean
  readonly onConfirm: () => Promise<unknown> | void
}) {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button
          type="button"
          onClick={() =>
            dialog.push(() => (
              <ConfirmDialog
                title={input.title ?? "Delete thing?"}
                description={input.description}
                confirmLabel={input.confirmLabel}
                danger={input.danger}
                onConfirm={input.onConfirm}
              />
            ))
          }
        >
          Open
        </button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
}

it("keeps a deferred confirmation open until its removal settles", async () => {
  let finish!: (value: unknown) => void
  const onConfirm = vi.fn(() => new Promise((resolve) => (finish = resolve)))
  renderConfirm({ description: "This cannot be undone.", danger: true, confirmLabel: "Delete", onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  const dialog = screen.getByRole("dialog", { name: "Delete thing?" })
  expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument()
  expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "danger")

  await user.click(within(dialog).getByRole("button", { name: "Delete" }))
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(dialog).toBeInTheDocument()
  expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled()

  finish("deleted")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("closes on cancel without calling onConfirm", async () => {
  const onConfirm = vi.fn()
  renderConfirm({ onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Cancel" }))

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(onConfirm).not.toHaveBeenCalled()
})

it("closes immediately when onConfirm is synchronous", async () => {
  const onConfirm = vi.fn()
  renderConfirm({ onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Confirm" }))

  expect(onConfirm).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("disables the buttons, hides the close button, and marks the dialog busy while pending", async () => {
  const onConfirm = vi.fn(() => new Promise(() => {}))
  renderConfirm({ onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Confirm" }))

  const dialog = screen.getByRole("dialog", { name: "Delete thing?" })
  expect(dialog).toHaveAttribute("aria-busy", "true")
  expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled()
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled()
  expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument()

  await user.keyboard("{Escape}")
  await user.click(document.querySelector("[data-component=dialog-overlay]")!)
  expect(dialog).toBeInTheDocument()
})

it("keeps a rejected confirmation open and renders its failure inline", async () => {
  const onConfirm = vi.fn(() => Promise.reject(new Error("Still in use")))
  renderConfirm({ confirmLabel: "Delete", onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Delete" }))

  expect(await screen.findByRole("alert")).toHaveTextContent("Still in use")
  expect(screen.getByRole("dialog", { name: "Delete thing?" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled()
})

it("keeps synchronous callback failures open", async () => {
  const onConfirm = vi.fn(() => {
    throw new Error("Still in use")
  })
  renderConfirm({ confirmLabel: "Delete", onConfirm })
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Delete" }))

  expect(onConfirm).toHaveBeenCalledOnce()
  expect(await screen.findByRole("alert")).toHaveTextContent("Still in use")
  expect(screen.getByRole("dialog", { name: "Delete thing?" })).toBeInTheDocument()
})
