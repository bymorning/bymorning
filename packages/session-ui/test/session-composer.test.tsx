import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SessionComposer } from "../src/index.js"
import type { SessionUI } from "../src/model.js"

afterEach(cleanup)

const idle = (): SessionUI.Operation => ({ pending: () => false, error: () => undefined, run: vi.fn() })

describe("SessionComposer", () => {
  it("keeps draft ownership with its caller, submits Enter, and preserves Shift+Enter newlines", async () => {
    const user = userEvent.setup()
    const [value, setValue] = createSignal("")
    const submit = idle()
    render(() => (
      <SessionComposer
        model={{ value, setValue, disabled: () => false, active: () => false, submit, compact: idle() }}
      />
    ))
    const editor = screen.getByRole("textbox", { name: "Message" })

    await user.type(editor, "first line")
    await user.keyboard("{Shift>}{Enter}{/Shift}")
    await user.type(editor, "second line")
    expect(value()).toBe("first line\nsecond line")
    expect(submit.run).not.toHaveBeenCalled()

    await user.keyboard("{Enter}")
    expect(submit.run).toHaveBeenCalledTimes(1)
    expect(value()).toBe("first line\nsecond line")
  })

  it("does not submit while an IME composition is active", async () => {
    const [value, setValue] = createSignal("draft")
    const submit = idle()
    render(() => (
      <SessionComposer
        model={{ value, setValue, disabled: () => false, active: () => false, submit, compact: idle() }}
      />
    ))

    screen
      .getByRole("textbox", { name: "Message" })
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, isComposing: true }))

    expect(submit.run).not.toHaveBeenCalled()
  })

  it("uses command and mention choices through caller-owned callbacks", async () => {
    const user = userEvent.setup()
    const [value, setValue] = createSignal("")
    const command = idle()
    const search = vi.fn(async () => [{ key: "file", label: "notes.txt", insert: "@notes.txt " }])
    render(() => (
      <SessionComposer
        model={{
          value,
          setValue,
          disabled: () => false,
          active: () => false,
          submit: idle(),
          compact: idle(),
          commands: () => [{ key: "compact", label: "/compact", action: command }],
          mentions: { search },
        }}
      />
    ))
    const editor = screen.getByRole("textbox", { name: "Message" })

    await user.type(editor, "/com")
    await user.keyboard("{Enter}")
    expect(command.run).toHaveBeenCalledTimes(1)

    await user.clear(editor)
    await user.type(editor, "@no")
    await waitFor(() => expect(screen.getByRole("option", { name: "notes.txt" })).toBeVisible())
    await user.keyboard("{Enter}")
    expect(value()).toBe("@notes.txt ")
    expect(search).toHaveBeenCalledWith("no", expect.any(AbortSignal))
    expect(editor).toHaveFocus()
  })

  it("reports upload state and delegates attachment lifecycle to the caller", async () => {
    const user = userEvent.setup()
    const add = vi.fn()
    const remove = vi.fn()
    const view = render(() => (
      <SessionComposer
        model={{
          value: () => "",
          setValue: () => undefined,
          disabled: () => false,
          active: () => false,
          submit: idle(),
          compact: idle(),
          attachments: {
            items: () => [{ key: "upload-1", path: "report.txt", state: "error", error: "Upload failed" }],
            disabled: () => false,
            add,
            remove,
          },
        }}
      />
    ))

    await user.click(screen.getByRole("button", { name: "Images and files" }))
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error("Attachment input was not rendered")
    await user.upload(input, new File(["body"], "report.txt", { type: "text/plain" }))
    expect(add).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed")
    await user.click(screen.getByRole("button", { name: "Remove report.txt" }))
    expect(remove).toHaveBeenCalledWith("upload-1")
  })
})
