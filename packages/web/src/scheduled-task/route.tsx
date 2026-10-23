import type { ScheduledTaskInfo } from "@bymorning/client"
import { A, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { useServer } from "../runtime/server/runtime"
import { WorkspacePage } from "../home/workspace-page"
import { createProviderCatalog } from "../integration/providers/model"
import { ActionMenu } from "../ui/components/action-menu"
import { Button } from "../ui/components/button"
import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { Icon } from "../ui/components/icon"
import { Switch as Toggle } from "../ui/components/switch"
import { Tag } from "../ui/components/tag"
import { showToast } from "../ui/components/toast"
import { createAutoModels } from "../utils/auto-models"
import { modelOptions } from "../utils/model-option"
import { sessionRouteHref, workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { createScheduledTaskActions } from "./actions"
import { ScheduledTaskDialog, type ScheduledTaskSubmit } from "./dialog"
import { describe, formatInstant, localTimeZone } from "./schedule"
import { templates, type Template } from "./templates"
import "./route.css"

export function ScheduledTaskRoute(): JSX.Element {
  const dialog = useDialog()
  const sdk = useSDK()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const server = useServer()
  const tasks = useData().workspace.scheduledTask
  const models = useData().workspace.model
  const projects = () => server.data.project.list()
  // The dialog offers the same Model choices as the conversation composer, which pairs Models with their Providers.
  const providerSignal = new AbortController()
  onCleanup(() => providerSignal.abort())
  const providers = createProviderCatalog({
    api: sdk.client,
    workspace: workspace.current().id,
    signal: providerSignal.signal,
  })
  const auto = createAutoModels({ api: sdk.client, workspace: workspace.current().id })
  const modelChoices = createMemo(() => modelOptions(providers.list() ?? [], models.list() ?? [], auto()))
  const modelsPending = () =>
    [providers.state(), models.state()].some((state) => state.state === "idle" || state.state === "loading")
  // A task's Project is never dangling: deleting a Project cascades to its Scheduled Tasks. The catalog lists
  // active Projects only, so an unmatched ID means it has not loaded yet or the Project is archived (and the
  // task is skipped until the Project is restored).
  const projectName = (projectID: string) => {
    const list = projects()
    return (
      list.find((project) => project.id === projectID)?.name ?? (list.length === 0 ? "Loading…" : "Archived project")
    )
  }
  onMount(() => {
    void tasks.sync().catch(() => undefined)
    if (models.state().state === "idle") void models.sync().catch(() => undefined)
    if (providers.state().state === "idle") void providers.sync().catch(() => undefined)
  })
  createEffect(
    on(
      () => tasks.state(),
      (state) => {
        if (state.state !== "error") return
        showToast({
          variant: "error",
          title: state.message ?? "Could not load scheduled tasks.",
          actions: [{ label: "Try again", onClick: () => void tasks.sync().catch(() => undefined) }],
        })
      },
    ),
  )

  const refresh = () => {
    tasks.invalidate()
    void tasks.sync().catch(() => undefined)
  }
  const submit = async (input: ScheduledTaskSubmit) => {
    const workspaceID = workspace.current().id
    if (input.type === "create") await sdk.client.scheduledTask.create({ workspace: workspaceID, ...input.value })
    else await sdk.client.scheduledTask.update({ workspace: workspaceID, ...input.value })
    refresh()
  }
  const openForm = (input: { readonly task?: ScheduledTaskInfo; readonly template?: Template } = {}) =>
    dialog.show(() => (
      <ScheduledTaskDialog
        {...(input.task ? { task: input.task } : {})}
        {...(input.template ? { template: input.template } : {})}
        projects={projects()}
        models={modelChoices()}
        modelsPending={modelsPending()}
        modelsHref={workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.gatewayModels)}
        onSubmit={submit}
      />
    ))
  const { runNow, toggle } = createScheduledTaskActions({ sdk, workspace, navigate, refresh })
  const confirmDelete = (task: ScheduledTaskInfo) =>
    dialog.show(() => (
      <ConfirmDialog
        title="Delete scheduled task?"
        description={`This will remove “${task.name}” and stop its schedule. Sessions it already created are kept.`}
        confirmLabel="Delete task"
        danger
        onConfirm={async () => {
          await sdk.client.scheduledTask.delete({ workspace: workspace.current().id, taskID: task.id })
          refresh()
        }}
      />
    ))

  return (
    <WorkspacePage
      title="Scheduled tasks"
      description="Run tasks on a schedule or whenever you need them."
      actions={
        <Button variant="primary" icon="central-plus-small" onClick={() => openForm()}>
          Schedule task
        </Button>
      }
    >
      <div data-component="scheduled-task-page">
        <Switch>
          <Match when={tasks.list()}>
            {(list) => (
              <Show
                when={list().length > 0}
                fallback={
                  <div data-slot="scheduled-task-empty">
                    <Icon name="central-clock" size="large" />
                    <h2>No scheduled tasks yet.</h2>
                  </div>
                }
              >
                <ul data-slot="scheduled-task-list" aria-label="Scheduled tasks">
                  <For each={list()}>
                    {(task) => (
                      <ScheduledTaskRow
                        task={task}
                        workspaceID={workspace.current().id}
                        projectName={projectName(task.projectID)}
                        onEdit={() => openForm({ task })}
                        onRun={() => runNow(task)}
                        onDelete={() => confirmDelete(task)}
                        onToggle={(enabled) => toggle(task, enabled)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Match>
          <Match when={tasks.state().state === "error"}>
            <p role="alert" data-slot="scheduled-task-status">
              Could not load scheduled tasks.
            </p>
          </Match>
          <Match when={true}>
            <p role="status" aria-label="Loading scheduled tasks" data-slot="scheduled-task-status">
              Loading scheduled tasks…
            </p>
          </Match>
        </Switch>
        <section data-slot="scheduled-task-templates" aria-label="Templates">
          <h2>Templates</h2>
          <ul>
            <For each={templates}>
              {(template) => (
                <li>
                  <button type="button" onClick={() => openForm({ template })}>
                    <strong>{template.name}</strong>
                    <span data-slot="template-summary">{template.summary}</span>
                    <span data-slot="template-schedule">
                      <Icon name="central-clock" size="small" /> {describe(template.cron)}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </WorkspacePage>
  )
}

function ScheduledTaskRow(props: {
  readonly task: ScheduledTaskInfo
  readonly workspaceID: string
  readonly projectName: string
  readonly onEdit: () => void
  readonly onRun: () => void
  readonly onDelete: () => void
  readonly onToggle: (enabled: boolean) => void
}): JSX.Element {
  const task = () => props.task
  const zoneDiffers = () => task().timezone !== localTimeZone()
  return (
    <li>
      <div data-slot="scheduled-task-primary">
        <div data-slot="scheduled-task-title">
          <h2>{task().name}</h2>
          <Show when={!task().enabled}>
            <Tag>Paused</Tag>
          </Show>
          <Show when={task().missedAt}>
            {(missedAt) => <Tag>Missed {formatInstant(new Date(missedAt()), task().timezone)}</Tag>}
          </Show>
        </div>
        <p data-slot="prompt-preview">{task().prompt}</p>
        <dl data-slot="scheduled-task-details">
          <div>
            <dt>Schedule</dt>
            <dd>
              <span
                data-slot="scheduled-task-schedule"
                data-raw={describe(task().cron) === task().cron ? "" : undefined}
              >
                <Icon name="central-clock" size="small" /> {describe(task().cron)}
              </span>
              <Show when={zoneDiffers()}> · {task().timezone}</Show>
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{props.projectName}</dd>
          </div>
          <div>
            <dt>Next run</dt>
            <dd>
              <Show when={task().enabled} fallback="Paused">
                <Show when={task().nextRunAt} fallback="Not scheduled">
                  {(nextRunAt) => formatInstant(new Date(nextRunAt()), task().timezone)}
                </Show>
              </Show>
            </dd>
          </div>
          <div>
            <dt>Last run</dt>
            <dd>
              <Show when={task().lastRunAt} fallback="Never">
                {(lastRunAt) => (
                  <Show
                    when={task().lastSessionID}
                    fallback={
                      <time dateTime={lastRunAt().toISOString()}>
                        {formatInstant(new Date(lastRunAt()), task().timezone)}
                      </time>
                    }
                  >
                    {(sessionID) => (
                      <A href={sessionRouteHref(props.workspaceID, sessionID())}>
                        <time dateTime={lastRunAt().toISOString()}>
                          {formatInstant(new Date(lastRunAt()), task().timezone)}
                        </time>
                      </A>
                    )}
                  </Show>
                )}
              </Show>
            </dd>
          </div>
        </dl>
        <Show when={task().lastNote}>{(note) => <p data-slot="scheduled-task-note">{note()}</p>}</Show>
      </div>
      <div data-slot="scheduled-task-controls">
        <span data-slot="scheduled-task-state" aria-hidden="true">
          {task().enabled ? "Active" : "Paused"}
        </span>
        <Toggle checked={task().enabled} hideLabel onChange={(checked) => props.onToggle(checked)}>
          {task().enabled ? `Pause ${task().name}` : `Enable ${task().name}`}
        </Toggle>
        <ActionMenu label={task().name}>
          <ActionMenu.Item onSelect={() => props.onEdit()}>Edit</ActionMenu.Item>
          <ActionMenu.Item onSelect={() => props.onRun()}>Run now</ActionMenu.Item>
          <ActionMenu.Separator />
          <ActionMenu.Item class="danger" onSelect={() => props.onDelete()}>
            Delete
          </ActionMenu.Item>
        </ActionMenu>
      </div>
    </li>
  )
}
