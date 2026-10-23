import { Project } from "@bymorning/schema/project"
import { Option, Schema } from "effect"

export const WorkspaceRoutePath = {
  overview: "/",
  scheduledTasks: "/scheduled-tasks",
  automations: "/automations",
  project: "/prj/:projectID",
  legacyProjects: "/projects",
  agents: "/agents",
  skills: "/skills",
  legacyFiles: "/files",
  members: "/members",
  security: "/security",
  audit: "/audit",
  installation: "/installation",
  installationPolicy: "/installation/policy",
  mcp: "/mcp",
  mcpDetail: "/mcp/:server",
  gateway: "/gateway",
  gatewayLeaderboard: "/gateway/leaderboard",
  gatewayQuickStart: "/gateway/quick-start",
  gatewayBudgets: "/gateway/budgets",
  gatewayServiceAccounts: "/gateway/service-accounts",
  gatewayServiceAccount: "/gateway/service-accounts/:serviceAccountID",
  gatewayAPIKeys: "/gateway/service-accounts",
  gatewayModels: "/gateway/models",
  policies: "/policies",
  policyAutoNew: "/policies/auto",
  policyAuto: "/policies/auto/:name",
  session: "/session/:sessionID",
} as const

export function workspaceRouteHref(
  workspaceID: string,
  path: (typeof WorkspaceRoutePath)[keyof typeof WorkspaceRoutePath],
) {
  return `/w/${workspaceID}${path === "/" ? "" : path}`
}

export function projectRouteHref(workspaceID: string, projectID: Project.ID) {
  return `/w/${workspaceID}/prj/${projectID}`
}

export function serviceAccountRouteHref(workspaceID: string, serviceAccountID: string) {
  return `/w/${workspaceID}/gateway/service-accounts/${encodeURIComponent(serviceAccountID)}`
}

export function sessionRouteHref(workspaceID: string, sessionID: string) {
  return `/w/${workspaceID}/session/${sessionID}`
}

export function workspaceIDFromPath(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

export function projectRouteIDFromPath(pathname: string) {
  const value = pathname.match(/\/prj\/([^/]+)\/?$/)?.[1]
  return value ? Option.getOrUndefined(Schema.decodeUnknownOption(Project.ID)(value)) : undefined
}

export function normalizePathname(pathname: string) {
  if (pathname === "/") return pathname
  return pathname.replace(/\/+$/, "")
}
