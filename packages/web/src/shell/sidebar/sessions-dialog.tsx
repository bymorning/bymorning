import type { ByMorningClient } from "@bymorning/client"
import { For, Match, Show, Switch, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSDK } from "../../context/sdk"
import { Button } from "../../ui/components/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "../../ui/components/dialog"
import { showToast } from "../../ui/components/toast"
import { errorMessage } from "../../utils/error-message"
import "./sessions-dialog.css"

type AccountClient = ByMorningClient["account"]
export type SessionInfo = Awaited<ReturnType<AccountClient["session"]["list"]>>[number]
export type GrantInfo = Awaited<ReturnType<AccountClient["grant"]["list"]>>[number]

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly sessions: ReadonlyArray<SessionInfo>
  readonly grants: ReadonlyArray<GrantInfo>
  /** The session or grant id currently being revoked. */
  readonly pending: string | undefined
}

const instant = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  )

/** Self-service Login Session and OAuth grant review ("Login sessions"). */
export function SessionsDialog(props: { readonly client?: AccountClient }): JSX.Element {
  const sdk = useSDK()
  const client = props.client ?? sdk.client.account
  const [state, setState] = createStore<State>({ phase: "loading", sessions: [], grants: [], pending: undefined })

  const refresh = async () => {
    setState({ phase: "loading" })
    try {
      const [sessions, grants] = await Promise.all([client.session.list(), client.grant.list()])
      setState({ phase: "ready", sessions, grants })
    } catch (cause) {
      setState({ phase: "error" })
      showToast({ variant: "error", title: errorMessage(cause, "Could not load your login sessions.") })
    }
  }
  onMount(() => void refresh())

  const revokeSession = async (session: SessionInfo) => {
    setState({ pending: session.id })
    try {
      await client.session.revoke({ sessionID: session.id })
      if (session.current) {
        // The just-revoked session is this one; sign-in starts fresh.
        window.location.assign("/login")
        return
      }
      setState({ pending: undefined, sessions: state.sessions.filter((item) => item.id !== session.id) })
      showToast({ variant: "success", title: "Session revoked" })
    } catch (cause) {
      setState({ pending: undefined })
      showToast({ variant: "error", title: errorMessage(cause, "Could not revoke that session.") })
    }
  }

  const revokeGrant = async (grant: GrantInfo) => {
    setState({ pending: grant.id })
    try {
      await client.grant.revoke({ grantID: grant.id })
      setState({ pending: undefined, grants: state.grants.filter((item) => item.id !== grant.id) })
      showToast({ variant: "success", title: `Disconnected ${grant.clientName}` })
    } catch (cause) {
      setState({ pending: undefined })
      showToast({ variant: "error", title: errorMessage(cause, "Could not revoke that application.") })
    }
  }

  return (
    <Dialog variant="card" fit data-component="sessions-dialog" aria-label="Login sessions">
      <DialogHeader>
        <DialogTitle>Login sessions</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Switch>
          <Match when={state.phase === "loading"}>
            <p role="status" data-slot="sessions-status">
              Loading login sessions…
            </p>
          </Match>
          <Match when={state.phase === "error"}>
            <Button type="button" variant="ghost" onClick={() => void refresh()}>
              Try again
            </Button>
          </Match>
          <Match when={state.phase === "ready"}>
            <section data-slot="sessions-section" aria-label="Signed-in sessions">
              <Show when={state.sessions.length > 0} fallback={<p data-slot="sessions-empty">No active sessions.</p>}>
                <ul data-slot="session-list">
                  <For each={state.sessions}>
                    {(session) => (
                      <li data-slot="session-item" data-current={session.current || undefined}>
                        <div data-slot="session-item-text">
                          <span data-slot="session-item-title">
                            {session.current ? "This session" : `Signed in ${instant(session.createdAt)}`}
                          </span>
                          <span data-slot="session-item-detail">
                            {session.current
                              ? `Last active ${instant(session.activeAt)}`
                              : `Last active ${instant(session.activeAt)} · Expires ${instant(session.expiresAt)}`}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={state.pending !== undefined}
                          onClick={() => void revokeSession(session)}
                        >
                          {session.current ? "Sign out" : "Revoke"}
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
            <section data-slot="sessions-section" aria-label="Connected applications">
              <h2 data-slot="sessions-heading">Connected applications</h2>
              <Show
                when={state.grants.length > 0}
                fallback={<p data-slot="sessions-empty">No applications are connected to your account.</p>}
              >
                <ul data-slot="grant-list">
                  <For each={state.grants}>
                    {(grant) => (
                      <li data-slot="grant-item">
                        <div data-slot="session-item-text">
                          <span data-slot="session-item-title">{grant.clientName}</span>
                          <span data-slot="session-item-detail">
                            {`Connected ${instant(grant.createdAt)} · Access expires ${instant(grant.expiresAt)}`}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={state.pending !== undefined}
                          onClick={() => void revokeGrant(grant)}
                        >
                          Revoke
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </Match>
        </Switch>
      </DialogBody>
    </Dialog>
  )
}
