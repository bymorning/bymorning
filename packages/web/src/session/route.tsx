import { isSessionNotFoundError, type SessionInfo } from "@bymorning/client"
import { Session } from "@bymorning/schema/session"
import type * as Workspace from "@bymorning/schema/workspace"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { Option, Schema } from "effect"
import { createMemo, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context/data"
import { PromptProvider } from "../context/prompt"
import { useWorkspace } from "../context/workspace"
import { useServer } from "../runtime/server/runtime"
import { Button } from "../ui/components/button"
import { useI18n } from "../ui/context/i18n"
import { errorMessage } from "../utils/error-message"
import { sessionRouteHref } from "../workspace-route-paths"
import { SessionLoading } from "./loading"
import { SessionScreen } from "./screen"
import "./route.css"

/** A keyed route is the sole selected-history lifetime owner. */
export function SessionRoute(): JSX.Element {
  const params = useParams<{ sessionID: string }>()
  const server = useServer()
  const id = createMemo(() => Option.getOrUndefined(Schema.decodeUnknownOption(Session.ID)(params.sessionID)))
  // Keyed remounts must not dispose the newly selected record. Release only when
  // this route leaves the session panel entirely.
  onCleanup(() => {
    const sessionID = id()
    if (sessionID) server.release(sessionID)
  })
  return (
    <div data-component="session-panel-frame">
      <Show keyed when={id()} fallback={<SessionNotFound />}>
        {(sessionID) => <SelectedSession sessionID={sessionID} />}
      </Show>
    </div>
  )
}

/** Shared by well-formed unknown IDs and malformed IDs: neither can ever resolve. */
function SessionNotFound(): JSX.Element {
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const i18n = useI18n()
  return (
    <div data-component="session-not-found" role="alert">
      <p>{i18n.t("ui.session.notFound")}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate(`/w/${workspace.current().id}`, { replace: true })}
      >
        Return to Overview
      </Button>
    </div>
  )
}

function SelectedSession(props: { readonly sessionID: Session.ID }): JSX.Element {
  const server = useServer()
  const data = useData()
  const workspace = useWorkspace()
  const i18n = useI18n()
  const id = props.sessionID
  // The store owns only the selection outcome; the detail remains in shared Data. Selection
  // starts on mount, after any navigation transition has committed: shared Data written
  // while a transition is pending stays invisible to the selection's own async reads.
  const [resolution, setResolution] = createStore<{ state: "loading" | "ready" | "error"; error?: unknown }>({
    state: "loading",
  })
  // Only the latest call may settle the resolution; a slower earlier call must not overwrite a retry.
  let latest = 0
  onCleanup(() => void latest++)
  const resolve = async () => {
    const call = ++latest
    setResolution({ state: "loading", error: undefined })
    try {
      await server.select(id)
      if (call !== latest) return
      data.session.view(id)
      setResolution({ state: "ready" })
    } catch (error) {
      if (call !== latest) return
      setResolution({ state: "error", error })
    }
  }
  onMount(() => void resolve())
  const failure = () => (resolution.state === "error" ? resolution.error : undefined)
  const detail = () => data.session.get(id) ?? (resolution.state === "ready" ? server.data.session.get(id) : undefined)
  return (
    <Switch fallback={<SessionLoading />}>
      <Match when={isSessionNotFoundError(failure())}>
        <SessionNotFound />
      </Match>
      <Match when={failure()}>
        <div data-component="session-load-error" role="alert">
          <p data-slot="session-load-error-title">{i18n.t("ui.session.loadError")}</p>
          <Show when={errorMessage(failure(), "")}>{(detail) => <p>{detail()}</p>}</Show>
          <Button type="button" variant="outline" onClick={() => void resolve()}>
            {i18n.t("ui.common.retry")}
          </Button>
        </div>
      </Match>
      <Match when={detail()}>
        <ResolvedSession
          session={detail()!}
          workspaceID={workspace.current().id}
          sessionHref={(target) => sessionRouteHref(workspace.current().id, target)}
        />
      </Match>
    </Switch>
  )
}

export function createSessionNavigation(input: {
  readonly workspaceID: () => Workspace.ID
  readonly navigate: (sessionID: Session.ID) => void
}) {
  return { open: (target: string) => input.navigate(Session.ID.make(target)) }
}

function ResolvedSession(props: {
  readonly session: SessionInfo
  readonly workspaceID: Workspace.ID
  readonly sessionHref: (sessionID: string) => string
}): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation<{ readonly focusComposer?: boolean } | undefined>()
  // The hint is for the arrival only: consume it so back/forward does not focus the composer again.
  const autofocus = location.state?.focusComposer === true
  onMount(() => {
    if (autofocus)
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: undefined })
  })
  const navigation = createSessionNavigation({
    workspaceID: () => props.workspaceID,
    navigate: (sessionID) => navigate(props.sessionHref(sessionID)),
  })
  return (
    <PromptProvider
      scope={{ workspaceID: props.workspaceID, projectID: props.session.projectID, sessionID: props.session.id }}
    >
      <SessionScreen
        sessionID={props.session.id}
        openSession={navigation.open}
        sessionHref={props.sessionHref}
        autofocus={autofocus}
      />
    </PromptProvider>
  )
}
