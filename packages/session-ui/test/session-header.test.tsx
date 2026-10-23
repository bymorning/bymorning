import { cleanup, render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SessionHeader, SessionProvider } from "../src/index.js"
import type { SessionUI } from "../src/model.js"

afterEach(cleanup)

const labels = {
  loading: "Loading",
  retry: "Retry",
  dismiss: "Dismiss",
  interrupted: "Interrupted",
  permission: "Permission",
  form: "Form",
}

describe("SessionHeader", () => {
  it("keeps optional rename controlled, trims its value, and exposes caller error", async () => {
    const user = userEvent.setup()
    const [pending, setPending] = createSignal(false)
    const [error, setError] = createSignal<string | undefined>()
    const run = vi.fn()
    const rename: SessionUI.Action<string> = { pending, error, run }
    render(() => (
      <SessionProvider labels={labels}>
        <SessionHeader
          model={{
            title: () => "Original",
            status: () => "running",
            identity: () => ({ workspace: "Workspace", project: { name: "Project" } }),
            rename,
          }}
        />
      </SessionProvider>
    ))

    await user.click(screen.getByRole("button", { name: "Rename session" }))
    const input = screen.getByDisplayValue("Original")
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, "  Revised  ")
    await user.keyboard("{Enter}")
    expect(run).toHaveBeenCalledWith("Revised")
    setPending(true)
    expect(input).toBeDisabled()
    setError("Rename failed")
    expect(screen.getByRole("alert")).toHaveTextContent("Rename failed")
    expect(screen.getByRole("status", { name: "Session status: Running" })).toBeInTheDocument()
  })

  it("renders optional project identity and incomplete usage without creating rename controls", () => {
    render(() => (
      <SessionProvider labels={labels}>
        <SessionHeader
          model={{
            title: () => "Read only",
            status: () => "idle",
            identity: () => ({ workspace: "Workspace" }),
            usage: () => ({ tokens: 1_234, cost: 0.5, complete: false, percentage: 25 }),
          }}
        />
      </SessionProvider>
    ))

    expect(screen.getByRole("heading", { name: "Read only" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Read only" })).not.toBeInTheDocument()
    expect(screen.getByText("1,234")).toBeInTheDocument()
    expect(screen.getByText("+")).toBeInTheDocument()
  })
})
