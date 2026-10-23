/// <reference types="node" />

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

const source = readFileSync(join(process.cwd(), "src/shell/routes/routes.tsx"), "utf8")

it("preloads the session route from Overview and names chunk loading", () => {
  expect(source).toContain("preload={() => void Session.preload()}")
  expect(source).toContain('lazy(() => import("../../session/route").then(({ SessionRoute })')
  expect(source).toContain("<SessionLoading />")
  expect(source).toContain('data-component="session-panel-frame"')
})

it("declares the singular Project route and legacy redirects lazily", () => {
  expect(source).toContain('lazy(() => import("../../project/route")')
  expect(source).toContain("<Route path={WorkspaceRoutePath.project} component={Project} />")
  expect(source).toContain("<Route path={WorkspaceRoutePath.legacyProjects} component={LegacyProject} />")
  expect(source).toContain("<Route path={WorkspaceRoutePath.legacyFiles} component={LegacyProject} />")
})

it("declares the public Share route lazily outside WorkspaceProvider", () => {
  expect(source).toContain(
    'lazy(() => import("../../share/route").then(({ ShareRoute }) => ({ default: ShareRoute })))',
  )
  expect(source).toContain("<Route path={ShareRoutePath} component={Share} />")
  expect(source).toContain('<Suspense fallback={<p role="status">Loading…</p>}>')
  expect(source).not.toContain("path={WorkspaceRoutePath.share")
})

it("declares Members as a lazy workspace route", () => {
  expect(source).toContain('lazy(() => import("../../members/route")')
  expect(source).toContain("<Route path={WorkspaceRoutePath.members} component={Members} />")
})

it("declares Scheduled tasks as a lazy workspace route", () => {
  expect(source).toContain('lazy(() =>\n  import("../../scheduled-task/route")')
  expect(source).toContain("<Route path={WorkspaceRoutePath.scheduledTasks} component={ScheduledTasks} />")
})

it("declares the MCP overview and server Tool routes lazily without a diagnostics catalog", () => {
  expect(source).toContain('lazy(() => import("../../mcp/route").then(({ MCPRoute })')
  expect(source).toContain('lazy(() => import("../../mcp/detail").then(({ MCPDetail })')
  expect(source).toContain("<Route path={WorkspaceRoutePath.mcp} component={MCP} />")
  expect(source).toContain("<Route path={WorkspaceRoutePath.mcpDetail} component={MCPDetail} />")
  expect(source).not.toContain("mcpCatalog")
})

it("does not declare a Console landing route", () => {
  expect(source).not.toContain("ConsoleRoute")
  expect(source).not.toContain("WorkspaceRoutePath.console")
})

it("routes the Console section through the admin gate", () => {
  expect(source).toContain("<Route component={ConsoleGate}>")
})

it("declares Policies as a lazy Console route", () => {
  expect(source).toContain('lazy(() => import("../../policies/route").then(({ PoliciesRoute })')
  expect(source).toContain("<Route path={WorkspaceRoutePath.policies} component={Policies} />")
})

it("declares the Auto model page lazily for new and existing names", () => {
  expect(source).toContain('lazy(() => import("../../policies/auto-page").then(({ AutoModelRoute })')
  expect(source).toContain("<Route path={WorkspaceRoutePath.policyAutoNew} component={PolicyAuto} />")
  expect(source).toContain("<Route path={WorkspaceRoutePath.policyAuto} component={PolicyAuto} />")
})

it("declares every Gateway page as a lazy workspace route", () => {
  expect(source).toContain('import("../../gateway/overview/route").then(({ GatewayOverviewRoute })')
  expect(source).toContain('import("../../gateway/leaderboard/route").then(({ GatewayLeaderboardRoute })')
  expect(source).toContain('import("../../gateway/budgets/route").then(({ GatewayBudgetsRoute })')
  expect(source).toContain('import("../../gateway/service-accounts/route").then(({ GatewayServiceAccountsRoute })')
  expect(source).toContain('import("../../gateway/service-accounts/route").then(({ GatewayServiceAccountRoute })')
  expect(source).toContain('import("../../gateway/models/route").then(({ GatewayModelsRoute })')
  expect(
    source.match(
      /<Route path={WorkspaceRoutePath\.gateway(?:Leaderboard|QuickStart|Budgets|ServiceAccounts|Models)?}/g,
    ),
  ).toHaveLength(6)
  expect(source).toContain(
    '<Route path="/gateway/api-keys" component={() => <Navigate href="../service-accounts" />} />',
  )
  // Quick start folded into Service accounts; the old URL still lands somewhere useful.
  expect(source).toContain(
    '<Route path={WorkspaceRoutePath.gatewayQuickStart} component={() => <Navigate href="../service-accounts" />} />',
  )
})
