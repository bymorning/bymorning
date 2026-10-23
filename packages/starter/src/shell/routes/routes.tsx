import type { WorkspaceAccessInfo } from "@bymorning/client"
import { For, Match, Switch, type JSX } from "solid-js"
import { HomeRoute } from "@/home/route.js"
import { browserClient, loginURL } from "@/runtime/auth.js"
import { ServerProvider, useServer } from "@/runtime/server/runtime.js"
import { createScope } from "@/runtime/server/scope.js"
import { useWorkspace } from "@/runtime/workspace.js"
import { LayoutProvider } from "../state/layout.js"
import { Shell } from "../shell.js"
import "./status.css"

export function Routes() {
  const workspace = useWorkspace()
  return (
    <LayoutProvider>
      <Shell>
        <Switch>
          <Match when={workspace.state.boot === "loading"}>
            <Status title="Loading workspace" text="Checking your signed-in session…" />
          </Match>
          <Match when={workspace.state.boot === "login"}>
            <Status
              title="Sign in required"
              text="Use the installation’s public login before opening a workspace."
              action={
                <a class="button" href={loginURL()}>
                  Continue to sign in
                </a>
              }
            />
          </Match>
          <Match when={workspace.state.boot === "error"}>
            <Status
              title="Could not load workspaces"
              text={workspace.state.error ?? "Unknown error"}
              action={<button onClick={workspace.retry}>Try again</button>}
            />
          </Match>
          <Match when={workspace.state.boot === "ready" && !workspace.state.workspace}>
            <Status title="No workspace available" text="This account has no active workspace." />
          </Match>
          <Match when={workspace.state.boot === "ready" && workspace.state.workspace}>
            <For each={[`${workspace.origin}:${workspace.state.identity}:${workspace.state.workspace}`]}>
              {() => (
                <ClientScope
                  origin={workspace.origin}
                  identity={workspace.state.identity}
                  workspace={workspace.state.workspace!}
                />
              )}
            </For>
          </Match>
        </Switch>
      </Shell>
    </LayoutProvider>
  )
}

function ClientScope(props: { origin: string; identity: number; workspace: WorkspaceAccessInfo["id"] }) {
  const scope = createScope({
    api: browserClient(),
    origin: props.origin,
    identity: props.identity,
    workspace: props.workspace,
  })
  return (
    <ServerProvider scope={scope}>
      <Boot />
    </ServerProvider>
  )
}

function Boot() {
  const server = useServer()
  // Runtime state owns bootstrap errors and the route renders its recovery action.
  void server.bootstrap().catch(() => undefined)
  return <HomeRoute />
}

function Status(props: { title: string; text: string; action?: JSX.Element }) {
  return (
    <section data-component="status">
      <h1>{props.title}</h1>
      <p>{props.text}</p>
      {props.action}
    </section>
  )
}
