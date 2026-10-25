import { Project } from "@bymorning/schema/project"
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { ProjectDialog, type ProjectDialogMode } from "./dialog"

afterEach(() => {
  vi.useFakeTimers()
  cleanup()
  // Kobalte schedules unmount autofocus; drain it before jsdom is disposed.
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe("ProjectDialog", () => {
  it.each([
    ["create", "Create project", "Create project"],
    ["update", "Edit project", "Save changes"],
  ] as const)("presents the %s form contract", async (mode, title, action) => {
    renderDialog(
      mode === "create"
        ? { type: "create", submit: vi.fn() }
        : { type: "update", project: project("Existing"), submit: vi.fn() },
    )

    await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
    const dialog = screen.getByRole("dialog", { name: title })
    const input = within(dialog).getByRole("textbox", { name: "Name" })

    expect(screen.getAllByRole("heading", { name: title })).toHaveLength(1)
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute("maxlength", "255")
    expect(input).not.toBeRequired()
    if (mode === "update") expect(within(dialog).getByRole("button", { name: action })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled()
  })

  it("requires a non-empty name to create a project", async () => {
    const submit = vi.fn(() => new Promise<Project.Info>(() => {}))
    renderDialog({ type: "create", submit })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    const create = screen.getByRole("button", { name: "Create project" })
    expect(create).toBeDisabled()
    await user.type(screen.getByRole("textbox", { name: "Name" }), "   ")
    expect(create).toBeDisabled()
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!)
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a project name.")
    expect(submit).not.toHaveBeenCalled()
    await user.type(screen.getByRole("textbox", { name: "Name" }), "x")
    await waitFor(() => expect(create).toBeEnabled())
  })

  it.each([
    ["create trimmed", { type: "create" as const, initial: "", value: "  Morning  ", expected: { name: "Morning" } }],
    [
      "update trimmed",
      { type: "update" as const, initial: "Existing", value: "  Morning  ", expected: { name: "Morning" } },
    ],
  ])("submits the %s payload", async (_label, input) => {
    const submit = vi.fn(() => new Promise<Project.Info>(() => {}))
    const existing = project(input.initial)
    renderDialog(input.type === "create" ? { type: "create", submit } : { type: "update", project: existing, submit })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    const name = screen.getByRole("textbox", { name: "Name" })
    await user.clear(name)
    if (input.value) await user.type(name, input.value)
    await user.click(screen.getByRole("button", { name: input.type === "create" ? "Create project" : "Save changes" }))

    expect(submit).toHaveBeenCalledWith(
      input.type === "create" ? input.expected : { projectID: existing.id, ...input.expected },
    )
  })

  it("does not let an update clear the project name", async () => {
    const submit = vi.fn(() => new Promise<Project.Info>(() => {}))
    renderDialog({ type: "update", project: project("Existing"), submit })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    const save = screen.getByRole("button", { name: "Save changes" })
    await user.clear(screen.getByRole("textbox", { name: "Name" }))
    expect(save).toBeDisabled()
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!)
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a project name.")
    expect(submit).not.toHaveBeenCalled()
  })

  it.each([
    ["create", "Create project", "Creating…"],
    ["update", "Save changes", "Saving…"],
  ] as const)("disables the %s form and prevents duplicate submission", async (mode, action, pendingLabel) => {
    const submit = vi.fn(() => new Promise<Project.Info>(() => {}))
    renderDialog(
      mode === "create" ? { type: "create", submit } : { type: "update", project: project("Existing"), submit },
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    if (mode === "create") await user.type(screen.getByRole("textbox", { name: "Name" }), "Morning")
    await user.click(screen.getByRole("button", { name: action }))
    const dialog = screen.getByRole("dialog")

    expect(dialog.querySelector("form")).toHaveAttribute("aria-busy", "true")
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: pendingLabel })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled()
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    fireEvent.submit(dialog.querySelector("form")!)
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("shows errors without closing and allows another update", async () => {
    const submit = vi.fn(async () => {
      throw new Error("Project name is unavailable")
    })
    renderDialog({ type: "update", project: project("Existing"), submit })

    await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Project name is unavailable")
    expect(screen.getByRole("dialog", { name: "Edit project" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.queryByText("Project could not be saved.")).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }))
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it("offers restoring an archived project from the create form", async () => {
    const restore = vi.fn()
    renderDialog({ type: "create", submit: vi.fn(), restore })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore an archived project" }))
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it("offers archiving from the edit form, and explains why the Default project cannot be archived", async () => {
    const run = vi.fn()
    renderDialog({ type: "update", project: project("Launch"), submit: vi.fn(), archive: { run } })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Open" }))
    expect(screen.queryByRole("button", { name: "Restore an archived project" })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive project" }))
    expect(run).toHaveBeenCalledTimes(1)
    cleanup()

    renderDialog({
      type: "update",
      project: project("Default"),
      submit: vi.fn(),
      archive: { run, disabled: "The Default project can't be archived." },
    })
    await user.click(screen.getByRole("button", { name: "Open" }))
    const archive = within(screen.getByRole("dialog")).getByRole("button", { name: "Archive project" })
    expect(archive).toBeDisabled()
    expect(archive).toHaveAccessibleDescription("The Default project can't be archived.")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("closes after success and restores focus", async () => {
    let finish!: (value: Project.Info) => void
    renderDialog({ type: "create", submit: () => new Promise((resolve) => (finish = resolve)) })
    const open = screen.getByRole("button", { name: "Open" })

    open.focus()
    await userEvent.setup().click(open)
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Name" }), "Morning")
    await userEvent.setup().click(screen.getByRole("button", { name: "Create project" }))
    finish(project("Morning"))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(open).toHaveFocus()
  })
})

function project(name: string) {
  return Project.Info.make({ id: Project.ID.create(), name, time_created: 1, time_updated: 1 })
}

function renderDialog(mode: ProjectDialogMode) {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <ProjectDialog mode={mode} />)}>
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
