import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Tool } from "../src/tool.js"
import { SessionTools } from "../src/session/tools.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Permission } from "../src/permission.js"
import { Form } from "../src/form.js"
import { ToolDefinition, ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Session } from "@bymorning/schema/session"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000901")
const projectID = Project.ID.make("prj_00000000000000000000000901")
const agent = Agent.ID.make("build")
const messageID = MessageID.make("00000000-0000-4000-8000-000000000902")
const model = Model.Ref.make({ provider: Provider.Bymorning, id: "model" })

describe("SessionTools prepared snapshots", () => {
  it.effect("executes the captured definition and executor with the real Session caller", () => {
    let snapshots = 0
    let observed: Tool.Context | undefined
    const definition = ToolDefinition.make({
      name: "captured",
      description: "Captured",
      inputSchema: { type: "object" },
    })
    const toolLayer = Layer.succeed(
      Tool.Service,
      Tool.Service.of({
        transform: Effect.die("unused"),
        reload: Effect.die("unused"),
        snapshot: () => {
          snapshots++
          return Effect.succeed({
            definitions: [definition],
            execute: ({ context }: { context: Tool.Context }) => {
              observed = context
              return Effect.succeed({ output: "captured", content: [] })
            },
          })
        },
      } as unknown as Tool.Interface),
    )
    const hooks = Layer.succeed(PluginHooks.Service, PluginHooks.Service.of({
      register: Effect.die("unused"),
      trigger: (_domain: never, _name: never, event: never) => Effect.succeed(event),
    } as never))
    const permission = Layer.succeed(Permission.Service, Permission.Service.of({ assert: () => Effect.void } as never))
    const form = Layer.succeed(
      Form.Service,
      Form.Service.of({
        create: () => Effect.die("unused"),
        ask: () => Effect.die("unused"),
        get: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
        state: () => Effect.die("unused"),
        reply: () => Effect.die("unused"),
        cancel: () => Effect.die("unused"),
      }),
    )
    const layer = SessionTools.layer("wrk_session_tools" as never).pipe(
      Layer.provide(Layer.mergeAll(toolLayer, hooks, permission, form)),
    )
    const call = ToolCallPart.make({ id: "call-1", name: "captured", input: {} })

    return Effect.gen(function* () {
      const snapshot = yield* SessionTools.Service.use((service) => service.resolve({
        sessionID, projectID, agent, messageID, requestedModel: model, model, permissions: [],
      }))
      const result = yield* snapshot.execute({ call })
      expect(result.output).toBe("captured")
      expect(snapshots).toBe(1)
      expect(observed?.caller).toEqual({ type: "session", sessionID, projectID, agent, messageID })
      expect(snapshot.definitions).toEqual([definition])
    }).pipe(Effect.provide(layer))
  })
})
