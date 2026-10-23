import type { ShareView } from "@bymorning/client"
import { Match, Switch, type JSX } from "solid-js"

import type { TranscriptEntry, TranscriptMessage } from "../context/session-state"
import { parseTimeline } from "../features/session/session-presenter"
import { SessionHeader } from "../features/session/ui/session-header"
import { SessionTimeline } from "../features/session/ui/session-timeline"
import "../session/screen.css"
import "../shell/shell.css"
import "./page.css"

const preferences = { showAgent: true, showReasoning: true, showUsage: true }

/** Project a public Share view onto the Session transcript timeline. */
export function transcriptEntries(messages: ShareView["messages"]): TranscriptEntry[] {
  return messages.map((message) => ({
    message: message as TranscriptMessage,
    parts: {},
    origin: "server" as const,
    revision: 1,
  }))
}

/** Read-only Session workspace for a public Share grant. */
export function SharePage(props: {
  readonly status: "loading" | "ready" | "notFound" | "invalid" | "error"
  readonly title?: string
  readonly messages?: ShareView["messages"]
  readonly error?: string
}): JSX.Element {
  const alert = () => {
    if (props.status === "invalid") return "This share link is not valid. Check the URL and try again."
    if (props.status === "notFound") return "This link no longer points to a shared conversation."
    if (props.status === "error") return props.error ?? "Share is unavailable."
  }
  const timeline = () =>
    parseTimeline({
      transcript: { state: "ready", data: transcriptEntries(props.messages ?? []), loadingOlder: false },
      models: [],
      preferences,
    })
  return (
    <div data-component="shell" data-layout="contained" data-share-page="">
      <div data-slot="shell-body">
        <main data-slot="shell-content" tabIndex={-1}>
          <div data-slot="shell-route-content">
            <Switch>
              <Match when={alert()}>
                {(message) => (
                  <p data-slot="session-timeline-error" role="alert">
                    {message()}
                  </p>
                )}
              </Match>
              <Match when={props.status === "loading"}>
                <p data-slot="share-loading" role="status">
                  Loading…
                </p>
              </Match>
              <Match when={props.status === "ready"}>
                <div data-component="session-workspace" data-share="">
                  <section data-slot="session-workspace-page">
                    <SessionTimeline
                      model={timeline()}
                      projectFiles={[]}
                      preferences={preferences}
                      onFileOpen={() => undefined}
                      header={
                        <SessionHeader
                          title={props.title ?? "Shared conversation"}
                          workspace="Shared"
                          sidebarOpen
                          sidebarRef={() => undefined}
                          toggleSidebar={() => undefined}
                        />
                      }
                    />
                  </section>
                </div>
              </Match>
            </Switch>
          </div>
        </main>
      </div>
    </div>
  )
}
