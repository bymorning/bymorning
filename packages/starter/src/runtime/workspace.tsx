import { isUnauthorizedError, type WorkspaceAccessInfo } from "@bymorning/client"
import { ID as WorkspaceID } from "@bymorning/schema/workspace"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/solid-query"
import { Schema } from "effect"
import { For, createContext, createEffect, createMemo, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { browserClient, discoverWorkspace } from "@/runtime/auth.js"

type Boot = "loading" | "login" | "ready" | "error"

function createWorkspace() {
  const [state, setState] = createStore<{
    boot: Boot
    workspaces: readonly WorkspaceAccessInfo[]
    workspace?: WorkspaceAccessInfo["id"]
    identity: number
    error?: string
  }>({
    boot: "loading",
    workspaces: [],
    workspace: parseWorkspace(new URLSearchParams(location.search).get("workspace")),
    identity: 0,
  })
  const origin = location.origin
  const discovery = createMemo(() => `${origin}:${state.identity}`)
  const discovered = (workspaces: readonly WorkspaceAccessInfo[]) => {
    const requested = parseWorkspace(new URLSearchParams(location.search).get("workspace"))
    const workspace = workspaces.find((item) => item.id === requested)?.id ?? workspaces[0]?.id
    setState({ workspaces, workspace, boot: "ready", error: undefined })
    if (workspace) writeWorkspace(workspace, "replace")
  }
  const failed = (error: unknown) => {
    setState({ boot: isUnauthorizedError(error) ? "login" : "error", error: describe(error) })
  }
  const retry = () => {
    setState({ boot: "loading", error: undefined, identity: state.identity + 1 })
  }
  const selectWorkspace = (workspace: string) => {
    const selected = state.workspaces.find((item) => item.id === workspace)
    if (!selected) return
    setState("workspace", selected.id)
    writeWorkspace(selected.id, "push")
  }
  const pop = () => {
    const workspace = parseWorkspace(new URLSearchParams(location.search).get("workspace"))
    if (workspace && workspace !== state.workspace && state.workspaces.some((item) => item.id === workspace))
      setState("workspace", workspace)
  }
  addEventListener("popstate", pop)
  onCleanup(() => removeEventListener("popstate", pop))

  return { state, origin, discovery, discovered, failed, retry, select: selectWorkspace }
}

const WorkspaceContext = createContext<ReturnType<typeof createWorkspace>>()

export function WorkspaceProvider(props: ParentProps) {
  const workspace = createWorkspace()
  return (
    <WorkspaceContext.Provider value={workspace}>
      <For each={[workspace.discovery()]}>
        {() => (
          <Discovery
            identity={workspace.state.identity}
            origin={workspace.origin}
            ready={workspace.discovered}
            failed={workspace.failed}
          />
        )}
      </For>
      {props.children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error("WorkspaceProvider is missing")
  return workspace
}

function Discovery(props: {
  readonly origin: string
  readonly identity: number
  readonly ready: (workspaces: readonly WorkspaceAccessInfo[]) => void
  readonly failed: (error: unknown) => void
}) {
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false, refetchOnMount: false },
      mutations: { retry: false },
    },
  })
  let closing = false
  const teardown = async () => {
    if (closing) return
    closing = true
    try {
      await query.cancelQueries()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error)
    } finally {
      try {
        query.clear()
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error)
      }
    }
  }
  onCleanup(() => {
    void teardown()
  })
  return (
    <QueryClientProvider client={query}>
      <WorkspaceQuery origin={props.origin} identity={props.identity} ready={props.ready} failed={props.failed} />
    </QueryClientProvider>
  )
}

function WorkspaceQuery(props: {
  readonly origin: string
  readonly identity: number
  readonly ready: (workspaces: readonly WorkspaceAccessInfo[]) => void
  readonly failed: (error: unknown) => void
}) {
  const api = browserClient()
  const workspace = useQuery(() => ({
    queryKey: [props.origin, props.identity, "workspace"] as const,
    queryFn: () => discoverWorkspace(api),
  }))
  createEffect(() => {
    if (workspace.data) props.ready(workspace.data)
  })
  createEffect(() => {
    if (workspace.error) props.failed(workspace.error)
  })
  return null
}

function writeWorkspace(workspace: string, mode: "push" | "replace") {
  const url = new URL(location.href)
  url.searchParams.set("workspace", workspace)
  if (mode === "push") history.pushState({}, "", url)
  else history.replaceState({}, "", url)
}

function parseWorkspace(value: string | null): WorkspaceAccessInfo["id"] | undefined {
  return value && Schema.is(WorkspaceID)(value) ? value : undefined
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
