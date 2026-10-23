export * as WorkspaceMap from "./workspace-map.js"

import { Agent } from "@bymorning/core/agent"
import { Permission } from "@bymorning/core/permission"
import { Form } from "@bymorning/core/form"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Duration, Effect, Layer, LayerMap } from "effect"
import { Integration } from "@bymorning/core/integration"
import { Credential } from "@bymorning/core/credential"
import { Session } from "@bymorning/core/session"
import { Usage } from "@bymorning/core/usage"
import { WebSearch } from "@bymorning/core/websearch"
import { Config } from "@bymorning/core/config"
import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { Project } from "@bymorning/core/project"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { Skill } from "@bymorning/core/skill"
import { InstructionEntry } from "@bymorning/core/instruction-entry"
import { SkillInstruction } from "@bymorning/core/skill-instruction"
import { Bus } from "@bymorning/core/bus"
import { AISDK } from "@bymorning/core/aisdk"
import { Catalog } from "@bymorning/core/catalog"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Command } from "@bymorning/core/command"
import { Plugin } from "@bymorning/core/plugin"
import { Reference } from "@bymorning/core/reference"
import { InstructionDiscovery } from "@bymorning/core/instruction-discovery"
import { SessionOperations } from "@bymorning/core/session-operations"
import { Shell } from "@bymorning/core/shell"
import { Tool } from "@bymorning/core/tool"
import { Policy } from "@bymorning/core/policy"
import { ManagedPolicy } from "@bymorning/core/managed-policy"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { Mcp } from "@bymorning/core/mcp"
import { Job } from "@bymorning/core/job"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Data } from "effect"
import { EventHub } from "./event-hub.js"
import { ToolUsage } from "@bymorning/core/tool-usage"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
/** Stable structural identity of one account's mutable graph in a Workspace. */
export class RuntimeKey extends Data.Class<{
  readonly workspaceID: Workspace.ID
  readonly accountID: Account.ID
}> {}

/** Private member construction binding used only by server-side registrations. */
export class Runtime extends Context.Service<Runtime, RuntimeKey>()("@bymorning/server/WorkspaceMap/Runtime") {}
export const runtime = LayerNode.unbound<Runtime, RuntimeKey, typeof tags.values.workspace>(
  Runtime,
  tags.values.workspace,
)

export interface Owner {
  readonly workspaceID: Workspace.ID
  readonly accountID: Account.ID
  readonly userID: User.ID
  readonly role: User.Role
}

/** One member-root recipe and the application policy captured at map declaration. */
export interface Input<E> {
  /** The complete member root may retain private startup/cycle services. */
  readonly member: (owner: Owner, key: RuntimeKey) => LayerNode.Graph<any, E>
  readonly bindings: LayerNode.Replacements
}

export type Capabilities =
  | import("@bymorning/core/actor").Binding.Service
  | Bus.Service
  | AISDK.Service
  | Agent.Service
  | Config.Service
  | CodeInterpreter.Service
  | Plugin.Supervisor.Service
  | Project.Service
  | Skill.Service
  | InstructionEntry.Service
  | SkillInstruction.Service
  | Permission.Service
  | Form.Service
  | Integration.Service
  | Credential.Service
  | Job.Service
  | Catalog.Service
  | ModelResolver.Service
  | Command.Service
  | Plugin.Service
  | Plugin.Hooks.Service
  | Reference.Service
  | InstructionDiscovery.Service
  | SessionOperations.Service
  | Shell.Service
  | Tool.Service
  | Policy.Service
  | ManagedPolicy.Service
  | ToolGateway.Member.Service
  | WebSearch.Service
  | Session.Service
  | ScheduledTask.Service
  | Usage.Service
  | ToolUsage.Service
  | EventHub.Service
  | Mcp.Service

export interface Interface {
  readonly get: (owner: Owner) => Layer.Layer<Capabilities>
  readonly contextEffect: (
    owner: Owner,
  ) => Effect.Effect<Context.Context<Capabilities>, never, import("effect").Scope.Scope>
  readonly invalidate: (owner: Owner) => Effect.Effect<void>
}

/** Process-lifetime map of coherent Workspace-owned capability graphs. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/server/WorkspaceMap") {
  /** Acquire the complete capability Layer for one persisted owner. */
  static get(owner: Owner) {
    return Layer.unwrap(Effect.map(Service, (workspaces) => workspaces.get(owner)))
  }
}

/** Canonical production node. Global closure, keyed compilation, and process memoization stay owner-local. */
export const node = <E>(input: Input<E>): LayerNode.Provider<Service, never, typeof tags.values.global> => {
  return makeGlobalNode({
    service: Service,
    layer: layerFromFactory({
      services: (owner, key) => {
        // The complete member graph is compiled against the owning map's memo map.
        // Global declarations (and their closure) reuse that map; all remaining
        // declarations receive a fresh member memo map in LayerNode.compile.
        return LayerNode.compile(LayerNode.bind(input.member(owner, key), input.bindings), {
          shared: tags.values.global,
        }).pipe(Layer.orDie)
      },
    }),
    deps: [],
  })
}

/** Lower-level constructor for focused lifecycle tests that intentionally use arbitrary Layers. */
export const layerFromFactory = <R = never>(input: {
  readonly services: (owner: Owner, key: RuntimeKey) => Layer.Layer<Capabilities, unknown, R>
}): Layer.Layer<Service, never, R> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const owners = new Map<string, Owner>()
      const mapped = yield* LayerMap.make(
        (key: RuntimeKey) => {
          const owner = owners.get(`${key.workspaceID}\0${key.accountID}`)
          if (owner === undefined) throw new Error(`Runtime owner is unavailable: ${key.workspaceID}/${key.accountID}`)
          return input.services(owner, key).pipe(Layer.orDie)
        },
        { idleTimeToLive: Duration.infinity },
      )
      /**
       * Record the verified owner for one member graph. A Role change retires the
       * retained graph so the next acquisition rebuilds it with the new Role;
       * in-flight work settles with the Role captured at its graph's construction.
       */
      const rebind = (owner: Owner): Effect.Effect<RuntimeKey> =>
        Effect.suspend(() => {
          const key = new RuntimeKey({ workspaceID: owner.workspaceID, accountID: owner.accountID })
          const id = `${key.workspaceID}\0${key.accountID}`
          const current = owners.get(id)
          if (current !== undefined && current.userID !== owner.userID) {
            return Effect.die(new Error(`Runtime owner changed: ${key.workspaceID}/${key.accountID}`))
          }
          const rotate = current !== undefined && current.role !== owner.role
          owners.set(id, owner)
          return (rotate ? mapped.invalidate(key) : Effect.void).pipe(Effect.as(key))
        })
      return Service.of({
        get: (owner) => Layer.unwrap(Effect.map(rebind(owner), (key) => mapped.get(key))),
        contextEffect: (owner) =>
          Effect.flatMap(rebind(owner), (key) => mapped.contextEffect(key)),
        invalidate: (owner) => Effect.flatMap(rebind(owner), (key) => mapped.invalidate(key)),
      })
    }),
  )
