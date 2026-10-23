/** Production policy for one retained Workspace application graph. */
export * as WorkspaceMapGraph from "./graph.js"

import { Agent } from "@bymorning/core/agent"
import { Audit } from "@bymorning/core/audit"
import { Bus } from "@bymorning/core/bus"
import { Actor } from "@bymorning/core/actor"
import { AISDK } from "@bymorning/core/aisdk"
import { Catalog } from "@bymorning/core/catalog"
import { Command } from "@bymorning/core/command"
import { Config } from "@bymorning/core/config"
import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import type { Database } from "@bymorning/core/database"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import { Credential } from "@bymorning/core/credential"
import { InstructionDiscovery } from "@bymorning/core/instruction-discovery"
import { InstructionEntry } from "@bymorning/core/instruction-entry"
import { Integration } from "@bymorning/core/integration"
import { Form } from "@bymorning/core/form"
import { Job } from "@bymorning/core/job"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { Mcp } from "@bymorning/core/mcp"
import { ModelPolicy } from "@bymorning/core/model-policy"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Routing } from "@bymorning/core/routing"
import { Plugin } from "@bymorning/core/plugin"
import { PluginRuntime } from "@bymorning/core/plugin/runtime"
import { Reference } from "@bymorning/core/reference"
import { Project } from "@bymorning/core/project"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { Skill } from "@bymorning/core/skill"
import { SkillInstruction } from "@bymorning/core/skill-instruction"
import { SessionOperations } from "@bymorning/core/session-operations"
import { Session } from "@bymorning/core/session"
import { Shell } from "@bymorning/core/shell"
import type { Storage } from "@bymorning/core/storage"
import { Tool } from "@bymorning/core/tool"
import { ToolOutput } from "@bymorning/core/tool-output"
import { ToolUsage } from "@bymorning/core/tool-usage"
import { Usage } from "@bymorning/core/usage"
import { WebSearch } from "@bymorning/core/websearch"
import { type GlobalGraph, type GlobalNode, type WorkspaceProvider, makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { EventFeed } from "../event-feed.js"
import { EventHub } from "../event-hub.js"
import { WorkspaceEventBroadcaster } from "../workspace-event-broadcaster.js"
import { WorkspaceMap } from "../workspace-map.js"

/** Stable process identities consumed by every keyed Workspace factory. */
export interface ProductionGlobals<E = never> {
  readonly database?: GlobalNode<Database.Service, E>
  readonly storage?: GlobalNode<Storage.Service, E>
  readonly broadcaster: GlobalNode<WorkspaceEventBroadcaster.Service>
  readonly eventHub: GlobalNode<EventHub.Service>
  readonly oauthCallback: GlobalGraph<IntegrationOAuthCallback.Service, unknown>
  readonly httpClient: GlobalNode<HttpClient.HttpClient>
  readonly directory?: string
  readonly installPackage?: boolean
  readonly pluginRuntime?: GlobalNode<Plugin.Workspace.Service, unknown>
}

/**
 * Build inspectable handles for one production Workspace graph. The coordinator and cycle cells are deliberately
 * allocated here so each keyed factory call gets exactly one coherent set.
 */
export const nodes = <E>(globals: ProductionGlobals<E>) => {
  const bus = Bus.node
  const credential = Credential.node

  const integration = WorkspaceEventBroadcaster.integrationPublisherNode({
    bus,
    broadcaster: globals.broadcaster,
    credential,
  })
  const config = Config.node
  const webSearch = WebSearch.node
  const agent = Agent.node
  const hooks = Plugin.Hooks.node
  const instruction = InstructionDiscovery.node
  const aisdk = AISDK.node
  const shell = Shell.node
  const command = Command.node
  const catalog = Catalog.node
  const modelResolver = ModelResolver.node
  const modelPolicy = ModelPolicy.node
  const reference = Reference.node
  const job = Job.node

  const eventHub = EventHub.workspaceBridgeNode(globals.eventHub)
  const registration = WorkspaceEventBroadcaster.registrationNode({
    bus,
    broadcaster: globals.broadcaster,
  })
  const mcp = Mcp.node
  const sessionWorkspace = {
    root: LayerNode.group([
      Session.ready,
      Project.node,
      Skill.node,
      InstructionEntry.node,
      SkillInstruction.node,
      Tool.node,
      ToolOutput.node,
      Form.node,
      InstructionDiscovery.node,
    ]),
    session: Session.node,
    permission: Session.permission,
    project: Project.node,
    skill: Skill.node,
    tool: Tool.node,
    toolOutput: ToolOutput.node,
    form: Form.node,
  }
  const operations = SessionOperations.node
  const toolGateway = makeWorkspaceNode({
    service: ToolGateway.Member.Service,
    layer: Layer.unwrap(
      Effect.map(Actor.Binding.Service, (owner) => ToolGateway.Member.layer(owner.workspaceID, owner.userID)),
    ),
    deps: [Actor.binding, Config.node, Tool.node, Plugin.Hooks.node, Form.node],
  })
  const usage = Usage.node
  const toolUsage = ToolUsage.node
  const toolUsageRecorder = ToolUsage.recorder
  const auditRecorder = Audit.recorder

  const eventSource = EventFeed.sourceNode({
    bus,
    eventHub,
    session: sessionWorkspace.session,
    permission: sessionWorkspace.permission,
    form: sessionWorkspace.form,
  })
  const runtimeProvider = PluginRuntime.provider({
    session: Session.node,
    operations,
    job: Job.node,
    scheduledTask: ScheduledTask.node,
    readyAfter: eventSource,
  })
  const boot = makeWorkspaceNode({
    name: "@bymorning/server/Workspace.boot",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const pluginSupervisor = yield* Plugin.Supervisor.Service
        const currentModelPolicy = yield* ModelPolicy.Service
        yield* pluginSupervisor.awaitActivation
        yield* currentModelPolicy.flush
        // Toolkit is already active through Plugin. Await the separately
        // composed remote MCP Tool bridge before admitting requests.
        yield* Tool.ready
      }),
    ).pipe(Layer.fresh),
    deps: [Plugin.Supervisor.node, modelPolicy, Tool.node, Tool.bridge, Mcp.node, Bus.node, runtimeProvider.root],
  })

  const root = LayerNode.group([
    Actor.binding,
    registration,
    bus,
    agent,
    config,
    CodeInterpreter.node,
    // Exposed so MCP settings edits can discard Member Values entrusted to a removed or moved server.
    credential,
    integration,
    webSearch,
    hooks,
    aisdk,
    shell,
    command,
    catalog,
    modelResolver,
    Routing.node,
    reference,
    instruction,
    job,
    mcp,
    eventHub,
    sessionWorkspace.root,
    operations,
    ScheduledTask.node,
    toolGateway,
    usage,
    toolUsage,
    toolUsageRecorder,
    auditRecorder,
    Plugin.graph,
    eventSource,
    runtimeProvider.root,
    boot,
  ])

  return {
    root,
    integration,
    bus,
    sessionWorkspace,
    events: { eventHub, source: eventSource, registration },
  }
}

