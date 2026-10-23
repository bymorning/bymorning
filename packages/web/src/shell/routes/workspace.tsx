import { isUnauthorizedError } from "@bymorning/client"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import {
  createContext,
  createEffect,
  createMemo,
  Match,
  onCleanup,
  useContext,
  on,
  untrack,
  Show,
  Switch,
  type JSX,
  type ParentProps,
} from "solid-js"
import { QueryClientProvider, useQuery } from "@tanstack/solid-query"
import { createQuery } from "../../runtime/server/query"
import { ServerProvider } from "../../runtime/server/runtime"
import { workspaceQuery } from "../../runtime/workspace"

import { NotFoundState } from "../../not-found/route"
import { EmptyShell } from "../empty-shell"
import { useCommand } from "../commands/context"
import { useSDK } from "../../context/sdk"
import { AccountProvider } from "../../context/account"
import { useWorkspaceInventory, WorkspaceInventoryScope, WorkspaceScope } from "../../context/workspace"
import { createHomeCommands } from "../commands/registry/home"
import { createWorkspaceCommands } from "../commands/registry/workspace"
import { SessionGate, SessionGateProvider, useSessionGate } from "../session-gate"

const identityContext = createContext<string>()

export function WorkspaceProvider(props: ParentProps): JSX.Element {
  // This route lifetime ends on logout/login, even when the SDK instance survives.
  const identity = crypto.randomUUID()
  const client = createQuery()
  onCleanup(() => {
    void client.cancelQueries().finally(() => client.clear())
  })
  return (
    <identityContext.Provider value={identity}>
      <QueryClientProvider client={client}>
        <SessionGateProvider>
          <SessionGate>
            <WorkspaceDiscovery>{props.children}</WorkspaceDiscovery>
          </SessionGate>
        </SessionGateProvider>
      </QueryClientProvider>
    </identityContext.Provider>
  )
}

function WorkspaceDiscovery(props: ParentProps): JSX.Element {
  const sdk = useSDK()
  const navigate = useNavigate()
  const location = useLocation()
  const identity = useContext(identityContext)!
  const gate = useSessionGate()
  const list = useQuery(() => workspaceQuery({ origin: sdk.baseURL, identity, api: sdk.client }))
  const unauthorized = () =>
    isUnauthorizedError(list.error) || (list.error instanceof Error && isUnauthorizedError(list.error.cause))

  createEffect(
    on(
      // `list.state` (not `list()`) is the tracked dep: reading an errored resource's value throws.
      () => [unauthorized(), location.pathname, list.error, list.status] as const,
      ([isUnauthorized, pathname, error]) => {
        // Once the session gate has taken the screen, it owns the sign-in affordance.
        if (gate.ended() !== undefined) return
        if (isUnauthorized) return navigate("/login", { replace: true })
        if (error || pathname !== "/") return
        const workspace = untrack(() => list.data)?.[0]
        if (workspace) navigate(`/w/${workspace.id}`, { replace: true })
      },
    ),
  )

  return (
    <AccountProvider>
      <Switch>
        <Match when={list.isError && !unauthorized()}>
          <div role="alert">
            Unable to load workspaces. <button onClick={() => void list.refetch()}>Retry</button>
          </div>
        </Match>
        <Match when={list.isPending}>
          <EmptyShell />
        </Match>
      </Switch>
      <WorkspaceInventoryScope list={() => list.data ?? []} ready={() => !list.isPending && !list.isError}>
        {props.children}
      </WorkspaceInventoryScope>
    </AccountProvider>
  )
}

export function WorkspaceRoute(props: ParentProps): JSX.Element {
  const sdk = useSDK()
  const identity = useContext(identityContext)!
  const inventory = useWorkspaceInventory()
  const params = useParams<{ workspaceID: string }>()
  const current = createMemo(() => inventory.list().find((workspace) => workspace.id === params.workspaceID))
  const command = useCommand()
  // Optional: isolated route tests mount WorkspaceRoute without the gate provider.
  const gate = useSessionGate.optional()
  const currentID = () => current()?.id
  const defaultHref = () => {
    const first = inventory.list()[0]
    return first ? `/w/${first.id}` : "/"
  }
  const home = createHomeCommands(currentID)
  const workspace = createWorkspaceCommands(inventory.list, currentID)
  command.register("workspace", () => [...home(), ...workspace()])
  // A resolved Workspace on screen means the session is live; from here on a
  // 401 is a session that ended mid-flight, and inactivity starts the lock.
  createEffect(() => {
    if (currentID() !== undefined) gate?.arm()
  })

  return (
    <Show
      when={currentID()}
      keyed
      fallback={
        <Show when={inventory.ready()}>
          <NotFoundState
            title="Workspace unavailable"
            description="This workspace does not exist or you do not have access to it."
            href={defaultHref()}
            action="Go to your workspace"
          />
        </Show>
      }
    >
      {(workspaceID) => {
        const workspace = inventory.list().find((candidate) => candidate.id === workspaceID)
        if (!workspace) return null
        return (
          <WorkspaceScope list={inventory.list()} current={workspace}>
            <ServerProvider scope={{ origin: sdk.baseURL, identity, workspace: workspaceID, api: sdk.client }}>
              {props.children}
            </ServerProvider>
          </WorkspaceScope>
        )
      }}
    </Show>
  )
}
