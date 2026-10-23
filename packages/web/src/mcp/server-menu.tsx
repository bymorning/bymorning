import { Show, type JSX } from "solid-js"

import { useWorkspace } from "../context/workspace"
import { ActionMenu } from "../ui/components/action-menu"
import { showToast } from "../ui/components/toast"
import {
  MCPServerActionItems,
  createAction,
  mcpServerOperationStatus,
  type MCPServer,
  type MCPServerOperation,
} from "./server-actions"

export function ServerMenu(props: {
  readonly server: MCPServer
  readonly onRefresh: () => void
  readonly onRemove: () => Promise<unknown>
  readonly onAuthenticate: () => Promise<unknown>
  readonly canRemove: boolean
}): JSX.Element {
  const action = createAction()
  const workspace = useWorkspace()
  const operate = (operation: MCPServerOperation, run: () => Promise<unknown>) => {
    const scope = workspace.current().id
    const refresh = props.onRefresh
    void action.run(operation, run).then(
      (completed) => {
        if (completed && workspace.current().id === scope) {
          if (operation === "test") showToast({ variant: "success", title: "Connection test passed." })
          refresh()
        }
      },
      () => undefined,
    )
  }
  const busy = () => action.pending() !== ""
  return (
    <>
      <ActionMenu label={props.server.name} disabled={busy()}>
        <MCPServerActionItems {...props} pending={action.pending()} onOperate={operate} />
      </ActionMenu>
      <p role="status" aria-live="polite">
        {action.pending() ? mcpServerOperationStatus[action.pending() as MCPServerOperation] : ""}
      </p>
      <Show when={action.error()}>{(message) => <p role="alert">{message()}</p>}</Show>
    </>
  )
}
