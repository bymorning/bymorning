import type { SessionID } from "@bymorning/client/solid"
import type { ID as ProjectID } from "@bymorning/schema/project"
import { SessionHeader, SessionProvider, type SessionUI } from "@bymorning/session-ui"
import { useMutation } from "@tanstack/solid-query"
import { Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useScope, useServer } from "@/runtime/server/runtime.js"
import { FileProvider } from "@/workspaces/files/model.js"
import { Composer } from "./composer/composer.js"
import { FileBrowser } from "./files/session-file-browser-tab.js"
import { SessionRequestPanel } from "./requests/session-request-panel.js"
import { Timeline } from "./timeline/timeline.js"
import "./session.css"

export function Session(props: { sessionID: Accessor<SessionID>; projectID: Accessor<ProjectID | undefined> }) {
  const server = useServer()
  const scope = useScope()
  const [state, setState] = createStore({ tab: "conversation" as "conversation" | "files" })
  const switchAgent = useMutation(() => ({
    mutationFn: (input: {
      readonly sessionID: SessionID
      readonly agent: Parameters<typeof server.data.session.switchAgent>[0]["agent"]
    }) => server.data.session.switchAgent(input),
  }))
  const switchModel = useMutation(() => ({
    mutationFn: (input: {
      readonly sessionID: SessionID
      readonly model: Parameters<typeof server.data.session.switchModel>[0]["model"]
    }) => server.data.session.switchModel(input),
  }))
  const switching = () => switchAgent.isPending || switchModel.isPending
  const switchError = () => switchAgent.error ?? switchModel.error
  const agent: SessionUI.Select = {
    value: () => server.data.session.get(props.sessionID())?.agent,
    choices: server.data.agent.list().map((item) => ({ key: item.id, label: item.name })),
    action: {
      pending: () => switchAgent.isPending,
      error: () => (switchAgent.error ? describe(switchAgent.error) : undefined),
      run: (value) => {
        const selected = server.data.agent.list().find((item) => item.id === value)
        if (selected && !switching()) switchAgent.mutate({ sessionID: props.sessionID(), agent: selected.id })
      },
    },
  }
  const model: SessionUI.Select = {
    value: () => {
      const selected = server.data.session.get(props.sessionID())?.model
      return selected ? `${selected.provider}:${selected.id}` : undefined
    },
    choices: server.data.model
      .list()
      .map((item) => ({ key: `${item.info.provider}:${item.info.id}`, label: item.info.name })),
    action: {
      pending: () => switchModel.isPending,
      error: () => (switchModel.error ? describe(switchModel.error) : undefined),
      run: (value) => {
        const selected = server.data.model.list().find((item) => `${item.info.provider}:${item.info.id}` === value)
        if (selected && !switching())
          switchModel.mutate({
            sessionID: props.sessionID(),
            model: { provider: selected.info.provider, id: selected.info.id },
          })
      },
    },
  }
  return (
    <SessionProvider>
      <SessionHeader
        model={{
          title: () => server.data.session.get(props.sessionID())?.title ?? "Conversation",
          status: () => server.data.session.active.get(props.sessionID()),
          identity: () => {
            const projectID = props.projectID()
            return {
              workspace: scope.workspace,
              project: projectID ? { name: server.data.project.get(projectID)?.name ?? "Project" } : undefined,
            }
          },
        }}
      />
      <Show when={switchError()}>
        <p role="alert">
          {describe(switchError())}
        </p>
      </Show>
      <div data-component="session-tabs" role="tablist" aria-label="Session content">
        <button role="tab" aria-selected={state.tab === "conversation"} onClick={() => setState("tab", "conversation")}>
          Conversation
        </button>
        <button role="tab" aria-selected={state.tab === "files"} onClick={() => setState("tab", "files")}>
          Files
        </button>
      </div>
      <Show when={state.tab === "conversation"}>
        <Timeline sessionID={props.sessionID} />
        <SessionRequestPanel sessionID={props.sessionID} />
        <Composer sessionID={props.sessionID} disabled={switching()} agents={agent} models={model} />
      </Show>
      <Show when={state.tab === "files"}>
        <FileProvider scope={() => scope} projectID={props.projectID} connected={server.queryReady}>
          <FileBrowser />
        </FileProvider>
      </Show>
    </SessionProvider>
  )
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
