import { For, Show } from "solid-js"
import { useServer } from "@/runtime/server/runtime.js"
import { errorText } from "@/runtime/error.js"
import "./navigation.css"

export function SessionNavigation(props: {
  model: ReturnType<typeof import("./model.js").useSessions>
  onNavigate?: () => void
}) {
  const server = useServer()
  const model = props.model
  return (
    <aside aria-label="Sessions" data-component="navigation">
      <h2 data-slot="title">Projects</h2>
      <div data-slot="new-row">
        <input
          aria-label="Project name"
          placeholder="New project"
          value={model.state.createName}
          onInput={(event) => model.setState("createName", event.currentTarget.value)}
        />
        <button onClick={model.addProject} disabled={model.createProject.isPending}>
          Add
        </button>
      </div>
      <Show when={model.createProject.error}>
        <p role="alert">
          {errorText(model.createProject.error)}
        </p>
      </Show>
      <For each={server.data.project.list()}>
        {(project) => (
          <button
            data-slot="item"
            data-selected={model.state.project === project.id ? "" : undefined}
            onClick={() => {
              model.selectProject(project.id)
              props.onNavigate?.()
            }}
          >
            {project.name}
          </button>
        )}
      </For>
      <h2 data-slot="title">Sessions</h2>
      <button
        class="button"
        data-slot="item"
        data-variant="button"
        onClick={model.create}
        disabled={server.state.boot !== "ready" || model.createSession.isPending}
      >
        Create session
      </button>
      <Loading />
      <Show when={model.createSession.error}>
        <p role="alert">
          {errorText(model.createSession.error)}
        </p>
      </Show>
      <nav data-slot="list">
        <For each={server.data.session.list()}>
          {(session) => (
            <button
              data-slot="item"
              data-selected={model.state.session === session.id ? "" : undefined}
              onClick={() => {
                model.select(session.id)
                props.onNavigate?.()
              }}
            >
              {session.title || "Untitled session"}
            </button>
          )}
        </For>
      </nav>
      <Show when={server.data.session.more()}>
        <button data-slot="item" onClick={() => void server.data.session.load()} disabled={server.data.session.loading()}>
          Load more sessions
        </button>
      </Show>
    </aside>
  )
}

function Loading() {
  const server = useServer()
  return (
    <Show when={server.state.boot === "loading" || server.data.session.loading() || server.state.error}>
      <p data-slot="note" role="status">
        {server.state.error ? `Error: ${errorText(server.state.error)}` : "Loading…"}
      </p>
    </Show>
  )
}
