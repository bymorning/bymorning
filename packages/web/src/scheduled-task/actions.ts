import type { ScheduledTaskInfo } from "@bymorning/client"
import type { Navigator } from "@solidjs/router"

import type { useSDK } from "../context/sdk"
import type { useWorkspace } from "../context/workspace"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import { sessionRouteHref } from "../workspace-route-paths"

/** Run-now, dismiss, and pause/resume calls shared by the task list and the missed-run notice. */
export function createScheduledTaskActions(input: {
  readonly sdk: ReturnType<typeof useSDK>
  readonly workspace: ReturnType<typeof useWorkspace>
  readonly navigate: Navigator
  readonly refresh: () => void
}) {
  const runNow = (task: ScheduledTaskInfo) => {
    void input.sdk.client.scheduledTask
      .run({ workspace: input.workspace.current().id, taskID: task.id })
      .then((session) => {
        showToast({
          variant: "success",
          title: `${task.name} started`,
          actions: [
            {
              label: "Open session",
              onClick: () => input.navigate(sessionRouteHref(input.workspace.current().id, session.id)),
            },
          ],
        })
        input.refresh()
      })
      .catch((cause) => showToast({ variant: "error", title: errorMessage(cause, `Could not run ${task.name}.`) }))
  }
  const dismiss = (task: ScheduledTaskInfo) => {
    void input.sdk.client.scheduledTask
      .dismiss({ workspace: input.workspace.current().id, taskID: task.id })
      .then(input.refresh)
      .catch((cause) => showToast({ variant: "error", title: errorMessage(cause, `Could not dismiss ${task.name}.`) }))
  }
  const toggle = (task: ScheduledTaskInfo, enabled: boolean) => {
    void input.sdk.client.scheduledTask
      .update({ workspace: input.workspace.current().id, taskID: task.id, enabled })
      .then(input.refresh)
      .catch((cause) =>
        showToast({ variant: "error", title: errorMessage(cause, `Could not update ${task.name}.`) }),
      )
  }
  return { runNow, dismiss, toggle }
}
