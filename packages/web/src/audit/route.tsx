import type { ByMorningClient } from "@bymorning/client"
import { Audit } from "@bymorning/schema/audit"
import { Account } from "@bymorning/schema/account"
import type * as Workspace from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { createStore } from "solid-js/store"
import { For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"

import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { ScrollFrame } from "../ui/components/scroll-frame"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import "./route.css"

type AuditClient = ByMorningClient["api.audit"]
export type AuditEntry = Awaited<ReturnType<AuditClient["list"]>>["data"][number]
export type AuditAction = (typeof Audit.Action.literals)[number]

const actions = Audit.Action.literals

/** Readable label for an action code, such as `user.role.update` → "User role update". */
export const actionLabel = (action: string) => {
  const words = action
    .split(/[._-]+/)
    .filter((word) => word !== "")
    .map((word, index) => acronyms[word] ?? (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
  return words.join(" ")
}

const acronyms: Record<string, string> = { oauth: "OAuth", mcp: "MCP", api: "API", sso: "SSO", ip: "IP" }

/** Outcome shown with a leading capital, such as "Success". */
export const outcomeLabel = (outcome: string) => outcome.charAt(0).toUpperCase() + outcome.slice(1)

interface Filters {
  action: "" | AuditAction
  actor: string
  target: string
  from: string
  to: string
}

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly entries: ReadonlyArray<AuditEntry>
  readonly cursor: string | undefined
  readonly pending: boolean
  readonly exporting: boolean
  readonly filters: Filters
}

/** Console → Audit: security record review and export for Workspace administrators. */
export function AuditRoute(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  return <AuditPage workspaceID={workspace.current().id} client={sdk.client["api.audit"]} />
}

const actorLabel = (actor: AuditEntry["actor"]) => {
  switch (actor.type) {
    case "account":
      return `account ${actor.accountID}`
    case "user":
      return `user ${actor.userID}`
    case "service_account":
      return `service account ${actor.serviceAccountID}`
    case "system":
      return "system"
    case "anonymous":
      return actor.email === undefined ? "anonymous" : `anonymous (${actor.email})`
  }
}

const asDate = (value: unknown) => (value instanceof Date ? value : new Date(String(value)))

function toCSV(entries: ReadonlyArray<AuditEntry>) {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  const rows = entries.map((entry) =>
    [
      asDate(entry.occurredAt).toISOString(),
      entry.id,
      entry.actor.type,
      actorLabel(entry.actor),
      entry.action,
      entry.workspaceID ?? "",
      entry.target ?? "",
      entry.outcome,
      entry.context?.ip ?? "",
      entry.context?.userAgent ?? "",
    ]
      .map(escape)
      .join(","),
  )
  return ["occurred_at,id,actor_type,actor,action,workspace,target,outcome,ip,user_agent", ...rows].join("\n") + "\n"
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Audit Entry review. */
export function AuditPage(props: { readonly workspaceID: Workspace.ID; readonly client: AuditClient }): JSX.Element {
  const [state, setState] = createStore<State>({
    phase: "loading",
    entries: [],
    cursor: undefined,
    pending: false,
    exporting: false,
    filters: { action: "", actor: "", target: "", from: "", to: "" },
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const query = (cursor?: string) => {
    const filters = state.filters
    const actor = filters.actor.trim()
    return {
      workspace: props.workspaceID,
      ...(filters.action === "" ? {} : { action: filters.action }),
      ...(actor === "" || !Schema.is(Account.ID)(actor) ? {} : { actor }),
      ...(filters.target.trim() === "" ? {} : { target: filters.target.trim() }),
      ...(filters.from === "" ? {} : { from: new Date(filters.from) }),
      ...(filters.to === "" ? {} : { to: new Date(filters.to) }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: 100,
    } as const
  }

  const load = async (cursor?: string) => {
    setState({ pending: true })
    try {
      const page = await props.client.list(query(cursor))
      if (disposed) return
      setState((current) => ({
        phase: "ready",
        pending: false,
        entries: cursor === undefined ? page.data : [...current.entries, ...page.data],
        cursor: page.cursor,
      }))
    } catch (cause) {
      if (disposed) return
      setState({ phase: "error", pending: false })
      showToast({ variant: "error", title: errorMessage(cause, "Could not load the audit log.") })
    }
  }

  const refresh = () => {
    setState({ phase: "loading", entries: [], cursor: undefined })
    void load()
  }
  onMount(refresh)

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setState("filters", key, value)

  const exportAll = async (format: "csv" | "json") => {
    setState({ exporting: true })
    try {
      const all: AuditEntry[] = []
      let cursor: string | undefined
      do {
        const page = await props.client.list(query(cursor))
        all.push(...page.data)
        cursor = page.cursor
      } while (cursor !== undefined)
      if (disposed) return
      const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")
      if (format === "csv") download(`audit-${stamp}.csv`, toCSV(all), "text/csv")
      else download(`audit-${stamp}.json`, JSON.stringify(all, null, 2) + "\n", "application/json")
      showToast({ variant: "success", title: `Exported ${all.length} audit ${all.length === 1 ? "entry" : "entries"}` })
    } catch (cause) {
      if (disposed) return
      showToast({ variant: "error", title: errorMessage(cause, "Could not export the audit log.") })
    } finally {
      if (!disposed) setState({ exporting: false })
    }
  }

  return (
    <WorkspacePage
      title="Audit log"
      layout="table"
      actions={
        <Show when={state.phase === "ready" && state.entries.length > 0}>
          <Button variant="outline" disabled={state.exporting} onClick={() => void exportAll("csv")}>
            Export CSV
          </Button>
          <Button variant="outline" disabled={state.exporting} onClick={() => void exportAll("json")}>
            Export JSON
          </Button>
        </Show>
      }
    >
      <div data-component="audit-region">
        <form
          data-slot="audit-filters"
          onSubmit={(event) => {
            event.preventDefault()
            refresh()
          }}
        >
          <label>
            <span>Action</span>
            <select
              aria-label="Filter by action"
              value={state.filters.action}
              onChange={(event) => setFilter("action", event.currentTarget.value as Filters["action"])}
            >
              <option value="">All actions</option>
              <For each={actions}>{(action) => <option value={action}>{actionLabel(action)}</option>}</For>
            </select>
          </label>
          <label>
            <span>Actor</span>
            <input
              aria-label="Filter by actor account"
              placeholder="Actor account ID"
              value={state.filters.actor}
              onInput={(event) => setFilter("actor", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Target</span>
            <input
              aria-label="Filter by target"
              placeholder="Target"
              value={state.filters.target}
              onInput={(event) => setFilter("target", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>From</span>
            <input
              aria-label="From"
              type="datetime-local"
              value={state.filters.from}
              onInput={(event) => setFilter("from", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              aria-label="To"
              type="datetime-local"
              value={state.filters.to}
              onInput={(event) => setFilter("to", event.currentTarget.value)}
            />
          </label>
          <Button type="submit" variant="outline" disabled={state.pending}>
            Apply
          </Button>
        </form>
        <Switch>
          <Match when={state.phase === "loading"}>
            <p role="status" aria-label="Loading audit log" data-slot="audit-status">
              Loading audit log…
            </p>
          </Match>
          <Match when={state.phase === "error"}>
            <Button type="button" variant="ghost" onClick={refresh}>
              Try again
            </Button>
          </Match>
          <Match when={state.phase === "ready"}>
            <Show when={state.entries.length > 0} fallback={<Empty variant="panel">No audit entries match.</Empty>}>
              <ScrollFrame data-slot="audit-table-scroll">
                <table data-slot="audit-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Actor</th>
                      <th scope="col">Action</th>
                      <th scope="col">Target</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.entries}>
                      {(entry) => (
                        <tr data-outcome={entry.outcome}>
                          <td data-slot="audit-time">{asDate(entry.occurredAt).toLocaleString()}</td>
                          <td>{actorLabel(entry.actor)}</td>
                          <td data-slot="audit-action">
                            <span title={entry.action}>{actionLabel(entry.action)}</span>
                          </td>
                          <td>{entry.target ?? ""}</td>
                          <td>{outcomeLabel(entry.outcome)}</td>
                          <td>{entry.context?.ip ?? ""}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </ScrollFrame>
              <Show when={state.cursor !== undefined}>
                <div data-slot="audit-more">
                  <Button variant="ghost" disabled={state.pending} onClick={() => void load(state.cursor)}>
                    {state.pending ? "Loading…" : "Load more"}
                  </Button>
                </div>
              </Show>
            </Show>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}
