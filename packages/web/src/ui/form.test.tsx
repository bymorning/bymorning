import { cleanup, waitFor } from "@solidjs/testing-library"
import { renderForm as render } from "./form-query.test-support"
import { afterEach, expect, it, vi } from "vitest"

import { createForm, type Form } from "./form"

afterEach(cleanup)

function makeForm<R>(input: Parameters<typeof createForm<{ name: string }, R>>[0]) {
  let form!: Form<{ name: string }, R>
  const view = render(() => {
    form = createForm(input)
    return <output>{form.pending ? "pending" : form.error ?? "ready"}</output>
  })
  return { form, view }
}

it("validates synchronously without invoking submit", async () => {
  const submit = vi.fn()
  const { form } = makeForm({ values: { name: "" }, validate: () => "Enter a name.", submit })
  await expect(form.submit()).resolves.toEqual({ type: "invalid", message: "Enter a name." })
  expect(submit).not.toHaveBeenCalled()
  expect(form.error).toBe("Enter a name.")
})

it("re-validates a displayed validation message as the values change", async () => {
  const { form } = makeForm({
    values: { name: "" },
    validate: (values) => (values.name === "" ? "Enter a name." : undefined),
    submit: () => undefined,
  })
  form.set("name", "typed before submit")
  expect(form.error).toBeUndefined()
  form.set("name", "")
  await form.submit()
  expect(form.error).toBe("Enter a name.")
  form.set("name", "Ada")
  expect(form.error).toBeUndefined()
})

it("settles synchronous values and void results and permits another submission", async () => {
  const submit = vi.fn(() => undefined)
  const { form } = makeForm({ values: { name: "one" }, submit })
  await expect(form.submit()).resolves.toEqual({ type: "success", value: undefined })
  await expect(form.submit()).resolves.toEqual({ type: "success", value: undefined })
  expect(submit).toHaveBeenCalledTimes(2)
  expect(form.pending).toBe(false)
})

it("catches synchronous throws and restores initial values only while settled", async () => {
  const { form } = makeForm({ values: { name: "initial" }, submit: () => { throw new Error("No network") } })
  form.set("name", "changed")
  await expect(form.submit()).resolves.toEqual({ type: "failed", message: "No network" })
  form.reset()
  expect(form.values.name).toBe("initial")
})

it("ignores duplicate and disposed request results", async () => {
  let resolve!: () => void
  const { form, view } = makeForm({ values: { name: "one" }, submit: () => new Promise<void>((done) => { resolve = done }) })
  const first = form.submit()
  // Admission must already be closed before observer scheduling or any await.
  expect(view.client.getMutationCache().getAll()[0]?.state.status).toBe("pending")
  expect(form.pending).toBe(true)
  await expect(form.submit()).resolves.toEqual({ type: "ignored" })
  expect(view.client.getMutationCache().getAll()).toHaveLength(1)
  form.reset()
  expect(form.values.name).toBe("one")
  await waitFor(() => expect(resolve).toBeTypeOf("function"))
  view.unmount()
  resolve()
  await expect(first).resolves.toEqual({ type: "ignored" })
})

it("keeps rejected writes in native mutation state, clears errors on validation, and retries", async () => {
  const cause = new Error("Offline")
  const submit = vi.fn().mockRejectedValueOnce(cause).mockResolvedValue("saved")
  const { form, view } = makeForm({ values: { name: "one" }, validate: (values) => values.name ? undefined : "Required", submit })
  await expect(form.submit()).resolves.toEqual({ type: "failed", message: "Offline" })
  expect(view.client.getMutationCache().getAll()[0]?.state).toMatchObject({ status: "error", error: cause })
  expect(form.error).toBe("Offline")
  form.set("name", "")
  await expect(form.submit()).resolves.toEqual({ type: "invalid", message: "Required" })
  expect(submit).toHaveBeenCalledTimes(1)
  form.set("name", "retry")
  await expect(form.submit()).resolves.toEqual({ type: "success", value: "saved" })
  expect(form.error).toBeUndefined()
})

it("captures detached nested drafts while preserving File and Date inputs", async () => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" })
  const date = new Date("2026-01-01")
  const submit = vi.fn(async (values: { nested: { name: string }; file: File; date: Date }) => values)
  let form!: ReturnType<typeof createForm<{ nested: { name: string }; file: File; date: Date }, Awaited<ReturnType<typeof submit>>>>
  render(() => {
    form = createForm({ values: { nested: { name: "original" }, file, date }, submit })
    return null
  })
  const request = form.submit()
  form.set("nested", "name", "new draft")
  form.reset()
  const result = await request
  expect(result).toMatchObject({ type: "success", value: { nested: { name: "original" }, date } })
  expect(submit.mock.calls[0]?.[0].file).toBe(file)
  expect(submit.mock.calls[0]?.[0].date).toBeInstanceOf(Date)
  expect(form.values.nested.name).toBe("new draft")
  form.reset()
  expect(form.values.nested.name).toBe("original")
})
