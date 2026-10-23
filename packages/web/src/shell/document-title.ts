import { createEffect, onCleanup } from "solid-js"

import { consoleSidebar, workspaceRoutes } from "../project/sidebar/navigation"
import { normalizePathname, workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"

const suffix = "ByMorning"

export interface DocumentTitleInput {
  readonly pathname: string
  readonly workspaceID: string
  readonly sessionTitle?: (sessionID: string) => string | undefined
  readonly projectName?: (projectID: string) => string | undefined
}

/** Resolve the browser tab title for a Workspace route. Falls back to the product name. */
export function documentTitle(input: DocumentTitleInput): string {
  const pathname = normalizePathname(input.pathname)
  const page = pageName(pathname, input)
  return page ? `${page} · ${suffix}` : suffix
}

function pageName(pathname: string, input: DocumentTitleInput): string | undefined {
  const session = pathname.match(/\/session\/([^/]+)$/)?.[1]
  if (session) return input.sessionTitle?.(session)?.trim() || "Session"
  const project = pathname.match(/\/prj\/([^/]+)$/)?.[1]
  if (project) return input.projectName?.(project)?.trim() || "Project"
  const overview = workspaceRouteHref(input.workspaceID, WorkspaceRoutePath.overview)
  if (pathname === overview) return "Overview"
  if (pathname === `${overview}/new-session`) return "New session"
  const scheduled = workspaceRouteHref(input.workspaceID, WorkspaceRoutePath.scheduledTasks)
  if (pathname === scheduled) return workspaceRoutes.find((route) => route.id === "scheduledTasks")?.label
  // Longest href wins so detail pages inherit their section and nested paths beat their parents.
  const entry = consoleSidebar.items
    .map((item) => ({ item, href: workspaceRouteHref(input.workspaceID, item.path) }))
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.item
  if (!entry) return undefined
  // Console Overview shares its label with the Workspace Overview.
  if (entry.id === "policies") return "Model routing"
  return entry.id === "ai-gateway" ? "Console overview" : entry.label
}

/** Keep the tab title in step with the active route; restore the product name on teardown. */
export function createDocumentTitle(input: () => DocumentTitleInput): void {
  createEffect(() => {
    document.title = documentTitle(input())
  })
  onCleanup(() => {
    document.title = suffix
  })
}
