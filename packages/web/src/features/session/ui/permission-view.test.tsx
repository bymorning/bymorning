import { render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"

import { PermissionView } from "./permission-view"

describe("PermissionView", () => {
  it("renders safe request context and emits each reply", async () => {
    const user = userEvent.setup()
    const onReply = vi.fn()
    const view = render(() => (
      <PermissionView
        item={{
          id: "per_test",
          title: "filesystem.read",
          action: "filesystem.read",
          resources: ["/tmp/report.txt", "<script>unsafe()</script>"],
        }}
        pending={false}
        error={undefined}
        onReply={onReply}
      />
    ))
    expect(screen.getByRole("region", { name: "Permission required" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Permission required" })).toHaveAttribute(
      "data-component",
      "permission-view",
    )
    expect(screen.getByText("<script>unsafe()</script>")).toBeInTheDocument()
    expect(document.querySelector("script")).not.toBeInTheDocument()
    for (const [label, reply] of [
      ["Once", "once"],
      ["Reject", "reject"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }))
      expect(onReply).toHaveBeenLastCalledWith(reply)
    }
    view.unmount()
  })

  it("renders matching Tool, pending, and error state from flat props", async () => {
    const [pending, setPending] = createSignal(false)
    const view = render(() => (
      <PermissionView
        item={{ id: "per_test", title: "Called read", action: "filesystem.read", resources: [] }}
        pending={pending()}
        error="Connection lost"
        onReply={() => {}}
      />
    ))
    expect(screen.getByText("Called read")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost")
    setPending(true)
    await waitFor(() => {
      for (const button of view.getAllByRole("button")) expect(button).toBeDisabled()
    })
  })
})
