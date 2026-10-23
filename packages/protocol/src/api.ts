import type { Context } from "effect"
import { HttpApi, type HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { AuthGroup } from "./groups/auth.js"
import { AccountGroup } from "./groups/account.js"
import { WorkspaceGroup } from "./groups/workspace.js"
import { UserGroup } from "./groups/user.js"
import { ModelGroup } from "./groups/model.js"
import { ProviderGroup } from "./groups/provider.js"
import { CredentialGroup } from "./groups/credential.js"
import { IntegrationGroup } from "./groups/integration.js"
import { makeSessionGroup } from "./groups/session.js"
import { makeEventGroup } from "./groups/event.js"
import { makeMessageGroup } from "./groups/message.js"
import { WebSearchGroup } from "./groups/websearch.js"
import { makePermissionGroup } from "./groups/permission.js"
import { makeFormGroup } from "./groups/form.js"
import { AgentGroup } from "./groups/agent.js"
import { SystemGroup } from "./groups/system.js"
import { ConfigGroup } from "./groups/config.js"
import { ProjectGroup } from "./groups/project.js"
import { ScheduledTaskGroup } from "./groups/scheduled-task.js"
import { SkillGroup } from "./groups/skill.js"
import { CommandGroup } from "./groups/command.js"
import { ReferenceGroup } from "./groups/reference.js"
import { UsageGroup } from "./groups/usage.js"
import { AccountMiddleware } from "./middleware/account-middleware.js"
import { AuditGroup } from "./groups/audit.js"
import { WorkspaceMiddleware } from "./middleware/workspace-middleware.js"
import { SchemaErrorMiddleware } from "./middleware/schema-error.js"
import { McpSettingsGroup } from "./groups/mcp.js"
import { PolicyGroup } from "./groups/policy.js"
import { AuthProviderGroup } from "./groups/auth-provider.js"
import { InstallationGroup } from "./groups/installation.js"
import { OAuthGroup } from "./groups/oauth.js"
import { ServiceAccountGroup } from "./groups/service-account.js"
import { ToolGroup } from "./groups/tool.js"
import { BudgetGroup } from "./groups/budget.js"
import { ShareGroup } from "./groups/share.js"

/** Build the complete public HTTP API with runtime middleware selected by its consumer. */
export const makeApi = <
  AccountMiddlewareId extends HttpApiMiddleware.AnyId,
  AccountMiddlewareService,
  WorkspaceMiddlewareId extends HttpApiMiddleware.AnyId,
  WorkspaceMiddlewareService,
  PersistedSessionMiddlewareId extends HttpApiMiddleware.AnyId,
  PersistedSessionMiddlewareService,
>(
  accountMiddleware: Context.Key<AccountMiddlewareId, AccountMiddlewareService>,
  workspaceMiddleware: Context.Key<WorkspaceMiddlewareId, WorkspaceMiddlewareService>,
  persistedSessionMiddleware: Context.Key<PersistedSessionMiddlewareId, PersistedSessionMiddlewareService>,
) => {
  const account = HttpApi.make("account")
    .add(AccountGroup)
    .add(WorkspaceGroup)
    // Installation-wide governance is Account-scoped: an Installation Admin is
    // not a Workspace Role and confers no Workspace membership.
    .add(AuthProviderGroup)
    .add(InstallationGroup)
    .add(OAuthGroup)
    .middleware(SchemaErrorMiddleware)
    .middleware(accountMiddleware)
  const workspace = HttpApi.make("workspace")
    .add(UserGroup.middleware(workspaceMiddleware))
    .add(ProviderGroup.middleware(workspaceMiddleware))
    .add(ConfigGroup.middleware(workspaceMiddleware))
    .add(ProjectGroup.middleware(workspaceMiddleware))
    .add(ScheduledTaskGroup.middleware(workspaceMiddleware))
    .add(SkillGroup.middleware(workspaceMiddleware))
    .add(PolicyGroup.middleware(workspaceMiddleware))
    .add(CommandGroup.middleware(workspaceMiddleware))
    .add(ReferenceGroup.middleware(workspaceMiddleware))
    .add(UsageGroup.middleware(workspaceMiddleware))
    .add(ToolGroup.middleware(workspaceMiddleware))
    .add(ModelGroup.middleware(workspaceMiddleware))
    .add(IntegrationGroup.middleware(workspaceMiddleware))
    .add(McpSettingsGroup.middleware(workspaceMiddleware))
    .add(CredentialGroup.middleware(workspaceMiddleware))
    .add(WebSearchGroup.middleware(workspaceMiddleware))
    .add(makeSessionGroup(workspaceMiddleware, persistedSessionMiddleware))
    .add(makeMessageGroup(persistedSessionMiddleware))
    .add(makeEventGroup(workspaceMiddleware))
    .add(AgentGroup.middleware(workspaceMiddleware))
    .add(AuditGroup.middleware(workspaceMiddleware))
    .add(ServiceAccountGroup.middleware(workspaceMiddleware))
    .add(BudgetGroup.middleware(workspaceMiddleware))
    .add(makePermissionGroup(workspaceMiddleware, persistedSessionMiddleware))
    .add(makeFormGroup(workspaceMiddleware, persistedSessionMiddleware))
    .middleware(SchemaErrorMiddleware)
    .middleware(accountMiddleware)
  return HttpApi.make("api")
    .add(SystemGroup)
    .add(AuthGroup)
    .add(ShareGroup)
    .middleware(SchemaErrorMiddleware)
    .addHttpApi(account)
    .addHttpApi(workspace)
    .annotateMerge(
      OpenApi.annotations({
        title: "ByMorning API",
        version: "0.0.0",
        description: "Public HTTP API for the ByMorning control plane.",
      }),
    )
}

/** Complete portable HTTP contract used by runtimes, clients, and protocol tooling. */
export class Api extends makeApi(AccountMiddleware, WorkspaceMiddleware, WorkspaceMiddleware) {}
