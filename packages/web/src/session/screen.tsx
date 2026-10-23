import type { Session } from "@bymorning/schema/session"
import { useScope, useServer } from "../runtime/server/runtime"
import { scopeKey } from "../runtime/server/scope"
import { archiveSession } from "./archive-toast"
import { createArchivedProject, setProjectArchived } from "../project/archive"
import { createLifecycle } from "./lifecycle"
import { errorMessage } from "../utils/error-message"
import { sessionLabel } from "../utils/session-title"
import { createDescendants } from "./descendants"
import { batch, createEffect, createMemo, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { normalizePathname } from "../workspace-route-paths"

import { useCommand } from "../shell/commands/context"
import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { usePrompt } from "../context/prompt"
import { useSettings } from "../context/settings"
import { useSDK } from "../context/sdk"
import { useLayout } from "../shell/state/layout"
import { useWorkspace } from "../context/workspace"
import { useWorkspaceEvent } from "../context/workspace-event"
import { useI18n } from "../ui/context/i18n"
import { createController as createComposer } from "../features/session/composer-controller"
import { createController as createPermission } from "../features/session/permission-controller"
import { createController as createForm } from "../features/session/form-controller"
import { createProjectFileController } from "../features/session/project-file-controller"
import { createSidebarController } from "../features/session/sidebar-controller"
import { SidebarLayout } from "./right-sidebar-layout"
import { RightSidebar } from "./right-sidebar"
import { createController as createSelection } from "../features/session/selection-controller"
import { SessionUIProvider } from "../features/session/session-context"
import { createController as createSession } from "../features/session/session-controller"
import { createController as createTimeline } from "../features/session/timeline-controller"
import { createTimelineInteraction } from "../features/session/timeline/interaction"
import { useSessionHashScroll } from "../features/session/use-session-hash-scroll"
import { presentBackground } from "../features/session/background-presenter"
import { contextUsage } from "../features/session/context-usage"
import { SessionComposerRegion } from "../features/session/ui/session-composer-region"
import { SessionHeader } from "../features/session/ui/session-header"
import { ModelPickerProvider } from "../features/session/ui/session-selection"
import { FileBrowser } from "../features/session/ui/file-browser"
import { SessionTimeline } from "../features/session/ui/session-timeline"
import { Button } from "../ui/components/button"
import "./screen.css"

export function SessionScreen(props: {
  readonly sessionID: Session.ID
  readonly openSession: (sessionID: string) => void
  readonly sessionHref: (sessionID: string) => string
  readonly autofocus?: boolean
}): JSX.Element {
  return (
    <SessionUIProvider sessionID={props.sessionID}>
      <ModelPickerProvider>
        <SessionContent
          sessionID={props.sessionID}
          openSession={props.openSession}
          sessionHref={props.sessionHref}
          autofocus={props.autofocus === true}
        />
      </ModelPickerProvider>
    </SessionUIProvider>
  )
}

function SessionContent(props: {
  readonly sessionID: Session.ID
  readonly openSession: (sessionID: string) => void
  readonly sessionHref: (sessionID: string) => string
  readonly autofocus: boolean
}): JSX.Element {
  let sidebarTrigger!: HTMLButtonElement
  let triggerHeldFocus = false
  const takeTriggerFocus = () => {
    const held = triggerHeldFocus
    triggerHeldFocus = false
    return held
  }
  let workspace!: HTMLDivElement
  const [size, setSize] = createStore<{ width: number | undefined }>({ width: undefined })
  const settings = useSettings()
  const workspaceContext = useWorkspace()
  const events = useWorkspaceEvent()
  const layout = useLayout()
  const commands = useCommand()
  const navigate = useNavigate()
  const location = useLocation()
  const data = useData()
  const { client } = useSDK()
  const server = useServer()
  const prompt = usePrompt()
  const i18n = useI18n()
  const session = createSession()
  const agents = () => data.workspace.agent.list() ?? []
  const topLevel = () => {
    const current = session.data.detail()
    return current.state === "ready" && current.data.parentID === undefined
  }
  const background = createMemo(() => {
    if (!topLevel()) return { blocking: [], active: [] }
    const presentation = presentBackground({
      transcript: session.data.transcript(),
      agents: agents(),
    })
    return presentation
  })
  const timeline = createTimeline({
    data: {
      transcript: session.data.transcript,
      policyNotices: session.data.policyNotices,
      topology: session.data.topology,
      entry: session.data.entry,
      models: session.data.models,
    },
    preferences: {
      showAgent: () => settings.general.showAgent,
      showReasoning: () => settings.general.showReasoningSummaries,
      showUsage: () => settings.general.showSessionUsage,
    },
    history: session.history,
  })
  const timelineInteraction = createTimelineInteraction({ history: timeline.history })
  createEffect(() => {
    if (session.history.windowReplacement() > 0) timelineInteraction.toBottom()
  })
  useSessionHashScroll({
    sessionKey: () => `${workspaceContext.current().id}:${props.sessionID}`,
    sessionID: () => props.sessionID,
    messagesReady: timeline.history.ready,
    visibleUserMessages: () => {
      const model = timeline.model()
      return model.state === "ready"
        ? model.items.flatMap((item) => (item.type === "turn" && item.user ? [item.user] : []))
        : []
    },
    historyMore: timeline.history.more,
    historyLoading: timeline.history.loading,
    loadMore: timeline.history.loadOlder,
    interaction: timelineInteraction,
  })
  const selection = createSelection({
    data: { detail: session.data.detail, agents: session.data.agents, models: session.data.models },
    selection: session.selection,
  })
  const detail = () => {
    const current = session.data.detail()
    return current.state === "ready" ? current.data : undefined
  }
  const info = () => data.session.get(props.sessionID) ?? data.session.detail(props.sessionID) ?? detail()
  // An archived Project is read-only: its Sessions accept no messages until it is restored.
  const archivedProject = createArchivedProject(server, () => info()?.projectID)
  const [projectRestore, setProjectRestore] = createStore<{ pending: boolean; error: unknown }>({
    pending: false,
    error: undefined,
  })
  const restoreProject = async () => {
    const current = archivedProject.project()
    if (!current || projectRestore.pending) return
    setProjectRestore({ pending: true, error: undefined })
    try {
      await setProjectArchived(server, current.id, false)
      setProjectRestore("pending", false)
    } catch (error) {
      setProjectRestore({ pending: false, error })
    }
  }
  const composer = createComposer({
    data: {
      detail: session.data.detail,
      inbox: session.data.inbox,
      transcript: session.data.transcript,
    },
    running: () => data.session.status(props.sessionID) === "running",
    archived: () => info()?.archivedAt !== undefined || archivedProject.project() !== undefined,
    composer: session.composer,
    prompt,
    commands,
    projectDirectory: data.projectDirectory,
    skills: data.workspace.skill.list,
    agents: data.workspace.agent.list,

    selection,
    selectionVisibility: {
      agent: () => settings.general.showAgent,
      variant: () => settings.general.showModelVariant,
    },
    subagents: {
      eligible: topLevel,
      blocking: () => background().blocking.length > 0,
      command: i18n.t("ui.session.background.command"),
      description: i18n.t("ui.session.background.commandDescription"),
      error: i18n.t("ui.session.background.commandError"),
      category: i18n.t("ui.session.background.commandCategory"),
    },
  })
  const descendants = createDescendants({
    client,
    connection: server.connection,
    workspace: workspaceContext.current().id,
    sessionID: () => props.sessionID,
  })
  const permission = createPermission({
    data: { permissions: session.data.permissions, transcript: session.data.transcript },
    permission: session.permission,
    children: {
      sessionID: props.sessionID,
      sessions: () => descendants() ?? [],
      revision: data.session.attentionRevision,
      connected: () => events.status() === "connected",
      list: (signal) => client.permission.request.list({ workspace: workspaceContext.current().id }, { signal }),
    },
  })
  const form = createForm({ data: { forms: session.data.forms }, form: session.form })
  data.projectDirectory.observe(() => {
    const detail = session.data.detail()
    return detail.state === "ready" ? detail.data.projectID : undefined
  })
  const files = createProjectFileController({
    projectID: () => {
      const detail = session.data.detail()
      return detail.state === "ready" ? detail.data.projectID : undefined
    },
    directory: data.projectDirectory,
    active: layout.rightSidebar.opened,
  })
  // Live `project.file.changed` Events keep the listing current, so opening needs no refetch.
  const openFile = (path: string) => {
    batch(() => {
      layout.rightSidebar.open()
      files.select(path)
    })
  }
  createSidebarController({
    subscribe: events.subscribe,
    sessionID: () => props.sessionID,
    apply: (request) => {
      if (!request.open) return layout.rightSidebar.close()
      if (request.path === undefined) return layout.rightSidebar.open()
      openFile(request.path)
    },
  })
  const detailError = () => {
    const state = session.data.detail()
    return state.state === "error" ? state.message : undefined
  }
  const projectFiles = () => {
    const detail = session.data.detail()
    return detail.state === "ready" ? data.projectDirectory.list(detail.data.projectID) : []
  }
  const skills = () => data.workspace.skill.list() ?? []
  const heading = () => {
    const current = info()
    return current ? sessionLabel(current) : i18n.t("ui.session.untitled")
  }
  const project = () => {
    const projectID = info()?.projectID
    return projectID ? (server.data.project.get(projectID) ?? archivedProject.project()) : undefined
  }
  const headerProject = () => {
    const current = project()
    if (!current) return
    const avatar = current.icon?.override?.href ?? current.icon?.url?.href
    return { name: current.name ?? i18n.t("ui.session.untitledProject"), ...(avatar ? { avatar } : {}) }
  }
  const parent = () => {
    const parentID = info()?.parentID
    if (!parentID) return
    const current = data.session.get(parentID)
    return {
      id: parentID,
      title: current ? sessionLabel(current) : i18n.t("ui.session.parent"),
    }
  }
  const usage = createMemo(
    () => {
      const current = detail()
      if (!current?.usage) return
      const transcript = session.data.transcript()
      return contextUsage({
        usage: current.usage,
        model: current.model,
        entries: transcript.state === "ready" ? transcript.data : [],
        models: session.data.models(),
      })
    },
    undefined,
    {
      // Streaming revises the transcript continuously; only a changed indicator should re-render.
      equals: (prev, next) =>
        prev === next ||
        (prev !== undefined &&
          next !== undefined &&
          prev.tokens === next.tokens &&
          prev.cost === next.cost &&
          prev.costComplete === next.costComplete &&
          prev.percentage === next.percentage),
    },
  )
  const dialog = useDialog()
  const lifecycle = createLifecycle({ client, shared: server.data, key: scopeKey(useScope()) })
  const updateSession = async (patch: { readonly title?: string; readonly archived?: boolean }) => {
    if (lifecycle.pending(props.sessionID)) return false
    await lifecycle.update({ sessionID: props.sessionID, ...patch })
    return true
  }
  const rename = (title: string) => updateSession({ title })
  const archive = async () => {
    if (info()?.archivedAt !== undefined) return updateSession({ archived: false })
    if (lifecycle.pending(props.sessionID)) return false
    // The screen unmounts on navigation; the mutation outlives it, so Undo keeps working.
    await archiveSession({
      i18n,
      dialog,
      session: info(),
      sessionID: props.sessionID,
      update: lifecycle.update,
      viewing: () => normalizePathname(location.pathname) === props.sessionHref(props.sessionID),
      leave: () => navigate(`/w/${workspaceContext.current().id}`),
    })
    return true
  }
  commands.register("session.lifecycle", () => [
    {
      id: info()?.archivedAt === undefined ? "session.archive" : "session.unarchive",
      title: i18n.t(info()?.archivedAt === undefined ? "ui.session.archive" : "ui.session.unarchive"),
      category: i18n.t("ui.session.session"),
      onSelect: () => void archive().catch(() => undefined),
    },
  ])
  const sidebarLayout = () => SidebarLayout.resolve(layout.session.width(), size.width)
  const sidebarSize = {
    width: () => sidebarLayout().width,
    min: SidebarLayout.sidebarMin,
    max: () => sidebarLayout().max,
    full: () => size.width ?? sidebarLayout().width,
    resize: (width: number) => {
      const available = size.width
      if (available === undefined) return
      layout.session.resize(available - width - SidebarLayout.inlineMargin)
    },
    reset: () => layout.session.resize(SidebarLayout.sessionDefault),
  }

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize("width", entry.contentRect.width)
    })
    observer.observe(workspace)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div
      ref={(element) => (workspace = element)}
      data-component="session-workspace"
      data-session-sync={data.session.state().state}
      data-transcript-state={session.data.transcript().state}
      data-right-sidebar-open={layout.rightSidebar.opened() ? "" : undefined}
    >
      <section data-slot="session-workspace-page">
        <div data-slot="session-workspace-detail">
          <Switch>
            <Match when={session.data.detail().state === "error"}>
              <div data-slot="session-workspace-error" role="alert">
                {detailError()}
              </div>
            </Match>
            <Match when={session.data.detail().state === "ready"}>
              <></>
            </Match>
          </Switch>
        </div>
        <SessionTimeline
          model={timeline.model()}
          sessionKey={`${workspaceContext.current().id}:${props.sessionID}`}
          interaction={timelineInteraction}
          projectFiles={projectFiles()}
          skills={skills()}
          agents={agents().map((agent) => ({
            id: agent.id,
            name: agent.name,
            ...(agent.color ? { color: agent.color } : {}),
          }))}
          subagentNavigation={{ parentID: props.sessionID, sessions: data.session.list() }}
          onFileOpen={openFile}
          actions={{
            sessionHref: props.sessionHref,
            openSession: props.openSession,
            sessionStatus: (sessionID) => data.session.status(sessionID as Session.ID),
          }}
          preferences={{
            showAgent: settings.general.showAgent,
            showReasoning: settings.general.showReasoningSummaries,
            showUsage: settings.general.showSessionUsage,
          }}
          renderMarkdown={settings.general.renderMarkdown}
          header={
            <SessionHeader
              title={heading()}
              workspace={workspaceContext.current().name}
              {...(headerProject() ? { project: headerProject()! } : {})}
              {...(parent()
                ? {
                    parent: {
                      title: parent()!.title,
                      href: props.sessionHref(parent()!.id),
                      navigate: () => props.openSession(parent()!.id),
                    },
                  }
                : {})}
              status={data.session.status(props.sessionID)}
              {...(usage() ? { usage: usage()! } : {})}
              {...(topLevel() && background().active.length > 0
                ? {
                    backgroundTasks: background().active,
                    sessionHref: props.sessionHref,
                    openSession: props.openSession,
                  }
                : {})}
              rename={rename}
              archived={info()?.archivedAt !== undefined}
              archive={archive}
              sidebarOpen={layout.rightSidebar.opened()}
              sidebarRef={(element) => (sidebarTrigger = element)}
              toggleSidebar={() => {
                // The toggle hides itself while the panel is open, which drops focus; note it before that happens.
                triggerHeldFocus = document.activeElement === sidebarTrigger
                layout.rightSidebar.toggle()
              }}
            />
          }
        />
        <div
          ref={(element) => timelineInteraction.setComposerRef(element)}
          data-slot="session-workspace-composer"
          data-toast-clearance
        >
          <div data-slot="session-workspace-composer-content">
            <Show when={archivedProject.project()}>
              <div data-slot="session-workspace-archived" data-kind="project" role="status">
                <span>This project is archived</span>
                <Button
                  size="small"
                  variant="neutral"
                  disabled={projectRestore.pending}
                  onClick={() => void restoreProject()}
                >
                  Restore project
                </Button>
              </div>
            </Show>
            <Show when={projectRestore.error}>
              {(error) => <p role="alert">{errorMessage(error(), "Could not restore project")}</p>}
            </Show>
            <Show when={info()?.archivedAt !== undefined && archivedProject.project() === undefined}>
              <div data-slot="session-workspace-archived" role="status">
                <span>{i18n.t("ui.session.archivedNotice")}</span>
                <Button
                  size="small"
                  variant="neutral"
                  disabled={lifecycle.pending(props.sessionID)}
                  onClick={() => void updateSession({ archived: false })}
                >
                  {i18n.t("ui.session.unarchive")}
                </Button>
              </div>
            </Show>
            <Show when={lifecycle.error(props.sessionID)}>
              {(error) => <p role="alert">{errorMessage(error(), "Could not update session")}</p>}
            </Show>
            <Show when={prompt.ready()} fallback={<p role="status">{i18n.t("ui.session.loadingPrompt")}</p>}>
              <SessionComposerRegion
                composer={composer}
                permission={permission}
                form={form}
                autofocus={props.autofocus}
              />
            </Show>
          </div>
        </div>
      </section>
      <FileBrowser
        open={layout.rightSidebar.opened()}
        model={files}
        tree={layout.rightSidebar.tree()}
        onTreeChange={layout.rightSidebar.showTree}
      >
        {(browser) => (
          <RightSidebar
            open={layout.rightSidebar.opened()}
            size={sidebarSize}
            close={layout.rightSidebar.close}
            restoreFocus={() => sidebarTrigger.focus({ preventScroll: true })}
            focusOnOpen={takeTriggerFocus}
            header={browser.actions}
          >
            {browser.content}
          </RightSidebar>
        )}
      </FileBrowser>
    </div>
  )
}
