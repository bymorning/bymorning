import { useNavigate } from "@solidjs/router"
import { For, onMount, Show, type JSX } from "solid-js"

import { useData } from "../context/data"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { Button } from "../ui/components/button"
import { Icon } from "../ui/components/icon"
import { createScheduledTaskActions } from "./actions"
import { formatInstant } from "./schedule"
import "./missed-notice.css"

/** Surfaces Scheduled Tasks that were due while ByMorning was not running. Dismissal is a server call. */
export function MissedRunNotice(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const tasks = useData().workspace.scheduledTask
  onMount(() => {
    if (tasks.state().state === "idle") void tasks.sync().catch(() => undefined)
  })
  const missed = () =>
    (tasks.list() ?? []).flatMap((task) =>
      task.missedAt === undefined ? [] : [{ ...task, missedAt: task.missedAt }],
    )
  const refresh = () => {
    tasks.invalidate()
    void tasks.sync().catch(() => undefined)
  }
  const { runNow, dismiss } = createScheduledTaskActions({ sdk, workspace, navigate, refresh })

  return (
    <Show when={missed().length > 0}>
      <div data-component="scheduled-task-missed" role="group" aria-label="Missed scheduled tasks">
        <For each={missed()}>
          {(task) => (
            <p data-slot="scheduled-task-missed-row">
              <Icon name="central-clock" size="small" />
              <span data-slot="scheduled-task-missed-text">
                {task.name} was due {formatInstant(new Date(task.missedAt), task.timezone)} but did not run.
              </span>
              <span data-slot="scheduled-task-missed-actions">
                <Button type="button" size="small" variant="outline" onClick={() => runNow(task)}>
                  Run now
                </Button>
                <Button type="button" size="small" variant="ghost" onClick={() => dismiss(task)}>
                  Dismiss
                </Button>
              </span>
            </p>
          )}
        </For>
      </div>
    </Show>
  )
}
