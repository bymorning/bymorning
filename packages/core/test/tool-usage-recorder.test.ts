import { Database } from "@bymorning/core/database"
import { PluginHooks } from "@bymorning/core/plugin/hooks"
import { ToolUsage } from "@bymorning/core/tool-usage"
import { Agent } from "@bymorning/schema/agent"
import * as Message from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Tool } from "@bymorning/schema/tool"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect } from "vitest"

const workspaceID = Workspace.ID.make("wrk_tool_usage_recorder")
const userID = User.ID.make("usr_tool_usage_recorder")
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000101")
const model = { provider: Provider.Bymorning, id: "test" }
const sessionEvent = {
  tool: "read",
  sessionID,
  agent: Agent.DefaultID,
  messageID: Message.ID.make("00000000-0000-4000-8000-000000000102"),
  requestedModel: model,
  model,
  id: Tool.CallID.make("call_session_usage"),
  input: { path: "/private/input" },
  source: "session",
  mode: "host",
  duration: 123,
  callID: "must-not-be-recorded",
}
const gatewayEvent = {
  id: Tool.CallID.make("call_gateway_usage"),
  userID,
  tool: "gateway.search",
  input: { query: "private" },
  source: "gateway",
  mode: "sandbox",
  duration: 456,
  callID: "must-not-be-recorded",
}

const makeFixture = () => {
  const recorded: Array<Record<string, unknown>> = []
  const database = Database.Service.of({
    use: ((label: string, operation: (db: unknown) => Effect.Effect<unknown>) => {
      if (label === "toolUsageRecorderSession") {
        const db = {
          select: () => ({
            from: () => ({ where: () => ({ limit: () => Effect.succeed([{ userID }]) }) }),
          }),
        }
        return operation(db)
      }
      if (label === "ToolUsage.record") {
        const db = {
          insert: () => ({
            values: (value: Record<string, unknown>) => Effect.sync(() => recorded.push(value)),
          }),
        }
        return operation(db)
      }
      return Effect.die(`unexpected database use: ${label}`)
    }) as unknown as Database.Interface["use"],
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: (effect) => Effect.asVoid(effect),
  })
  const dependencies = Layer.merge(PluginHooks.layer, Layer.succeed(Database.Service, database))
  return {
    recorded,
    layer: ToolUsage.recorderLayer(workspaceID).pipe(Layer.provideMerge(dependencies)),
  }
}

describe("ToolUsage.recorderLayer", () => {
  it.effect("records Session completions and errors with the resolved User and no sensitive execution payload", () => {
    const { layer, recorded } = makeFixture()
    return Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service

        yield* hooks.trigger("tool", "execute.before", sessionEvent)
        expect(recorded).toEqual([])

        yield* hooks.trigger("tool", "execute.after", {
          ...sessionEvent,
          status: "completed",
          result: { output: "private result" },
        })
        expect(recorded).toHaveLength(1)
        expect(recorded[0]).toMatchObject({ workspaceID, userID, sessionID, tool: "read", status: "completed" })

        yield* hooks.trigger("tool", "execute.after", {
          ...sessionEvent,
          status: "error",
          error: new Tool.Error({ message: "private error" }),
        })
        expect(recorded).toHaveLength(2)
        expect(recorded[1]).toMatchObject({ workspaceID, userID, sessionID, tool: "read", status: "error" })
      }),
    ).pipe(Effect.provide(layer))
  })

  it.effect("records gateway settlement with its User, a null Session, and nothing from its before hook", () => {
    const { layer, recorded } = makeFixture()
    return Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service

        yield* hooks.trigger("gateway", "tool.execute.before", gatewayEvent)
        expect(recorded).toEqual([])

        yield* hooks.trigger("gateway", "tool.execute.after", {
          ...gatewayEvent,
          status: "completed",
          result: { output: "private result" },
        })
        expect(recorded).toHaveLength(1)
        expect(recorded[0]).toMatchObject({
          workspaceID,
          userID,
          sessionID: null,
          tool: "gateway.search",
          status: "completed",
        })
      }),
    ).pipe(Effect.provide(layer))
  })
})
