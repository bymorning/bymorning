export * as SessionTools from "./tools.js"

import type { ToolCallPart, ToolDefinition } from "@opencode-ai/ai/schema/messages"
import { Content, Error } from "@bymorning/schema/tool"
import type { Context as ToolContext, Result as ToolResult } from "@bymorning/schema/tool"
import type { Agent as AgentSchema } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Permission as PermissionSchema } from "@bymorning/schema/permission"
import type { Session } from "@bymorning/schema/session"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Project } from "@bymorning/schema/project"
import { Context, Effect, Layer } from "effect"
import { Permission } from "../permission.js"
import { Tool } from "../tool.js"
import { Actor } from "../actor.js"
import { SessionPermission } from "./permission.js"
import { Form } from "../form.js"
import { SessionElicit } from "./elicit.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

export interface ResolveInput {
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly agent: AgentSchema.ID
  readonly messageID: MessageID
  readonly requestedModel: ModelSchema.Ref
  readonly model: ModelSchema.Ref
  readonly permissions: PermissionSchema.Ruleset
  readonly recorder?: { readonly metadata: (callID: string, metadata: Tool.Metadata) => Effect.Effect<void> }
}

export interface Interface {
  readonly resolve: (input: ResolveInput) => Effect.Effect<Snapshot, Error>
}
export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: import("../codemode/catalog.js").CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly call: ToolCallPart
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<Settlement, Error>
}
export type Settlement = ToolResult & { readonly content: ReadonlyArray<Content> }
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionTools") {}

export const make = Effect.gen(function* () {
  const tool = yield* Tool.Service
  const permission = yield* Permission.Service
  const form = yield* Form.Service
  return Service.of({
    resolve: Effect.fn("SessionTools.resolve")(function* (input: ResolveInput) {
      const snapshot = yield* tool.snapshot(input.permissions, "session")
      if (input.projectID === undefined)
        return yield* new Error({ message: "Session Tool execution requires a Project" })
      const caller = {
        type: "session" as const,
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        projectID: input.projectID,
      }
      const run = Effect.fn("SessionTools.execute")(function* (
        call: ToolCallPart,
        definitions?: ReadonlyMap<string, ToolDefinition>,
      ) {
        const callID = Tool.CallID.make(call.id)
        const callContext = {
          caller,
          id: callID,
          progress: (value: Tool.Metadata) => input.recorder?.metadata(call.id, value) ?? Effect.void,
            permission: (request: Tool.PermissionRequest) =>
            permission
              .assert({
                sessionID: input.sessionID,
                agent: input.agent,
                ...request,
                source: { type: "tool", messageID: input.messageID, callID },
              })
               .pipe(Effect.mapError((error) => new Error({ message: error.message, error }))),
            elicit: (request: Tool.ElicitInput) => {
              if (caller.type !== "session")
                return Effect.fail(new Error({ message: "Interactive elicitation requires a Session caller" }))
              return SessionElicit.ask(caller.sessionID, request).pipe(Effect.provideService(Form.Service, form))
            },
        } satisfies ToolContext
        return yield* snapshot.execute({
          call,
          context: callContext,
          definitions: definitions ?? new Map(snapshot.definitions.map((definition) => [definition.name, definition])),
        })
      })
      return Object.freeze({
        definitions: snapshot.definitions,
        codeModeCatalog: snapshot.codeModeCatalog,
        execute: Effect.fn("SessionTools.execute")(function* ({
          call,
          definitions,
        }: Parameters<Snapshot["execute"]>[0]) {
          return yield* run(call, definitions)
        }),
      })
    }),
  })
})

const baseLayer = Layer.effect(Service, make)

export const layer = (_workspaceID: Workspace.ID) => baseLayer
export const workspaceNodes = <ET, EP>(
  workspaceID: Workspace.ID,
  dependencies: {
    readonly tool: WorkspaceNode<Tool.Service, ET>
    readonly permission: WorkspaceNode<Permission.Service, EP>
    readonly form: WorkspaceNode<Form.Service, EP>
  },
) =>
  makeWorkspaceNode({ service: Service, layer: layer(workspaceID), deps: [dependencies.tool, dependencies.permission, dependencies.form] })

/** Canonical Session Tool snapshot authority. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Tool.node, SessionPermission.node, Form.node],
})
