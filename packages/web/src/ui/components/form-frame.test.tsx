import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { createForm } from "../form"
import { renderForm } from "../form-query.test-support"
import { FormFrame } from "./form-frame"

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it("reports presentation exceptions without turning a committed write into a failed mutation", async () => {
  const cause = new Error("Presentation failed")
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  const submit = vi.fn(() => "saved")
  const view = renderForm(() => {
    const form = createForm({ values: {}, submit })
    return <FormFrame form={form} label="Editor" onSuccess={() => { throw cause }}><FormFrame.Error /></FormFrame>
  })
  fireEvent.submit(screen.getByRole("form", { name: "Editor" }))
  await waitFor(() => expect(report).toHaveBeenCalledWith(cause))
  expect(submit).toHaveBeenCalledOnce()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(view.client.getMutationCache().getAll()[0]?.state.status).toBe("success")
})