/** Capture application policy and bind each owner to the canonical member roots. */
export const production = <E>(
  globals: ProductionGlobals<E>,
  bindings: LayerNode.Replacements = [],
  plugin: Parameters<typeof Plugin.configured>[0],
) => {
  const member = nodes<unknown>({
    ...globals,
  })
  const shared = globals.pluginRuntime === undefined ? undefined : makeWorkspaceNode({
    service: Plugin.Workspace.Binding,
    layer: Layer.effect(Plugin.Workspace.Binding, Effect.gen(function* () {
      const owner = yield* Actor.Binding.Service
      const runtime = yield* Plugin.Workspace.Service
      return yield* runtime.acquire(owner.workspaceID)
    })),
    deps: [Actor.binding, globals.pluginRuntime],
  })
  const configured = Plugin.configured(plugin, member.root, shared)
  // Production composition can fail with shared Workspace startup errors
  // (database), which the owning member root handles via `orDie`. Widen the
  // source error to `unknown` so the shared replacement depending on the
  // unknown-error shared Binding satisfies `LayerNode.replace` without hiding
  // failures. The replacement error remains `unknown` (fail-closed).
  const catalogSource = Catalog.node as WorkspaceProvider<Catalog.Service, unknown>
  const configSource = Config.node as WorkspaceProvider<Config.Service, unknown>
  // `Provider` is invariant in `E` because of `mapLayer`. Widening `never` to
  // `unknown` here is fail-closed: it exposes shared Workspace startup
  // failures to the owning member root's `orDie` instead of hiding them. The
  // widened handle is used only for `replace`, never `mapLayer`.
  const hooksSource = Plugin.Hooks.node as unknown as WorkspaceProvider<Plugin.Hooks.Service, unknown>
  const sharedBindings = shared === undefined ? [] : [
    catalogSource.replace(makeWorkspaceNode({
      service: Catalog.Service,
      layer: Layer.effect(Catalog.Service, Effect.map(Plugin.Workspace.Binding, (runtime) => Context.get(runtime, Catalog.Service))),
      deps: [shared],
    })),
    configSource.replace(makeWorkspaceNode({
      service: Config.Service,
      layer: Layer.effect(Config.Service, Effect.map(Plugin.Workspace.Binding, (runtime) => Context.get(runtime, Config.Service))),
      deps: [shared],
    })),
    hooksSource.replace(makeWorkspaceNode({
      service: Plugin.Hooks.Service,
      layer: Layer.effect(Plugin.Hooks.Service, Effect.gen(function* () {
        const runtime = yield* Plugin.Workspace.Binding
        const local = yield* Layer.build(Plugin.Hooks.layer)
        return Plugin.Hooks.compose(Context.get(runtime, Plugin.Hooks.Service), Context.get(local, Plugin.Hooks.Service))
      })),
      deps: [shared],
    })),
  ]
  return {
    bindings,
    member: (owner: WorkspaceMap.Owner, key: WorkspaceMap.RuntimeKey) =>
      LayerNode.bind(configured, [
        ...sharedBindings,
        Actor.binding.replace(
          makeWorkspaceNode({
            service: Actor.Binding.Service,
            layer: Layer.succeed(Actor.Binding.Service, owner),
            deps: [],
          }),
        ),
        WorkspaceMap.runtime.replace(
          makeWorkspaceNode({
            service: WorkspaceMap.Runtime,
            layer: Layer.succeed(WorkspaceMap.Runtime, key),
            deps: [],
          }),
        ),
        Integration.node.replace(member.integration),
      ]),
    nodes: () => member,
  }
}
