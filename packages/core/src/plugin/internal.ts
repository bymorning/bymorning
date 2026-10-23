export * as PluginInternal from "./internal.js"

import type { Plugin } from "@bymorning/plugin/effect/plugin"
import { Context, Effect, Option, type Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Config } from "../config.js"
import { Agent } from "../agent.js"
import type { Model } from "@bymorning/schema/model"
import { ToolOutput } from "../tool-output.js"
import { Skill } from "../skill.js"
import { WebSearch } from "../websearch.js"
import { Form } from "../form.js"
import { CodeInterpreter } from "../code-interpreter.js"
import { PluginRuntime } from "./runtime.js"
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { ConfigInstructionPlugin } from "../config/plugin/instruction.js"
import { ConfigMcpPlugin } from "../config/plugin/mcp.js"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch.js"
import { ConfigCodeInterpreterPlugin } from "../config/plugin/code-interpreter.js"
import { DefaultAgentPlugin } from "./internal/agent/default.js"
import { ExploreAgentPlugin } from "./internal/agent/explore.js"
import { GeneralAgentPlugin } from "./internal/agent/general.js"
import { BymorningPlugin } from "./internal/skill/bymorning.js"
import { ScheduledTaskSkillPlugin } from "./internal/skill/scheduled-task.js"
import { AddPlugin } from "./internal/tool/add.js"
import { EditPlugin } from "./internal/tool/edit.js"
import { GlobPlugin } from "./internal/tool/glob.js"
import { GrepPlugin } from "./internal/tool/grep.js"
import { ReadPlugin, Instructions, makeInstructions } from "./internal/tool/read.js"
import { Binding } from "./internal/tool/binding.js"
import { ToolOutputPlugin } from "./internal/tool/tool-output.js"
import { ExecutePlugin } from "./internal/tool/execute.js"
import { SkillToolPlugin } from "./internal/tool/skill.js"
import { QuestionToolPlugin } from "./internal/tool/question.js"
import { SubagentToolPlugin } from "./internal/tool/subagent.js"
import { ShellPlugin } from "./internal/tool/shell.js"
import { SidebarPlugin } from "./internal/tool/sidebar.js"
import { WebFetchToolPlugin } from "./internal/tool/web-fetch.js"
import { WebSearchToolPlugin } from "./internal/tool/web-search.js"
import { WritePlugin } from "./internal/tool/write.js"
import { Mcp } from "../mcp.js"
import { Bus } from "../bus.js"
import { Actor } from "../actor.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Project } from "../project.js"
import { Storage } from "../storage.js"
import { ProviderPlugins } from "./internal/provider.js"
import { McpCodeModeExclusionPlugin } from "./internal/mcp-codemode-exclusion.js"
import { WebSearchPlugins } from "./internal/websearch/index.js"
import { ToolkitPlugin } from "./internal/tool/toolkit.js"
import { McpTool } from "../tool/mcp.js"
import { Limiter } from "../limiter.js"
import { LimiterPlugin } from "./internal/limiter.js"
import { ProvidersPlugin } from "./internal/providers.js"
import { Routing } from "../routing.js"

/** Workspace services every internal definition may yield; `list()` captures exactly these. */
const services = [
  Actor.Binding.Service,
  Agent.Service,
  Binding.Service,
  Bus.Service,
  CodeInterpreter.Service,
  Config.Service,
  Form.Service,
  HttpClient.HttpClient,
  InstructionDiscovery.Service,
  Mcp.Service,
  McpTool.Service,
  PluginRuntime.Service,
  Project.Service,
  Skill.Service,
  Storage.Service,
  ToolOutput.Service,
  WebSearch.Service,
] as const

export type Requirements = Context.Service.Identifier<(typeof services)[number]>

/** Internal definitions may additionally yield the Workspace-bound instruction discovery seam. */
export type InternalPlugin = Plugin<Requirements | Instructions | Scope.Scope>

const pre = [
  ...ProviderPlugins,
  ...WebSearchPlugins,
  ToolkitPlugin,
  AddPlugin,
  GlobPlugin,
  GrepPlugin,
  ReadPlugin,
  ToolOutputPlugin,
  WritePlugin,
  EditPlugin,
  SidebarPlugin,
  ShellPlugin,
  ExecutePlugin,
  WebFetchToolPlugin,
  WebSearchToolPlugin,
  SkillToolPlugin,
  QuestionToolPlugin,
  SubagentToolPlugin,
  BymorningPlugin,
  ScheduledTaskSkillPlugin,
  DefaultAgentPlugin,
  GeneralAgentPlugin,
  ExploreAgentPlugin,
] as const satisfies readonly InternalPlugin[]

const post = [
  ConfigInstructionPlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  ConfigWebSearchPlugin.Plugin,
  ConfigCodeInterpreterPlugin.Plugin,
  ConfigMcpPlugin.Plugin,
  McpCodeModeExclusionPlugin,
] as const satisfies readonly InternalPlugin[]

/** Capture Workspace authorities before definitions enter the isolated registry. */
export const list = Effect.fn("PluginInternal.list")(function* <R>(
  modelInventory: Effect.Effect<
    {
      readonly all: ReadonlyArray<Model.Info>
      readonly available: ReadonlyArray<Model.Info>
    },
    never,
    R
  >,
) {
  // Capture only services; activation supplies the child Scope and batching context.
  // Instructions is derived from the Workspace binding rather than provided by a Layer (upstream e76e90b71e).
  const binding = yield* Binding.Service
  const instructions = yield* makeInstructions(binding.workspaceID)
  // Routing is optional so focused graphs without it still activate; production graphs always supply it.
  const routing = yield* Effect.serviceOption(Routing.Service)
  const picked = Context.pick(...services)(yield* Effect.context<Requirements>()).pipe(
    Context.add(Instructions, instructions),
  )
  const context = Option.isSome(routing) ? Context.add(picked, Routing.Service, routing.value) : picked
  const resolve = (plugins: readonly InternalPlugin[]) =>
    plugins.map((plugin): Plugin => plugin.scope === "workspace" ? {
      ...plugin, effect: (host: import("@bymorning/plugin/effect/plugin").WorkspaceContext) => plugin.effect(host).pipe(Effect.provide(context)),
    } : {
      ...plugin, effect: (host) => plugin.effect(host).pipe(Effect.provide(context)),
    })
  return {
    pre: resolve(pre),
    // Invocation plugins (limiter, providers) are captured in workspace(), not this member list.
    post: resolve(post),
  }
})

/** Capture only caller-less authorities; invocation Scope is deliberately not captured. */
export const workspace = Effect.gen(function* () {
  const context = Context.pick(Limiter.Service, Config.Service)(
    yield* Effect.context<Limiter.Service | Config.Service>(),
  )
  const definitions = [LimiterPlugin.plugin, ProvidersPlugin.plugin] as ReadonlyArray<
    Extract<Plugin<Limiter.Service | Config.Service | Scope.Scope>, { scope: "workspace" }>
  >
  const plugins = definitions.map((plugin) => ({
    ...plugin,
    effect: (host: Parameters<typeof plugin.effect>[0]) => plugin.effect(host).pipe(Effect.provide(context)),
  }))
  return { pre: plugins, post: [] }
})
