import type { McpServersListOutput } from "@bymorning/client"
import { Show, type JSX } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { errorMessage } from "../utils/error-message"

import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { ActionMenu } from "../ui/components/action-menu"
import { ConfirmDialog } from "../ui/components/confirm-dialog"

export type MCPServer = McpServersListOutput[number]
export type MCPServerOperation = "authenticate" | "connect" | "disconnect" | "remove" | "test"

export const mcpServerOperationStatus = {
  authenticate: "Authenticating…",
  connect: "Connecting…",
  disconnect: "Disconnecting…",
  remove: "Removing…",
  test: "Testing connection…",
} as const

export function createAction() {
  let admitted = false
  const mutation = useMutation(() => ({
    retry: false,
    networkMode: "always",
    mutationFn: (input: { operation: MCPServerOperation; run: () => Promise<unknown> }) => input.run(),
  }))
  return {
    mutation,
    pending: () => (mutation.isPending ? (mutation.variables?.operation ?? "") : ""),
    error: () => (mutation.error ? errorMessage(mutation.error, "Server operation failed.") : undefined),
    async run(operation: MCPServerOperation, run: () => Promise<unknown>) {
      if (admitted || mutation.isPending) return false
      admitted = true
      try {
        await mutation.mutateAsync({ operation, run })
        return true
      } finally {
        admitted = false
      }
    },
  }
}

export function MCPServerActionItems(props: {
  readonly server: MCPServer
  readonly pending: string
  readonly onOperate: (operation: MCPServerOperation, run: () => Promise<unknown>) => void
  /** Removal is confirmation-owned, so failures must reject to keep it open. */
  readonly onRemove: () => Promise<unknown>
  readonly onAuthenticate: () => Promise<unknown>
  readonly canRemove: boolean
}): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const dialog = useDialog()
  const busy = () => props.pending !== ""
  const operate = (operation: "test" | "connect" | "disconnect") => {
    const client = sdk.client
    const input = { server: props.server.name, workspace: workspace.current().id }
    props.onOperate(operation, async () => {
      if (operation === "test") {
        const result = await client.mcp.servers.test(input)
        if (!result.ok) throw new Error(result.error ?? "Connection test failed")
      } else await client.mcp.servers[operation](input)
    })
  }
  return (
    <>
      <Show when={props.server.enabled}>
        <ActionMenu.Item disabled={busy()} onSelect={() => operate("test")}>
          Test connection
        </ActionMenu.Item>
      </Show>
      <Show when={props.server.enabled && props.server.status === "needs_auth"}>
        <ActionMenu.Item disabled={busy()} onSelect={() => props.onOperate("authenticate", props.onAuthenticate)}>
          Authenticate
        </ActionMenu.Item>
      </Show>
      <Show
        when={
          props.server.enabled &&
          props.server.auth === "values" &&
          props.server.integrationID !== undefined &&
          (props.server.status === "connected" || props.server.status === "failed")
        }
      >
        <ActionMenu.Item disabled={busy()} onSelect={() => props.onOperate("authenticate", props.onAuthenticate)}>
          Update values
        </ActionMenu.Item>
      </Show>
      <Show when={props.server.enabled && (props.server.status === "failed" || props.server.status === "disabled")}>
        <ActionMenu.Item disabled={busy()} onSelect={() => operate("connect")}>
          {props.server.status === "failed" ? "Retry" : "Connect"}
        </ActionMenu.Item>
      </Show>
      <Show when={props.server.status === "connected" || props.server.status === "pending"}>
        <ActionMenu.Item disabled={busy()} onSelect={() => operate("disconnect")}>
          Disconnect
        </ActionMenu.Item>
      </Show>
      <Show when={props.canRemove}>
        <ActionMenu.Item
          class="danger"
          disabled={busy()}
          onSelect={() => {
            const remove = props.onRemove
            const name = props.server.name
            dialog.push(() => <ConfirmDialog title={`Remove ${name}?`} confirmLabel="Remove" danger onConfirm={remove} />)
          }}
        >
          Remove
        </ActionMenu.Item>
      </Show>
    </>
  )
}
