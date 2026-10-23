import { ShareRoutePath } from "@bymorning/plugin-share/web"
import { Navigate, Route } from "@solidjs/router"
import { lazy, Suspense, type ComponentProps, type JSX } from "solid-js"

import { WorkspaceRuntimeProvider } from "../../context/workspace-runtime"
import { ConsoleGate } from "../../console/gate"
import { HomeRoute } from "../../home/route"
import { NotFoundRoute } from "../../not-found/route"
import { SessionLoading } from "../../session/loading"
import { AppLayout } from "./layout"
import { WorkspaceProvider, WorkspaceRoute } from "./workspace"
import { WorkspaceRoutePath } from "../../workspace-route-paths"

const ShareChunk = lazy(() => import("../../share/route").then(({ ShareRoute }) => ({ default: ShareRoute })))

function Share(): JSX.Element {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <ShareChunk />
    </Suspense>
  )
}

const Login = lazy(() => import("../../login/route").then(({ LoginRoute }) => ({ default: LoginRoute })))
const OAuthConsent = lazy(() => import("../../oauth/consent").then(({ OAuthConsent }) => ({ default: OAuthConsent })))
const NewSession = lazy(() =>
  import("../../new-session/route").then(({ NewSessionRoute }) => ({ default: NewSessionRoute })),
)
const SessionLazy = lazy(() => import("../../session/route").then(({ SessionRoute }) => ({ default: SessionRoute })))

function Session(props: ComponentProps<typeof SessionLazy>) {
  return (
    <Suspense
      fallback={
        <div data-component="session-panel-frame">
          <SessionLoading />
        </div>
      }
    >
      <SessionLazy {...props} />
    </Suspense>
  )
}
// Router hover-preload and Overview's route preload both call this.
Session.preload = () => SessionLazy.preload()

const Form = lazy(() => import("../../form/route").then(({ FormRoute }) => ({ default: FormRoute })))
const MCP = lazy(() => import("../../mcp/route").then(({ MCPRoute }) => ({ default: MCPRoute })))
const MCPDetail = lazy(() => import("../../mcp/detail").then(({ MCPDetail }) => ({ default: MCPDetail })))
const Project = lazy(() => import("../../project/route").then(({ ProjectRoute }) => ({ default: ProjectRoute })))
const ScheduledTasks = lazy(() =>
  import("../../scheduled-task/route").then(({ ScheduledTaskRoute }) => ({ default: ScheduledTaskRoute })),
)
const LegacyProject = lazy(() =>
  import("../../project/legacy-route").then(({ LegacyProjectRoute }) => ({ default: LegacyProjectRoute })),
)
const Agents = lazy(() => import("../../home/agents/route").then(({ AgentsRoute }) => ({ default: AgentsRoute })))
const Skills = lazy(() => import("../../home/skills/route").then(({ SkillsRoute }) => ({ default: SkillsRoute })))
const Members = lazy(() => import("../../members/route").then(({ MembersRoute }) => ({ default: MembersRoute })))
const Security = lazy(() => import("../../security/route").then(({ SecurityRoute }) => ({ default: SecurityRoute })))
const AuditLog = lazy(() => import("../../audit/route").then(({ AuditRoute }) => ({ default: AuditRoute })))
const InstallationAdmins = lazy(() =>
  import("../../installation/route").then(({ InstallationRoute }) => ({ default: InstallationRoute })),
)
const InstallationPolicy = lazy(() =>
  import("../../installation/policy-route").then(({ InstallationPolicyRoute }) => ({ default: InstallationPolicyRoute })),
)
const Setup = lazy(() => import("../../setup/route").then(({ SetupRoute }) => ({ default: SetupRoute })))
const GatewayOverview = lazy(() =>
  import("../../gateway/overview/route").then(({ GatewayOverviewRoute }) => ({
    default: GatewayOverviewRoute,
  })),
)
const GatewayLeaderboard = lazy(() =>
  import("../../gateway/leaderboard/route").then(({ GatewayLeaderboardRoute }) => ({
    default: GatewayLeaderboardRoute,
  })),
)
const GatewayBudgets = lazy(() =>
  import("../../gateway/budgets/route").then(({ GatewayBudgetsRoute }) => ({ default: GatewayBudgetsRoute })),
)
const GatewayServiceAccounts = lazy(() =>
  import("../../gateway/service-accounts/route").then(({ GatewayServiceAccountsRoute }) => ({
    default: GatewayServiceAccountsRoute,
  })),
)
const GatewayServiceAccount = lazy(() =>
  import("../../gateway/service-accounts/route").then(({ GatewayServiceAccountRoute }) => ({
    default: GatewayServiceAccountRoute,
  })),
)
const GatewayModels = lazy(() =>
  import("../../gateway/models/route").then(({ GatewayModelsRoute }) => ({ default: GatewayModelsRoute })),
)
const Policies = lazy(() => import("../../policies/route").then(({ PoliciesRoute }) => ({ default: PoliciesRoute })))
const PolicyAuto = lazy(() => import("../../policies/auto-page").then(({ AutoModelRoute }) => ({ default: AutoModelRoute })))
const ToolUIPrototype = lazy(() =>
  import("../../prototypes/tool-ui/route").then(({ ToolUIPrototypeRoute }) => ({ default: ToolUIPrototypeRoute })),
)
const WorkflowBuilderPrototype = lazy(() =>
  import("../../prototypes/workflow-builder/route").then(({ WorkflowBuilderPrototypeRoute }) => ({
    default: WorkflowBuilderPrototypeRoute,
  })),
)
const ShareUIPrototype = lazy(() =>
  import("../../prototypes/share-ui/route").then(({ ShareUIPrototypeRoute }) => ({ default: ShareUIPrototypeRoute })),
)

