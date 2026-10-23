import { describe, expect, it } from "@effect/vitest"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Effect, Ref, Schema } from "effect"
import { Tool } from "../src/tool.js"
import { PluginHooks } from "../src/plugin/hooks.js"

describe("CodeModeTool", () => {
  it.effect("captures namespaced executors and namespace descriptions/pinning", () =>
    Effect.gen(function* () {
      const tool: Tool.Info = {
        name: "lookup",
        description: "Lookup",
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
        options: { namespace: "demo.api", pinned: true },
        execute: ({ value }) => Effect.succeed({ output: value.toUpperCase() }),
      }
      const tools = yield* Tool.make
      yield* Tool.withSource(
        tools.transform((editor) => {
          editor.add(tool)
          editor.namespace({ name: "demo.api", description: "Demo API" })
        }),
        { type: "sdk" },
        Workspace.ID.make("wrk_test"),
      )
      const snapshot = yield* tools.snapshot([], "gateway")
      expect(snapshot.codeModeCatalog).toMatchObject({
        tools: [
          {
            name: "demo",
            tools: [{ name: "api", description: "Demo API", tools: [{ name: "lookup", pinned: true }] }],
          },
        ],
      })
      const result = yield* snapshot.execute({
        call: ToolCallPart.make({
          id: "call",
          name: "execute",
          input: { description: "Lookup value", code: 'return await tools.demo.api.lookup({ value: "hello" })' },
        }),
        context: {
          caller: { type: "gateway", userID: User.ID.make("usr_test") },
          id: Tool.CallID.make("call"),
          elicit: () => Effect.die("unused"),
          permission: () => Effect.void,
          progress: () => Effect.void,
        },
      })
      expect(result.output).toMatchObject({ output: "HELLO" })
      expect(snapshot.definitions).toHaveLength(1)
      expect(snapshot.definitions[0]?.name).toBe("execute")
    }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)),
  )

  it.effect("wraps scalar inputs in progress and includes logs", () =>
    Effect.gen(function* () {
      const progress = yield* Ref.make<Tool.Metadata[]>([])
      const scalar: Tool.Info = {
        name: "scalar",
        description: "Scalar",
        input: Schema.Finite,
        output: Schema.Finite,
        execute: (input) => Effect.succeed({ output: input }),
      }
      const tools = yield* Tool.make
      yield* Tool.withSource(
        tools.transform((editor) => editor.add(scalar)),
        { type: "sdk" },
        Workspace.ID.make("wrk_test"),
      )
      const snapshot = yield* tools.snapshot([], "gateway")
      const result = yield* snapshot.execute({
        call: ToolCallPart.make({
          id: "call",
          name: "execute",
          input: { description: "Call scalar", code: 'console.log("observed"); return await tools.scalar(3)' },
        }),
        context: {
          caller: { type: "gateway", userID: User.ID.make("usr_test") },
          id: Tool.CallID.make("call"),
          elicit: () => Effect.die("unused"),
          permission: () => Effect.void,
          progress: (value) => Ref.update(progress, (items) => [...items, value]),
        },
      })
      expect(result.output).toMatchObject({ output: "3\n\nLogs:\nobserved" })
      expect(yield* Ref.get(progress)).toContainEqual({
        toolCalls: [{ tool: "scalar", status: "running", input: { input: 3 } }],
      })
    }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)),
  )
})
