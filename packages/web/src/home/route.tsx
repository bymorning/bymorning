import { Show, type JSX } from "solid-js"

import { useCommand } from "../shell/commands/context"
import { Checklist } from "../getting-started/checklist"
import { createGettingStarted } from "../getting-started/model"
import { MissedRunNotice } from "../scheduled-task/missed-notice"
import { HomeLayout } from "./layout"
import { HomeSessionsRegion } from "./sessions/region"
import { useSessionList } from "../project/session-list"
import { createSessionListScrollController } from "../features/session-list/session-list-scroll-controller"
import { createSessionListSearchController } from "../features/session-list/session-list-search-controller"
import { Button } from "../ui/components/button"

export function HomeRoute(): JSX.Element {
  const sessions = useSessionList()
  const gettingStarted = createGettingStarted()
  const search = createSessionListSearchController({
    items: sessions.data.searchItems,
    placeholder: sessions.copy.searchPlaceholder,
    noResultsLabel: sessions.copy.searchNoResults,
    loading: sessions.data.loading,
    openSession: sessions.session.open,
  })
  const scroll = createSessionListScrollController(sessions.data.groups)
  const command = useCommand()

  command.register("home.search", () => [
    {
      id: "home.sessions.search.focus",
      title: sessions.copy.searchPlaceholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: search.query.focus,
    },
  ])

  // Until the Workspace has a Session the checklist is the whole Overview; the empty list adds nothing.
  const sessionsHidden = () =>
    gettingStarted.visible() && !sessions.data.archived() && sessions.data.groups().length === 0

  return (
    <HomeLayout
      title="Overview"
      description="Find and continue sessions across this workspace."
      actions={
        <Button
          data-action="home-new-session"
          variant="primary"
          icon="central-plus-small"
          disabled={!sessions.session.canCreate()}
          title={sessions.session.createDisabled()}
          aria-description={sessions.session.createDisabled()}
          onClick={sessions.session.create}
        >
          {sessions.copy.language.t("command.session.new")}
        </Button>
      }
      scroll={scroll}
      before={
        <>
          <MissedRunNotice />
          <Show when={gettingStarted.visible()}>
            <Checklist model={gettingStarted} />
          </Show>
        </>
      }
      mainHidden={sessionsHidden()}
      main={<HomeSessionsRegion sessions={sessions} search={search} scroll={scroll} />}
    />
  )
}
