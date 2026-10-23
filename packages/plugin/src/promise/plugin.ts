import type { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import type { PluginConfigurationDefinition, PluginOptions } from "../options.js"
import type { Location } from "../location.js"
import type { App } from "../app.js"
import type { AgentDomain } from "./agent.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CatalogDomain } from "./catalog.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { GatewayDomain } from "./gateway.js"
import type { IntegrationDomain } from "./integration.js"
import type { InstructionDomain } from "./instruction.js"
import type { MCPDomain } from "./mcp.js"
import type { Workspace } from "@bymorning/schema/workspace"
import type { ReferenceDomain } from "./reference.js"
import type { SessionDomain } from "./session.js"
import type { ShellDomain } from "./shell.js"
import type { SkillDomain } from "./skill.js"
import type { StorageDomain } from "./storage.js"
import type { ToolDomain } from "./tool.js"
import type { WebSearchDomain } from "./websearch.js"
import type { CodeInterpreterDomain } from "./code-interpreter.js"

export interface Context {
  readonly app: App
  readonly location: Location
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly gateway: GatewayDomain
  readonly integration: IntegrationDomain
  readonly instruction: InstructionDomain
  readonly mcp: MCPDomain
  readonly plugin: { readonly list: () => Promise<ReadonlyArray<PluginSchema.Info>> }
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  readonly tool: ToolDomain
  readonly websearch: WebSearchDomain
  readonly codeInterpreter: CodeInterpreterDomain
}

export type Cleanup = () => Promise<void> | void

/** Capabilities available to a Workspace activation without a member identity. */
export interface WorkspaceContext {
  readonly app: Context["app"]
  readonly options: Context["options"]
  readonly location: { readonly workspaceID: Workspace.ID }
  readonly catalog: Context["catalog"]
  readonly gateway: Context["gateway"]
  readonly session: Pick<Context["session"], "hook">
  readonly tool: Pick<Context["tool"], "hook">
  readonly storage: Context["storage"]
}

/** Common Plugin declaration fields. */
export interface PluginFields {
  readonly id: string
  readonly tui?: boolean
  readonly configuration?: PluginConfigurationDefinition
}

/** One activation scope and its corresponding capability surface. */
export type Plugin = PluginFields & (
  | { readonly scope: "workspace"; readonly setup: (context: WorkspaceContext) => Promise<Cleanup | void> | Cleanup | void }
  | { readonly scope?: "member"; readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void }
)

/** Preserve the selected Plugin declaration. */
export function define<P extends Plugin>(plugin: P): P {
  return plugin
}
