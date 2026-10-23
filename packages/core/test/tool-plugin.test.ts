import { describe, expect, it } from "@effect/vitest"
import { fromPromise } from "@bymorning/plugin/promise/adapter"
import { Workspace } from "@bymorning/schema/workspace"
import { User } from "@bymorning/schema/user"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Effect, Layer, Schema, Scope, Exit } from "effect"
import { Tool } from "../src/tool.js"
import { PluginHost } from "../src/plugin/host.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Storage } from "../src/storage.js"

const storageLayer = Storage.layer({
  configure: (editor) => {
    const provider = Storage.memory()
    editor.add(provider)
    editor.default.set(provider.id)
  },
})
const layers = Layer.provideMerge(Tool.layer, Layer.mergeAll(PluginHooks.layer, storageLayer))

describe("Tool plugin bridge", () => {
  it.effect("replays Promise editors, retains executable updates and tracks admitted contributions only", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const storage = yield* Storage.Service
      const hooks = yield* PluginHooks.Service
      // Unused capabilities are deliberately unavailable. This is a focused host
      // adapter test, not a fabricated Application/API integration fixture.
      const unused = new Proxy(
        () => {
          throw new Error("Unexpected capability")
        },
        { get: () => unused },
      )
      const services = new Proxy(
        { workspaceID: Workspace.ID.make("wrk_tool_plugin"), tool: tools, storage, shellHooks: hooks },
        {
          get: (target, key) => (Reflect.has(target, key) ? Reflect.get(target, key) : unused),
        },
      ) as unknown as PluginHost.HostServices
      const contribution: PluginHost.Contribution = { integrations: new Map(), tools: new Map() }
      const host = PluginHost.make(services, "tool.promise", {}, { type: "sdk" }, contribution)
      const scope = yield* Scope.make()
      let label = "first"
      let registration: { dispose(): Promise<void> } | undefined
      yield* fromPromise({
        id: "tool.promise",
        async setup(context) {
          registration = await context.tool.transform((editor) => {
            editor.namespace({ name: "demo", description: "Demo namespace" })
            editor.add({
              name: "value",
              description: label,
              input: Schema.Struct({}),
              output: Schema.String,
              options: { namespace: "demo", codemode: false },
              async execute() {
                return { output: "original" }
              },
            })
            editor.add({
              name: "",
              description: "invalid",
              input: Schema.Struct({}),
              async execute() {
                return {}
              },
            })
            editor.update("demo_value", (tool) => {
              tool.description = label
            })
            const original = editor.get("demo_value")!
            expect(editor.list()).toHaveLength(1)
            editor.update("demo_value", (tool) => {
              tool.execute = async (input, context) => {
                const result = await original.execute(input, context)
                return { output: `${result.output}:updated` }
              }
            })
          })
        },
      })
        .effect(host)
        .pipe(Scope.provide(scope))
      const captured = yield* tools.snapshot([], "gateway")
      expect([...contribution.tools.values()].map((values) => [...values])).toEqual([["demo.value"]])
      label = "replayed"
      yield* tools.transform(() => {})
      expect((yield* tools.snapshot([], "gateway")).definitions[0]?.description).toBe("replayed")
      const result = yield* captured.execute({
        call: ToolCallPart.make({ id: "call", name: "demo_value", input: {} }),
        context: {
          caller: { type: "gateway", userID: User.ID.make("usr_tool_plugin") },
          id: Tool.CallID.make("call"),
          progress: () => Effect.void,
          elicit: () => Effect.die("unused"),
          permission: () => Effect.void,
        },
      })
      expect(result.output).toBe("original:updated")
      yield* Effect.promise(() => registration!.dispose())
      expect(contribution.tools.size).toBe(0)
      expect((yield* tools.snapshot([], "gateway")).definitions.map((tool) => tool.name)).toEqual(["execute"])
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.scoped, Effect.provide(layers)),
  )
})
