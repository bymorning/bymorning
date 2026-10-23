import type { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import type { Effect, Scope } from "effect"
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
  readonly plugin: { readonly list: () => Effect.Effect<ReadonlyArray<PluginSchema.Info>> }
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  readonly tool: ToolDomain
  readonly websearch: WebSearchDomain
  readonly codeInterpreter: CodeInterpreterDomain
}

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
export type Plugin<R = Scope.Scope> = PluginFields & (
  | { readonly scope: "workspace"; readonly effect: (context: WorkspaceContext) => Effect.Effect<void, never, R> }
  | { readonly scope?: "member"; readonly effect: (context: Context) => Effect.Effect<void, never, R> }
)

/** Preserve the selected Plugin declaration and Effect requirements. */
export function define<P extends Plugin<unknown>>(plugin: P): P
/** Preserve explicit Effect requirement arguments used by existing member Plugins. */
export function define<R = Scope.Scope>(plugin: Extract<Plugin<R>, { readonly scope?: "member" }>): Extract<Plugin<R>, { readonly scope?: "member" }>
/** Preserve explicit Effect requirement arguments for Workspace Plugins. */
export function define<R = Scope.Scope>(plugin: Extract<Plugin<R>, { readonly scope: "workspace" }>): Extract<Plugin<R>, { readonly scope: "workspace" }>
export function define(plugin: Plugin<unknown>): Plugin<unknown> {
  return plugin
}
