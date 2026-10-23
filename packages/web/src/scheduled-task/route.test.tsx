import { ByMorning, type ByMorningClient, type ScheduledTaskListOutput } from "@bymorning/client"
import { Project } from "@bymorning/schema/project"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { MemoryRouter, Route } from "@solidjs/router"
import { cleanup, screen, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { afterEach, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { ScheduledTaskRoute } from "./route"
import { templates } from "./templates"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

const task = (input: { readonly name: string; readonly cron: string; readonly enabled?: boolean }) =>
  Schema.decodeUnknownSync(ScheduledTask.Info)({
    id: ScheduledTask.ID.create(),
    name: input.name,
    prompt: `Prompt for ${input.name}.`,
    cron: input.cron,
    timezone: "UTC",
    projectID: Project.ID.create(),
    enabled: input.enabled ?? true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })

function mount(scheduledTask: Partial<ByMorningClient["scheduledTask"]>) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    scheduledTask: { ...base.scheduledTask, ...scheduledTask },
    project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
  })
  render(() => (
    <MemoryRouter>
      <Route
        path="*"
        component={() => (
          <SDKProvider>
            <DialogProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DataProvider>
                  <ScheduledTaskRoute />
                </DataProvider>
              </WorkspaceScope>
            </DialogProvider>
            <Toast.Region />
          </SDKProvider>
        )}
      />
    </MemoryRouter>
  ))
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

it("requests the current workspace and renders the empty state with templates", async () => {
  const list = vi.fn<ByMorningClient["scheduledTask"]["list"]>().mockResolvedValue([])
  mount({ list })

  expect(await screen.findByRole("heading", { name: "No scheduled tasks yet." })).toBeInTheDocument()
  expect(list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.anything())
  const section = screen.getByRole("region", { name: "Templates" })
  expect(within(section).getAllByRole("button")).toHaveLength(templates.length)
  expect(within(section).getByRole("button", { name: /Test and build status/ })).toHaveTextContent(
    "Weekdays at 7:00 AM",
  )
})

it("renders a task row with its name and schedule description", async () => {
  const list: ScheduledTaskListOutput = [task({ name: "Daily operations brief", cron: "0 8 * * 1-5" })]
  mount({ list: vi.fn().mockResolvedValue(list) })

  const row = await screen.findByRole("heading", { name: "Daily operations brief" })
  const item = row.closest("li")!
  expect(within(item).getByText("Weekdays at 8:00 AM")).toBeInTheDocument()
  expect(within(item).getByText(/Prompt for Daily operations brief/)).toBeInTheDocument()
  expect(within(item).getByRole("switch", { name: "Pause Daily operations brief" })).toBeChecked()
  expect(within(item).getByRole("button", { name: "Actions for Daily operations brief" })).toBeInTheDocument()
})

it("humanizes an hourly cron and keeps unrecognized crons in monospace", async () => {
  mount({
    list: vi
      .fn()
      .mockResolvedValue([task({ name: "Hourly", cron: "0 * * * *" }), task({ name: "Odd", cron: "0 */2 * * *" })]),
  })

  const hourly = (await screen.findByRole("heading", { name: "Hourly" })).closest("li")!
  expect(within(hourly).getByText("Every hour")).toBeInTheDocument()
  const odd = screen.getByRole("heading", { name: "Odd" }).closest("li")!
  expect(within(odd).getByText("0 */2 * * *").closest("[data-slot='scheduled-task-schedule']")).toHaveAttribute(
    "data-raw",
  )
})

it("marks a paused task", async () => {
  mount({ list: vi.fn().mockResolvedValue([task({ name: "Weekly review", cron: "0 16 * * 5", enabled: false })]) })

  const row = await screen.findByRole("heading", { name: "Weekly review" })
  const item = row.closest("li")!
  expect(within(item).getByText("Paused", { selector: "[data-component='tag']" })).toBeInTheDocument()
  expect(within(item).getByRole("switch", { name: "Enable Weekly review" })).not.toBeChecked()
})

it("opens the create dialog from Schedule task and validates before submitting", async () => {
  const user = userEvent.setup()
  const create = vi.fn<ByMorningClient["scheduledTask"]["create"]>()
  mount({ list: vi.fn().mockResolvedValue([]), create })

  await user.click(await screen.findByRole("button", { name: "Schedule task" }))
  const dialog = await screen.findByRole("dialog", { name: "Schedule task" })
  expect(within(dialog).getByLabelText("Name")).toBeInTheDocument()
  expect(within(dialog).getByLabelText("Prompt")).toBeInTheDocument()
  expect(within(dialog).getByText(/Runs unattended/)).toBeInTheDocument()

  await user.type(within(dialog).getByLabelText("Name"), "   ")
  await user.type(within(dialog).getByLabelText("Prompt"), "   ")
  await user.click(within(dialog).getByRole("button", { name: "Schedule task" }))
  expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument()
  expect(within(dialog).getByText("Enter a prompt.")).toBeInTheDocument()
  expect(create).not.toHaveBeenCalled()
})

it("keeps the Frequency menu open and applies a choice", async () => {
  const user = userEvent.setup()
  mount({ list: vi.fn().mockResolvedValue([]) })

  await user.click(await screen.findByRole("button", { name: "Schedule task" }))
  const dialog = await screen.findByRole("dialog", { name: "Schedule task" })
  const trigger = within(dialog).getByRole("button", { name: "Weekdays" })
  await user.click(trigger)
  const listboxID = trigger.getAttribute("aria-controls")!
  expect(document.getElementById(listboxID)).not.toBeNull()
  await user.click(
    within(document.getElementById(listboxID)!).getByRole("option", { name: "Every week", hidden: true }),
  )
  expect(within(dialog).getByText("Weekday")).toBeInTheDocument()
  const reopened = within(dialog).getByRole("button", { name: "Every week" })
  await user.click(reopened)
  expect(document.getElementById(reopened.getAttribute("aria-controls")!)).not.toBeNull()
})
