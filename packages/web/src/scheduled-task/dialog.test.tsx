import type { ProjectListOutput, ScheduledTaskInfo } from "@bymorning/client"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import type { ModelOption } from "../utils/model-option"
import { ScheduledTaskDialog, type ScheduledTaskSubmit } from "./dialog"

type TaskModelRef = NonNullable<ScheduledTaskInfo["model"]>

afterEach(() => {
  vi.useFakeTimers()
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

const project = (id: string, name: string): ProjectListOutput[number] => ({
  id: id as ProjectListOutput[number]["id"],
  name,
  time_created: 1,
  time_updated: 1,
})

const projects = [project("prj_a", "Default project"), project("prj_b", "Other project")]

const model = (id: string, provider: string, name: string): ModelOption => ({
  id,
  name,
  provider: provider as ModelOption["provider"],
  providerLabel: provider,
  variants: [],
  limit: {},
})

const models = [model("gpt-5", "openai", "GPT-5"), model("claude", "anthropic", "Claude")]

const task = (overrides: Partial<ScheduledTaskInfo> = {}): ScheduledTaskInfo => ({
  id: "tsk_00000000000000000000000921" as ScheduledTaskInfo["id"],
  name: "Daily briefing",
  prompt: "Summarize the day",
  cron: "0 8 * * 1-5",
  timezone: "America/New_York",
  projectID: projects[0]!.id,
  enabled: true,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  ...overrides,
})

function renderDialog(props: {
  readonly task?: ScheduledTaskInfo
  readonly template?: { readonly name: string; readonly prompt: string; readonly cron: string }
  readonly onSubmit: (input: ScheduledTaskSubmit) => Promise<unknown>
}) {
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <ScheduledTaskDialog
              {...(props.task ? { task: props.task } : {})}
              {...(props.template ? { template: props.template } : {})}
              projects={projects}
              models={models}
              onSubmit={props.onSubmit}
            />
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

describe("ScheduledTaskDialog", () => {
  it("prefills the name, prompt, and schedule from a template", async () => {
    renderDialog({
      template: { name: "Daily briefing", prompt: "Summarize today", cron: "0 8 * * 1-5" },
      onSubmit: vi.fn(),
    })
    await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
    const dialog = await screen.findByRole("dialog", { name: "Schedule task" })
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Daily briefing")
    expect(within(dialog).getByLabelText("Prompt")).toHaveValue("Summarize today")
    expect(within(dialog).getByRole("button", { name: "Weekdays" })).toBeInTheDocument()
  })

  it("submits only the changed fields when editing an existing task", async () => {
    const submit = vi.fn(() => Promise.resolve(task()))
    renderDialog({ task: task(), onSubmit: submit })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit task" })

    await user.click(within(dialog).getByRole("switch", { name: "Enabled" }))
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit).toHaveBeenCalledWith({ type: "update", value: { taskID: task().id, enabled: false } })
  })

  it("clears an explicit model preference by submitting model: null", async () => {
    const withModel = task({ model: { provider: "openai" as TaskModelRef["provider"], id: "gpt-5" } })
    const submit = vi.fn(() => Promise.resolve(withModel))
    renderDialog({ task: withModel, onSubmit: submit })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit task" })

    const modelTrigger = within(dialog).getByRole("button", { name: "Model" })
    expect(modelTrigger).toHaveTextContent("GPT-5")
    await user.click(modelTrigger)
    await user.click(await screen.findByRole("option", { name: "Default model", hidden: true }))
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit).toHaveBeenCalledWith({ type: "update", value: { taskID: withModel.id, model: null } })
  })

  it("requires a name and a prompt before creating", async () => {
    const submit = vi.fn()
    renderDialog({ onSubmit: submit })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = await screen.findByRole("dialog", { name: "Schedule task" })

    // The browser's own `required` check blocks submission on a truly empty field; whitespace satisfies it
    // and lets the trimmed-value validation below run instead.
    await user.type(within(dialog).getByLabelText("Name"), "   ")
    await user.type(within(dialog).getByLabelText("Prompt"), "   ")
    await user.click(within(dialog).getByRole("button", { name: "Schedule task" }))
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument()
    expect(within(dialog).getByText("Enter a prompt.")).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })

  it("rejects a custom cron with occurrences closer than one hour", async () => {
    const submit = vi.fn()
    renderDialog({ onSubmit: submit })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = await screen.findByRole("dialog", { name: "Schedule task" })

    await user.type(within(dialog).getByLabelText("Name"), "Too frequent")
    await user.type(within(dialog).getByLabelText("Prompt"), "Check in")
    const frequencyTrigger = within(dialog).getByRole("button", { name: "Weekdays" })
    await user.click(frequencyTrigger)
    const listboxID = frequencyTrigger.getAttribute("aria-controls")!
    await user.click(
      within(document.getElementById(listboxID)!).getByRole("option", { name: "Custom cron", hidden: true }),
    )
    const cron = within(dialog).getByLabelText("Cron schedule")
    expect(cron).toHaveAttribute("placeholder", "0 9 * * 1-5")
    expect(
      within(dialog).getByText(/at least one hour apart\./, { selector: "[data-slot='scheduled-task-hint']" }),
    ).toBeInTheDocument()
    await user.clear(cron)
    await user.type(cron, "*/5 * * * *")
    await user.click(within(dialog).getByRole("button", { name: "Schedule task" }))

    expect(within(dialog).getByText("Runs must be at least one hour apart.")).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })
})
