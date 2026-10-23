import { Project } from "@bymorning/schema/project"
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { RestoreProjectDialog } from "./restore-dialog"

afterEach(() => {
  vi.useFakeTimers()
  cleanup()
  // Kobalte schedules unmount autofocus; drain it before jsdom is disposed.
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

const archived = (name: string) =>
  Project.Info.make({
    id: Project.ID.create(),
    name,
    archivedAt: new Date("2026-09-14T12:00:00.000Z"),
    time_created: 1,
    time_updated: 1,
  })

describe("RestoreProjectDialog", () => {
  it("lists archived projects with their archive date and restores one, closing the dialog", async () => {
    const launch = archived("Launch")
    const notes = archived("Notes")
    const restore = vi.fn(async () => undefined)
    renderDialog({ list: async () => [launch, notes], restore })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = screen.getByRole("dialog", { name: "Restore an archived project" })
    const list = await within(dialog).findByRole("list", { name: "Archived projects" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("LaunchArchived Sep 14, 2026"),
      expect.stringContaining("NotesArchived Sep 14, 2026"),
    ])

    await user.click(within(dialog).getByRole("button", { name: "Restore Notes" }))
    expect(restore).toHaveBeenCalledWith(notes)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("shows an empty state when nothing is archived and returns to Create project", async () => {
    const back = vi.fn()
    renderDialog({ list: async () => [], restore: vi.fn(), back })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    expect(await screen.findByText("No archived projects")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(back).toHaveBeenCalledTimes(1)
  })

  it("keeps the dialog open with the failure when restoring fails", async () => {
    const launch = archived("Launch")
    const restore = vi.fn(async () => {
      throw { _tag: "Project.NotFoundError", message: `Project not found: ${launch.id}` }
    })
    renderDialog({ list: async () => [launch], restore })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.click(await screen.findByRole("button", { name: "Restore Launch" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(`Project not found: ${launch.id}`)
    expect(screen.getByRole("dialog", { name: "Restore an archived project" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restore Launch" })).toBeEnabled()
  })
})

function renderDialog(props: {
  readonly list: () => Promise<ReadonlyArray<Project.Info>>
  readonly restore: (project: Project.Info) => Promise<unknown>
  readonly back?: () => void
}) {
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <RestoreProjectDialog list={props.list} restore={props.restore} back={props.back ?? (() => undefined)} />
          ))
        }
      >
        Open
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
}
