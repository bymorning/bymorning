import type { IconProps } from "../../ui/components/icon"
import { WorkspaceRoutePath } from "../../workspace-route-paths"

export const workspaceRoutes = [
  { id: "overview", label: "Overview", icon: "central-home", path: WorkspaceRoutePath.overview },
  { id: "scheduledTasks", label: "Scheduled tasks", icon: "central-clock", path: WorkspaceRoutePath.scheduledTasks },
  { id: "agents", label: "Agents", icon: "central-agents", path: WorkspaceRoutePath.agents },
  { id: "skills", label: "Skills", icon: "central-agent-skills", path: WorkspaceRoutePath.skills },
  { id: "members", label: "Members", icon: "central-user-group", path: WorkspaceRoutePath.members },
] as const satisfies ReadonlyArray<{
  readonly id: string
  readonly label: string
  readonly icon: IconProps["name"]
  readonly path: string
}>

export type WorkspaceRouteID = (typeof workspaceRoutes)[number]["id"]

// Keep unfinished destinations routable while temporarily omitting them from the sidebar.
const hiddenWorkspaceSidebarRouteIDs = new Set<WorkspaceRouteID>(["agents", "skills", "members"])

export const workspaceSidebarRoutes = workspaceRoutes.filter((route) => !hiddenWorkspaceSidebarRouteIDs.has(route.id))

export const gatewayRoutes = [
  { id: "overview", label: "Overview", icon: "central-home", path: WorkspaceRoutePath.gateway },
  {
    id: "leaderboard",
    label: "Leaderboard",
    icon: "central-leaderboard",
    path: WorkspaceRoutePath.gatewayLeaderboard,
  },
  { id: "budgets", label: "Budgets", icon: "central-wallet", path: WorkspaceRoutePath.gatewayBudgets },
  {
    id: "service-accounts",
    label: "Service accounts",
    icon: "user-key",
    path: WorkspaceRoutePath.gatewayServiceAccounts,
  },
  { id: "models", label: "Models", icon: "central-layers-three", path: WorkspaceRoutePath.gatewayModels },
] as const satisfies ReadonlyArray<{
  readonly id: string
  readonly label: string
  readonly icon: IconProps["name"]
  readonly path: string
}>

export type GatewaySidebarItemID = (typeof gatewayRoutes)[number]["id"]

interface ConsoleEntry {
  readonly id: string
  readonly label: string
  readonly icon: IconProps["name"]
  readonly path: (typeof WorkspaceRoutePath)[keyof typeof WorkspaceRoutePath]
}

const overviewEntry: ConsoleEntry = {
  id: "ai-gateway",
  label: "Overview",
  icon: "central-home",
  path: WorkspaceRoutePath.gateway,
}
const leaderboardEntry: ConsoleEntry = {
  id: "leaderboard",
  label: "Leaderboard",
  icon: "central-leaderboard",
  path: WorkspaceRoutePath.gatewayLeaderboard,
}
const modelsEntry: ConsoleEntry = {
  id: "models",
  label: "Models",
  icon: "central-layers-three",
  path: WorkspaceRoutePath.gatewayModels,
}
const policiesEntry: ConsoleEntry = {
  id: "policies",
  label: "Routing",
  icon: "central-arrow-split-right",
  path: WorkspaceRoutePath.policies,
}
// Integrations is the umbrella: registered integrations (OAuth clients), outbound MCP servers, web search.
const mcpEntry: ConsoleEntry = {
  id: "mcp-gateway",
  label: "Integrations",
  icon: "central-plug",
  path: WorkspaceRoutePath.mcp,
}
const skillsEntry: ConsoleEntry = {
  id: "skills",
  label: "Skills",
  icon: "central-agent-skills",
  path: WorkspaceRoutePath.skills,
}
const agentsEntry: ConsoleEntry = {
  id: "agents",
  label: "Agents",
  icon: "central-agents",
  path: WorkspaceRoutePath.agents,
}
const membersEntry: ConsoleEntry = {
  id: "members",
  label: "Members",
  icon: "central-user-group",
  path: WorkspaceRoutePath.members,
}
const securityEntry: ConsoleEntry = {
  id: "security",
  label: "SSO",
  icon: "shield-key",
  path: WorkspaceRoutePath.security,
}
const auditEntry: ConsoleEntry = {
  id: "audit",
  label: "Audit log",
  icon: "central-list-bullets",
  path: WorkspaceRoutePath.audit,
}
const installationEntry: ConsoleEntry = {
  id: "installation",
  label: "Installation",
  icon: "central-globe",
  path: WorkspaceRoutePath.installation,
}
const installationPolicyEntry: ConsoleEntry = {
  id: "installation-policy",
  label: "Installation Policy",
  icon: "outline-sliders",
  path: WorkspaceRoutePath.installationPolicy,
}
const serviceAccountsEntry: ConsoleEntry = {
  id: "service-accounts",
  label: "Service accounts",
  icon: "user-key",
  path: WorkspaceRoutePath.gatewayServiceAccounts,
}
const budgetsEntry: ConsoleEntry = {
  id: "budgets",
  label: "Budgets",
  icon: "central-wallet",
  path: WorkspaceRoutePath.gatewayBudgets,
}

export const consoleSidebar = {
  label: "Console",
  items: [
    overviewEntry,
    leaderboardEntry,
    modelsEntry,
    policiesEntry,
    mcpEntry,
    agentsEntry,
    skillsEntry,
    membersEntry,
    serviceAccountsEntry,
    securityEntry,
    auditEntry,
    installationEntry,
    installationPolicyEntry,
    budgetsEntry,
  ],
  groups: [
    // What the gateway serves and how it routes, Overview first.
    { id: "gateway", label: "Gateway", items: [overviewEntry, leaderboardEntry, modelsEntry, policiesEntry, mcpEntry] },
    // How the assistant behaves for everyone in the Workspace.
    { id: "assistant", label: "Assistant", items: [agentsEntry, skillsEntry] },
    // Who may use it and what they may spend.
    {
      id: "workspace",
      label: "Workspace",
      items: [membersEntry, serviceAccountsEntry, securityEntry, auditEntry, budgetsEntry],
    },
    // Who governs the Installation and its mandatory policy.
    { id: "installation", label: "Installation", items: [installationEntry, installationPolicyEntry] },
  ],
} satisfies {
  readonly label: string
  readonly items: ReadonlyArray<ConsoleEntry>
  readonly groups: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly items: ReadonlyArray<ConsoleEntry>
  }>
}

export type ConsoleSidebarItemID = (typeof consoleSidebar.items)[number]["id"]

export type ProjectSidebarPane = "main" | "console"
