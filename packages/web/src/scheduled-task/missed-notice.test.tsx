import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { Project } from "@bymorning/schema/project"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { MemoryRouter, Route } from "@solidjs/router"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { afterEach, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { MissedRunNotice } from "./missed-notice"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

const task = (input: { readonly name: string; readonly missedAt?: string }) =>
  Schema.decodeUnknownSync(ScheduledTask.Info)({
    id: ScheduledTask.ID.create(),
    name: input.name,
    prompt: `Prompt for ${input.name}.`,
    cron: "0 8 * * 1-5",
    timezone: "UTC",
    projectID: Project.ID.create(),
    enabled: true,
    ...(input.missedAt === undefined ? {} : { missedAt: input.missedAt }),
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })

function mount(scheduledTask: Partial<ByMorningClient["scheduledTask"]>) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, scheduledTask: { ...base.scheduledTask, ...scheduledTask } })
  render(() => (
    <MemoryRouter>
      <Route
        path="*"
        component={() => (
          <SDKProvider>
            <DialogProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DataProvider>
                  <MissedRunNotice />
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

it("renders nothing when no task is missed", async () => {
  const list = vi.fn().mockResolvedValue([task({ name: "Daily briefing" })])
  mount({ list })
  await waitFor(() => expect(list).toHaveBeenCalled())
  expect(screen.queryByRole("group", { name: "Missed scheduled tasks" })).not.toBeInTheDocument()
})

it("shows only the missed tasks, and only them", async () => {
  const list = vi.fn().mockResolvedValue([
    task({ name: "Daily briefing" }),
    task({ name: "Weekly review", missedAt: "2026-09-18T08:00:00.000Z" }),
  ])
  mount({ list })

  const region = await screen.findByRole("group", { name: "Missed scheduled tasks" })
  expect(within(region).getByText(/Weekly review was due/)).toBeInTheDocument()
  expect(within(region).queryByText(/Daily briefing/)).not.toBeInTheDocument()
})

it("runs a missed task now and refreshes the list", async () => {
  const missed = task({ name: "Weekly review", missedAt: "2026-09-18T08:00:00.000Z" })
  const run = vi.fn().mockResolvedValue({ id: "ses_00000000000000000000000921", title: "Weekly review" })
  const list = vi.fn().mockResolvedValueOnce([missed]).mockResolvedValueOnce([])
  mount({ list, run })
  const user = userEvent.setup()

  const region = await screen.findByRole("group", { name: "Missed scheduled tasks" })
  await user.click(within(region).getByRole("button", { name: "Run now" }))

  await waitFor(() => expect(run).toHaveBeenCalledWith({ workspace: workspace.id, taskID: missed.id }))
  expect(await screen.findByText("Weekly review started")).toBeInTheDocument()
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
})

it("dismisses a missed task and refreshes the list", async () => {
  const missed = task({ name: "Weekly review", missedAt: "2026-09-18T08:00:00.000Z" })
  const dismiss = vi.fn().mockResolvedValue({ ...missed, missedAt: undefined })
  const list = vi.fn().mockResolvedValueOnce([missed]).mockResolvedValueOnce([])
  mount({ list, dismiss })
  const user = userEvent.setup()

  const region = await screen.findByRole("group", { name: "Missed scheduled tasks" })
  await user.click(within(region).getByRole("button", { name: "Dismiss" }))

  await waitFor(() => expect(dismiss).toHaveBeenCalledWith({ workspace: workspace.id, taskID: missed.id }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
})

it("shows an error toast when running fails", async () => {
  const missed = task({ name: "Weekly review", missedAt: "2026-09-18T08:00:00.000Z" })
  const run = vi.fn().mockRejectedValue({ cause: "fixture" })
  mount({ list: vi.fn().mockResolvedValue([missed]), run })
  const user = userEvent.setup()

  const region = await screen.findByRole("group", { name: "Missed scheduled tasks" })
  await user.click(within(region).getByRole("button", { name: "Run now" }))

  expect(await screen.findByText("Could not run Weekly review.")).toBeInTheDocument()
})
