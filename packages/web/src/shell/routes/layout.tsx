import { Option, Schema } from "effect"
import type { ParentProps } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { useScope, useServer } from "../../runtime/server/runtime"
import { createDocumentTitle } from "../document-title"
import { scopeKey, type ServerScope } from "../../runtime/server/scope"

import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { DataProvider, useData } from "../../context/data"
import { SessionSync } from "../../runtime/session-sync/sync"
import { IntegrationProvider } from "../../context/integration"
import { WorkspaceEventProvider } from "../../context/workspace-event"
import { InstallationProvider } from "../../installation/model"
import { ProjectProvider, useProject } from "../../project/model"
import { SessionListProvider } from "../../project/session-list"
import { ProjectSidebarRegion } from "../../project/sidebar/region"
import { SidebarProjectsRegion } from "../../project/sidebar/projects-region"
import { useCommand } from "../commands/context"
import Shell from "../shell"
import { LayoutProvider } from "../state/layout"
import { AccountMenu } from "../sidebar/account-menu"
import { SessionsDialog } from "../sidebar/sessions-dialog"
import { useDialog } from "../../context/dialog"
import { useWorkspace } from "../../context/workspace"
import { useAccount } from "../../context/account"
import { useTheme } from "../../ui/theme"
import { consoleSidebar, workspaceSidebarRoutes } from "../../project/sidebar/navigation"
import { normalizePathname, workspaceRouteHref, WorkspaceRoutePath } from "../../workspace-route-paths"
import { BootstrapGate } from "./bootstrap"

/** Mount one resolved Workspace's application resources and visual shell. */
export function AppLayout(props: ParentProps) {
  return (
    <WorkspaceEventProvider>
      <IntegrationProvider>
        <DataProvider>
          <SessionSync />
          <BootstrapGate>
            <InstallationProvider>
              <LayoutProvider>
                <ProjectProvider>
                  <SessionListProvider>
                    <ProjectShell>{props.children}</ProjectShell>
                  </SessionListProvider>
                </ProjectProvider>
              </LayoutProvider>
            </InstallationProvider>
          </BootstrapGate>
        </DataProvider>
      </IntegrationProvider>
    </WorkspaceEventProvider>
  )
}

function ProjectShell(props: ParentProps) {
  const account = useAccount()
  const controller = useProject()
  const command = useCommand()
  const workspace = useWorkspace()
  const scope = useScope()
  const dialog = useDialog()
  const logout = useMutation(() => ({
    mutationKey: [...scopeKey(scope), "logout"],
    retry: false,
    mutationFn: (identity: ServerScope) => identity.api.auth.logout(),
    onSuccess: () => navigate("/login", { replace: true }),
  }))
  const data = useData()
  const server = useServer()
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  createDocumentTitle(() => ({
    pathname: location.pathname,
    workspaceID: workspace.current().id,
    sessionTitle: (id) =>
      Option.match(Schema.decodeUnknownOption(Session.ID)(id), {
        onNone: () => undefined,
        onSome: (sessionID) => data.session.get(sessionID)?.title,
      }),
    projectName: (id) =>
      Option.match(Schema.decodeUnknownOption(Project.ID)(id), {
        onNone: () => undefined,
        onSome: (projectID) => server.data.project.get(projectID)?.name ?? undefined,
      }),
  }))
  const currentConsoleItem = () => {
    if (workspace.current().role !== "admin") return undefined
    const pathname = normalizePathname(location.pathname)
    return consoleSidebar.items.find((item) => {
      const href = workspaceRouteHref(workspace.current().id, item.path)
      return (
        pathname === href ||
        ((item.id === "service-accounts" || item.id === "mcp-gateway" || item.id === "policies") &&
          pathname.startsWith(`${href}/`))
      )
    })
  }
  const consoleActive = () => {
    if (workspace.current().role !== "admin") return false
    const pathname = normalizePathname(location.pathname)
    const gatewayHref = workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.gateway)
    const mcpHref = workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.mcp)
    return (
      currentConsoleItem() !== undefined ||
      pathname === gatewayHref ||
      pathname.startsWith(`${gatewayHref}/`) ||
      pathname === mcpHref ||
      pathname.startsWith(`${mcpHref}/`)
    )
  }
  const openSearch = () =>
    command
      .options()
      .find((option) => option.id === "command.palette")
      ?.onSelect?.("palette")
  command.register("shell.search", () => [
    {
      id: "sidebar.search",
      title: "Search",
      keybind: "f",
      when: () => document.querySelector('[role="menu"]') === null,
      onSelect: openSearch,
    },
  ])
  return (
    <Shell
      layout="contained"
      sidebar={(sidebar) => (
        <ProjectSidebarRegion
          footer={
            <AccountMenu
              identity={account.current()?.email ?? "Account"}
              workspaceName={workspace.current().name}
              scheme={theme.scheme()}
              consoleAvailable={workspace.current().role === "admin"}
              onOpenConsole={() => {
                if (!consoleActive()) navigate(workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.gateway))
                sidebar.onDismiss()
              }}
              onOpenSessions={() => dialog.show(() => <SessionsDialog />)}
              onSchemeChange={theme.setColorScheme}
              onLogout={() => logout.mutate(scope)}
            />
          }
          controller={controller}
          onDismiss={sidebar.onDismiss}
          searchLabel="Search"
          routes={workspaceRouteItems({
            workspaceID: workspace.current().id,
            pathname: location.pathname,
            navigate,
            onDismiss: sidebar.onDismiss,
          })}
          gateway={{
            get active() {
              return consoleActive()
            },
            get currentItem() {
              return currentConsoleItem()?.id
            },
            onSelectItem: (itemID) => {
              const item = consoleSidebar.items.find((candidate) => candidate.id === itemID)
              if (item) navigate(workspaceRouteHref(workspace.current().id, item.path))
            },
          }}
          onOpenSearch={openSearch}
          onReturnToMain={() => navigate(workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview))}
          projects={<SidebarProjectsRegion onDismiss={sidebar.onDismiss} />}
        />
      )}
    >
      {props.children}
    </Shell>
  )
}

/** Adapt router-neutral workspace route metadata at the shell boundary. */
export function workspaceRouteItems(input: {
  readonly workspaceID: string
  readonly pathname: string
  readonly navigate: (href: string) => void
  readonly onDismiss: () => void
}) {
  return workspaceSidebarRoutes.map((route) => {
    const href = workspaceRouteHref(input.workspaceID, route.path)
    const pathname = normalizePathname(input.pathname)
    return {
      ...route,
      active: pathname === href,
      onSelect: () => {
        input.navigate(href)
        input.onDismiss()
      },
    }
  })
}
