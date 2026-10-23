import type { ToolUsageListOutput } from "@bymorning/client"
import { createEffect, For, on, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { RequestLog, RequestLogIdentity, RequestLogTable } from "../console/request-log"
import { useData } from "../context/data"
import { WorkspacePage } from "../home/workspace-page"
import { showToast } from "../ui/components/toast"
import { formatRelativeTime } from "../ui/format"
import { ConnectedSection } from "./connected"

type ToolUsageRecord = ToolUsageListOutput["data"][number]

export function MCPOverview(): JSX.Element {
  return (
    <WorkspacePage
      title="Integrations"
      description="Services, web search, and MCP servers this Workspace connects to, and the log of every tool request."
      layout="table"
    >
      <div data-component="mcp-server-settings">
        <ConnectedSection />

        <div data-slot="mcp-divider" />

        <MCPToolUsage />
      </div>
    </WorkspacePage>
  )
}

function MCPToolUsage(): JSX.Element {
  const usage = useData().gateway.toolUsage
  const [state, setState] = createStore<{
    cursor: string | undefined
    history: Array<string | undefined>
  }>({ cursor: undefined, history: [] })
  const page = usage(() => ({ limit: 50, cursor: state.cursor }))
  createEffect(
    on(
      () => page.state(),
      (queryState) => {
        if (queryState.state !== "error") return
        showToast({
          variant: "error",
          title: queryState.message ?? "Could not load request log.",
          actions: [{ label: "Try again", onClick: () => page.refetch() }],
        })
      },
    ),
  )
  const loaded = () => page.state().data
  const loading = () => page.state().state === "loading" && loaded() === undefined

  return (
    <RequestLog
      loading={loading()}
      ready={loaded() !== undefined}
      empty={loaded() !== undefined && loaded()!.data.length === 0}
      emptyLabel="No requests"
      canGoPrevious={state.history.length > 0}
      canGoNext={loaded()?.cursor !== undefined}
      onPrevious={() => {
        const previous = state.history.at(-1)
        setState({ cursor: previous, history: state.history.slice(0, -1) })
      }}
      onNext={() => {
        const cursor = loaded()?.cursor
        if (cursor === undefined) return
        setState({ cursor, history: [...state.history, state.cursor] })
      }}
    >
      <RequestLogTable>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Tool</th>
            <th scope="col">Status</th>
            <th scope="col" data-align="end">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={loaded()?.data}>{(record) => <ToolUsageRow record={record} />}</For>
        </tbody>
      </RequestLogTable>
    </RequestLog>
  )
}

function ToolUsageRow(props: { readonly record: ToolUsageRecord }): JSX.Element {
  return (
    <tr>
      <td>
        <time dateTime={props.record.occurredAt.toISOString()} title={props.record.occurredAt.toLocaleString()}>
          {formatRelativeTime(props.record.occurredAt)}
        </time>
      </td>
      <RequestLogIdentity title={props.record.tool}>{props.record.tool}</RequestLogIdentity>
      <td>
        <span data-slot="mcp-request-status" data-status={props.record.status}>
          {props.record.status === "completed" ? "Completed" : "Error"}
        </span>
      </td>
      <td data-align="end">{placeholderDuration(props.record.id)} ms</td>
    </tr>
  )
}

// Duration is not persisted yet, so keep the requested placeholder stable across rerenders.
function placeholderDuration(id: string) {
  return [...id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 99, 0) + 1
}
