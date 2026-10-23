import { Show } from "solid-js"

import { SessionList } from "../../features/session-list/session-list"
import type { SessionListScrollController } from "../../features/session-list/session-list-scroll-controller"
import { SessionListSearch } from "../../features/session-list/session-list-search"
import type { SessionListSearchController } from "../../features/session-list/session-list-search-controller"
import type { SessionListController } from "../../project/session-list"
import { Button } from "../../ui/components/button"
import { errorMessage } from "../../utils/error-message"
import "./region.css"

export function HomeSessionsRegion(props: {
  readonly sessions: SessionListController
  readonly search: SessionListSearchController
  readonly scroll: SessionListScrollController
}) {
  return (
    <nav
      data-component="home-sessions"
      aria-label={
        props.sessions.data.archived() ? props.sessions.copy.language.t("home.sessions.archived") : "Sessions"
      }
      aria-busy={props.sessions.data.loading()}
    >
      <Show when={!props.sessions.data.archived()}>
        <div data-slot="home-sessions-header" onWheel={props.scroll.viewport.containWheel}>
          <SessionListSearch
            controller={props.search}
            scope={props.sessions.data.scope()}
            status={props.sessions.session.status}
            statusLabel={props.sessions.copy.statusLabel}
            sessionsLabel={props.sessions.copy.language.t("home.sessions.search.sessions")}
            loadingLabel={props.sessions.copy.language.t("common.loading")}
            href={props.sessions.session.href}
          />
        </div>
      </Show>
      <SessionList
        groups={props.sessions.data.groups()}
        loading={props.sessions.data.loading()}
        loadingLabel={props.sessions.copy.language.t("common.loading")}
        scope={props.sessions.data.scope()}
        hidden={!props.sessions.data.archived() && props.search.query.open()}
        status={props.sessions.session.status}
        statusLabel={props.sessions.copy.statusLabel}
        href={props.sessions.session.href}
        onOpen={props.sessions.session.open}
        archive={{
          archived: props.sessions.data.archived(),
          pending: props.sessions.session.pending,
          error: (sessionID) => {
            const error = props.sessions.session.error(sessionID)
            return error === undefined ? undefined : errorMessage(error, "Could not update session")
          },
          onSelect: (sessionID) => {
            // Native ledger errors are rendered on the owning row.
            void props.sessions.session.archive(sessionID, !props.sessions.data.archived()).catch(() => undefined)
          },
        }}
        scroll={props.scroll}
        empty={
          <HomeSessionsEmpty
            archived={props.sessions.data.archived()}
            canCreate={props.sessions.session.canCreate()}
            createMessage={props.sessions.session.createMessage()}
            language={props.sessions.copy.language}
            onCreate={props.sessions.session.create}
          />
        }
      />
    </nav>
  )
}

function HomeSessionsEmpty(props: {
  readonly archived: boolean
  readonly canCreate: boolean
  readonly createMessage: string | undefined
  readonly language: SessionListController["copy"]["language"]
  readonly onCreate: () => void
}) {
  return (
    <div data-component="home-sessions-empty">
      <strong>{props.language.t(props.archived ? "home.sessions.archived.empty" : "home.sessions.empty")}</strong>
      <p>
        {props.language.t(
          props.archived ? "home.sessions.archived.empty.description" : "home.sessions.empty.description",
        )}
      </p>
      <Show when={!props.archived && props.createMessage}>
        <p role="status">{props.createMessage}</p>
      </Show>
      <Show when={!props.archived && props.canCreate}>
        <Button data-action="home-new-session" icon="edit" onClick={props.onCreate}>
          {props.language.t("command.session.new")}
        </Button>
      </Show>
    </div>
  )
}
