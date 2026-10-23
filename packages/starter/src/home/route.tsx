import { Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { Session } from "@/session/session.js"
import { useServer } from "@/runtime/server/runtime.js"
import { useLayout } from "@/shell/state/layout.js"
import { SessionNavigation } from "./sessions/view.js"
import { useSessions } from "./sessions/model.js"
import "./route.css"

export function HomeRoute() {
  const sessions = useSessions()
  const layout = useLayout()
  onCleanup(layout.close)
  return (
    <>
      <Show when={layout.navigation()}>
        {(mount) => (
          <Portal mount={mount()}>
            <SessionNavigation model={sessions} onNavigate={layout.close} />
          </Portal>
        )}
      </Show>
      <section data-component="conversation">
        <Connection />
        <Show
          keyed
          when={sessions.state.session}
          fallback={
            <section data-component="empty">
              <h1>Choose a session</h1>
              <p>Create a session to start a conversation.</p>
            </section>
          }
        >
          {(sessionID) => <Session sessionID={() => sessionID} projectID={() => sessions.state.project} />}
        </Show>
      </section>
    </>
  )
}

function Connection() {
  const server = useServer()
  return (
    <Show when={server.connection.state().state !== "connected"}>
      <div data-component="connection" role="status">
        Stream: {server.connection.state().state} <button onClick={server.connection.retry}>Retry</button>
      </div>
    </Show>
  )
}
