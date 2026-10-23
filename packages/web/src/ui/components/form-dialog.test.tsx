import { cleanup, screen, waitFor } from "@solidjs/testing-library"
import { renderForm as render } from "../form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { createForm } from "../form"
import { FormDialog } from "./form-dialog"
import { FormFrame } from "./form-frame"

afterEach(cleanup)

it("lets a successful callback retain its originating dialog", async () => {
  const success = vi.fn()
  function Editor() {
    const form = createForm({ values: { name: "" }, submit: () => undefined })
    return <FormDialog
      form={form}
      title="Editor"
      onSuccess={success}
      actions={<FormFrame.Actions submitLabel="Save" />}
    />
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <Editor />)}>Open</button>
  }
  render(() => <DialogProvider><Harness /></DialogProvider>)
  const user = userEvent.setup()

  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(screen.getByRole("button", { name: "Save" }))

  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(screen.getByRole("dialog", { name: "Editor" })).toBeInTheDocument()
})
