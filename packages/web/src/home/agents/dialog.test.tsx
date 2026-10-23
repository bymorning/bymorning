import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { AgentDetailContent, type AgentDetailActions } from "./dialog"
import type { AgentListItem } from "../../features/agent-list/agent-list-model"

afterEach(cleanup)

const agent = {
  id: "default",
  name: "Default",
  description: "The shipped assistant",
  instructions: "Shipped instructions",
  mode: "primary",
  hidden: false,
  steps: null,
} satisfies AgentListItem

function mount(
  actions?: AgentDetailActions,
  callbacks: { onSaved?: () => void; onReset?: () => void } = {},
  item: AgentListItem = agent,
) {
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => <AgentDetailContent agent={item} {...(actions ? { actions } : {})} {...callbacks} />)
        }
      >
        Open
      </button>
    )
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <DialogProvider>
        <Harness />
      </DialogProvider>
    </QueryClientProvider>
  ))
  return userEvent.setup()
}

it("reads an Agent without offering edit or reset when the caller supplies no actions", async () => {
  const user = mount()
  await user.click(screen.getByRole("button", { name: "Open" }))

  expect(await screen.findByText("The shipped assistant")).toBeVisible()
  expect(screen.queryByRole("button", { name: "Edit agent" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Reset to built-in" })).not.toBeInTheDocument()
})

it("saves an edited Agent in place and reports the new name", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const onSaved = vi.fn()
  const user = mount({ save }, { onSaved })
  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(await screen.findByRole("button", { name: "Edit agent" }))

  const instructions = screen.getByLabelText("Instructions")
  await user.clear(instructions)
  await user.type(instructions, "Workspace instructions")
  await user.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      name: "Default",
      description: "The shipped assistant",
      instructions: "Workspace instructions",
    }),
  )
  expect(onSaved).toHaveBeenCalledWith("Default")
  // Saving returns to reading, showing the saved instructions.
  expect(await screen.findByRole("button", { name: "Edit agent" })).toBeVisible()
})

it("confirms before restoring an overridden built-in Agent's shipped definition", async () => {
  const reset = vi.fn().mockResolvedValue(undefined)
  const onReset = vi.fn()
  const user = mount({ save: vi.fn(), reset }, { onReset }, { ...agent, overridden: true })
  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(await screen.findByRole("button", { name: "Reset to built-in" }))

  expect(await screen.findByText("Reset Default?")).toBeVisible()
  expect(reset).not.toHaveBeenCalled()

  await user.click(screen.getByRole("button", { name: "Reset agent" }))

  await waitFor(() => expect(reset).toHaveBeenCalledOnce())
  expect(onReset).toHaveBeenCalledWith("Default")
})

it("shows a cleared description immediately after saving", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const user = mount({ save })
  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(await screen.findByRole("button", { name: "Edit agent" }))

  await user.clear(screen.getByLabelText("Description"))
  await user.click(screen.getByRole("button", { name: "Save changes" }))

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ name: "Default", description: "", instructions: agent.instructions }),
  )
  expect(await screen.findByRole("button", { name: "Edit agent" })).toBeVisible()
  expect(screen.queryByText("The shipped assistant")).not.toBeInTheDocument()
})

it("offers editing without reset for an Agent that has no shipped definition", async () => {
  const user = mount({ save: vi.fn() })
  await user.click(screen.getByRole("button", { name: "Open" }))

  expect(await screen.findByRole("button", { name: "Edit agent" })).toBeVisible()
  expect(screen.queryByRole("button", { name: "Reset to built-in" })).not.toBeInTheDocument()
})

it("hides reset for a built-in Agent that is not yet overridden, and offers it once saved", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn().mockResolvedValue(undefined)
  const user = mount({ save, reset }, {}, { ...agent, overridden: false })
  await user.click(screen.getByRole("button", { name: "Open" }))

  expect(await screen.findByRole("button", { name: "Edit agent" })).toBeVisible()
  expect(screen.queryByRole("button", { name: "Reset to built-in" })).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Edit agent" }))
  await user.click(screen.getByRole("button", { name: "Save changes" }))

  expect(await screen.findByRole("button", { name: "Reset to built-in" })).toBeVisible()
})

it("names a Subagent as such in the detail and edit copy", async () => {
  const user = mount({ save: vi.fn() }, {}, { ...agent, id: "loud", name: "Loud", mode: "subagent" })
  await user.click(screen.getByRole("button", { name: "Open" }))

  expect(await screen.findByText("Subagent")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Edit subagent" }))
  expect(screen.getByRole("dialog", { name: "Edit subagent" })).toBeVisible()
})

it("keeps a failed save's error outside the scrolling body and says the name is required", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Request failed"))
  const user = mount({ save })
  await user.click(screen.getByRole("button", { name: "Open" }))
  await user.click(await screen.findByRole("button", { name: "Edit agent" }))

  const name = screen.getByLabelText("Name")
  expect(name).not.toHaveAccessibleDescription("Required.")
  await user.clear(name)
  expect(name).toHaveAccessibleDescription("Required.")
  await user.type(name, "Agent")
  expect(name).not.toHaveAccessibleDescription("Required.")
  await user.click(screen.getByRole("button", { name: "Save changes" }))

  const alert = await screen.findByRole("alert")
  expect(alert).toBeVisible()
  expect(alert.closest('[data-slot="dialog-body"]')).toBeNull()
})
