import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import type { FormAnswer, FormInfo, PermissionRequest } from "@bymorning/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FormView, PermissionView, SessionProvider } from "../src/index.js"
import type { SessionUI } from "../src/model.js"

afterEach(cleanup)

const labels = {
  loading: "Loading",
  retry: "Back",
  dismiss: "Cancel",
  interrupted: "Interrupted",
  permission: "Allow once",
  form: "Submit",
}
const idle = (): SessionUI.Operation => ({ pending: () => false, error: () => undefined, run: vi.fn() })
const form: FormInfo = {
  id: "form-fixture" as FormInfo["id"],
  sessionID: "session-fixture" as FormInfo["sessionID"],
  title: "Connection details",
  fields: [
    { key: "count", type: "integer", title: "Count", required: true, minimum: 1 },
    { key: "mode", type: "string", title: "Mode", required: true },
    {
      key: "detail",
      type: "string",
      title: "Detail",
      required: true,
      when: [{ key: "mode", op: "eq", value: "custom" }],
    },
  ],
}

describe("request controls", () => {
  it("keeps permission replies controlled and exposes pending/error state", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const [pending, setPending] = createSignal(false)
    const [error, setError] = createSignal<string | undefined>()
    const item: PermissionRequest = {
      id: "permission-fixture" as PermissionRequest["id"],
      sessionID: "session-fixture" as PermissionRequest["sessionID"],
      action: "filesystem.read",
      resources: ["/tmp/report.txt", "<script>text only</script>"],
    }
    render(() => (
      <SessionProvider labels={labels}>
        <PermissionView model={{ item: () => item, action: { pending, error, run } }} />
      </SessionProvider>
    ))

    expect(screen.getByText("<script>text only</script>")).toBeInTheDocument()
    expect(document.querySelector("script")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Once" }))
    expect(run).toHaveBeenCalledWith({ reply: "once" })
    setPending(true)
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled()
    setError("Connection lost")
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost")
  })

  it("validates required conditional and integer fields before emitting the caller answer", async () => {
    const user = userEvent.setup()
    const [answer, setAnswer] = createSignal<FormAnswer>({})
    const run = vi.fn()
    const set = (key: string, value: FormAnswer[string] | undefined) =>
      setAnswer((current) => {
        if (value === undefined) {
          const { [key]: _removed, ...next } = current
          return next
        }
        return { ...current, [key]: value }
      })
    render(() => (
      <SessionProvider labels={labels}>
        <FormView
          model={{
            item: () => form,
            answer,
            setAnswer: set,
            submit: { pending: () => false, error: () => undefined, run },
            cancel: idle(),
          }}
        />
      </SessionProvider>
    ))
    const count = screen.getByRole("spinbutton", { name: "Count" })
    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Missing required form field: count")
    expect(count).toHaveAttribute("aria-invalid", "true")
    expect(count).toHaveAccessibleDescription("Missing required form field: count")
    expect(count).toHaveFocus()

    fireEvent.input(count, { target: { value: "2.5" } })
    expect(count).toHaveAttribute("aria-invalid", "true")
    await user.clear(count)
    await user.type(count, "2")
    await user.type(screen.getByRole("textbox", { name: "Mode" }), "custom")
    expect(screen.getByRole("textbox", { name: "Detail" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(run).not.toHaveBeenCalled()
    await user.type(screen.getByRole("textbox", { name: "Detail" }), "needed")
    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(run).toHaveBeenCalledWith({ count: 2, mode: "custom", detail: "needed" })
  })

  it("delegates cancellation and never sends a partial answer", async () => {
    const user = userEvent.setup()
    const cancel = idle()
    const submit = vi.fn()
    render(() => (
      <SessionProvider labels={labels}>
        <FormView
          model={{
            item: () => form,
            answer: () => ({}),
            setAnswer: () => undefined,
            submit: { pending: () => false, error: () => undefined, run: submit },
            cancel,
          }}
        />
      </SessionProvider>
    ))

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(cancel.run).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })

  it("submits only normalized active fields while applying schema defaults", async () => {
    const user = userEvent.setup()
    const [answer, setAnswer] = createSignal<FormAnswer>({ mode: "basic", detail: "stale hidden value" })
    const run = vi.fn()
    const item: FormInfo = {
      ...form,
      fields: [
        { key: "mode", type: "string", title: "Mode", default: "basic" },
        { key: "retries", type: "integer", title: "Retries", default: 3, minimum: 1 },
        { key: "detail", type: "string", title: "Detail", when: [{ key: "mode", op: "eq", value: "custom" }] },
      ],
    }
    render(() => (
      <SessionProvider labels={labels}>
        <FormView
          model={{
            item: () => item,
            answer,
            setAnswer: (key, value) =>
              setAnswer((current) =>
                value === undefined
                  ? Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key))
                  : { ...current, [key]: value },
              ),
            submit: { pending: () => false, error: () => undefined, run },
            cancel: idle(),
          }}
        />
      </SessionProvider>
    ))

    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(run).toHaveBeenCalledWith({ mode: "basic", retries: 3 })
    expect(answer()).toEqual({ mode: "basic", detail: "stale hidden value" })
  })

  it("does not send invalid raw numeric answers", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(() => (
      <SessionProvider labels={labels}>
        <FormView
          model={{
            item: () => form,
            answer: () => ({ count: Number.NaN, mode: "ok" }),
            setAnswer: () => undefined,
            submit: { pending: () => false, error: () => undefined, run },
            cancel: idle(),
          }}
        />
      </SessionProvider>
    ))

    await user.click(screen.getByRole("button", { name: "Submit" }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByText("Expected number for form field: count")).toBeInTheDocument()
  })
})
