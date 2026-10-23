import { Layer } from "effect"
import { SystemHandler } from "./handlers/system.js"
import { AuditHandler } from "./handlers/audit.js"
import { WorkspaceHandler } from "./handlers/workspace.js"
import { ProviderHandler } from "./handlers/provider.js"
import { ModelHandler } from "./handlers/model.js"
import { ConfigHandler } from "./handlers/config.js"
import { ProjectHandler } from "./handlers/project.js"
import { ScheduledTaskHandler } from "./handlers/scheduled-task.js"
import { SkillHandler } from "./handlers/skill.js"
import { SessionHandler } from "./handlers/session.js"
import { IntegrationHandler } from "./handlers/integration.js"
import { CredentialHandler } from "./handlers/credential.js"
import { WebSearchHandler } from "./handlers/websearch.js"
import { PermissionHandler } from "./handlers/permission.js"
import { FormHandler } from "./handlers/form.js"
import { AgentHandler } from "./handlers/agent.js"
import { EventHandler } from "./handlers/event.js"
import { MessageHandler } from "./handlers/message.js"
import { CommandHandler } from "./handlers/command.js"
import { ReferenceHandler } from "./handlers/reference.js"
import { McpSettingsHandler } from "./handlers/mcp.js"
import { UsageHandler } from "./handlers/usage.js"
import { PolicyHandler } from "./handlers/policy.js"
import { ServiceAccountHandler } from "./handlers/service-account.js"
import { ToolHandler } from "./handlers/tool.js"
import { BudgetHandler } from "./handlers/budget.js"
import { ShareHandler } from "./handlers/share.js"

/** All HTTP endpoint implementation Layers, except those parameterized by route options (UserHandler, AccountHandler). */
export const handlers = Layer.mergeAll(
  SystemHandler,
  AuditHandler,
  WorkspaceHandler,
  ProviderHandler,
  ModelHandler,
  ConfigHandler,
  ProjectHandler,
  ScheduledTaskHandler,
  SkillHandler,
  SessionHandler,
  IntegrationHandler,
  CredentialHandler,
  WebSearchHandler,
  PermissionHandler,
  FormHandler,
  AgentHandler,
  EventHandler,
  MessageHandler,
  CommandHandler,
  ReferenceHandler,
  McpSettingsHandler,
  UsageHandler,
  PolicyHandler,
  ServiceAccountHandler,
  ToolHandler,
  BudgetHandler,
  ShareHandler,
)