/** Declare the application route hierarchy and its route-scoped providers. */
export function AppRoutes() {
  return (
    <>
      <Route path="/__prototype/tool-ui" component={ToolUIPrototype} />
      <Route path="/__prototype/workflow-builder" component={WorkflowBuilderPrototype} />
      <Route path="/__prototype/share-ui" component={ShareUIPrototype} />
      <Route component={WorkspaceRuntimeProvider}>
        <Route path="/login" component={Login} />
        <Route path="/setup" component={Setup} />
        <Route path={ShareRoutePath} component={Share} />
        <Route path="/oauth/consent" component={OAuthConsent} />
        <Route component={WorkspaceProvider}>
          <Route path="/" />
          <Route path="/w/:workspaceID" component={WorkspaceRoute}>
            <Route component={AppLayout}>
              <Route path={WorkspaceRoutePath.overview} component={HomeRoute} preload={() => void Session.preload()} />
              <Route path={WorkspaceRoutePath.scheduledTasks} component={ScheduledTasks} />
              <Route path={WorkspaceRoutePath.project} component={Project} />
              <Route path={WorkspaceRoutePath.legacyProjects} component={LegacyProject} />
              <Route path={WorkspaceRoutePath.legacyFiles} component={LegacyProject} />
              <Route component={ConsoleGate}>
                <Route path={WorkspaceRoutePath.agents} component={Agents} />
                <Route path={WorkspaceRoutePath.skills} component={Skills} />
                <Route path={WorkspaceRoutePath.members} component={Members} />
                <Route path={WorkspaceRoutePath.security} component={Security} />
                <Route path={WorkspaceRoutePath.audit} component={AuditLog} />
                <Route path={WorkspaceRoutePath.installation} component={InstallationAdmins} />
                <Route path={WorkspaceRoutePath.installationPolicy} component={InstallationPolicy} />
                <Route path={WorkspaceRoutePath.mcp} component={MCP} />
                <Route path={WorkspaceRoutePath.mcpDetail} component={MCPDetail} />
                <Route path={WorkspaceRoutePath.gateway} component={GatewayOverview} />
                <Route path={WorkspaceRoutePath.gatewayLeaderboard} component={GatewayLeaderboard} />
                <Route path={WorkspaceRoutePath.gatewayQuickStart} component={() => <Navigate href="../service-accounts" />} />
                <Route path={WorkspaceRoutePath.gatewayBudgets} component={GatewayBudgets} />
                <Route path={WorkspaceRoutePath.gatewayServiceAccounts} component={GatewayServiceAccounts} />
                <Route path={WorkspaceRoutePath.gatewayServiceAccount} component={GatewayServiceAccount} />
                <Route path="/gateway/api-keys" component={() => <Navigate href="../service-accounts" />} />
                <Route path={WorkspaceRoutePath.gatewayModels} component={GatewayModels} />
                <Route path={WorkspaceRoutePath.policies} component={Policies} />
                <Route path={WorkspaceRoutePath.policyAutoNew} component={PolicyAuto} />
                <Route path={WorkspaceRoutePath.policyAuto} component={PolicyAuto} />
              </Route>
              <Route path="/new-session" component={NewSession} />
              <Route path="/session/:sessionID" component={Session} />
              <Route path="/form" component={Form} />
              <Route path="/form/:formID" component={Form} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*404" component={NotFoundRoute} />
    </>
  )
}
