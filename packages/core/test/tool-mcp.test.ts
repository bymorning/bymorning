import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { Tool } from "../src/tool.js"
import { Mcp } from "../src/mcp.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Bus } from "../src/bus.js"
import { User } from "@bymorning/schema/user"

describe("MCP Tool adapter", () => {
  it.effect("preserves discovered MCP gateway visibility", () =>
    Effect.gen(function* () {
      let calls = 0
      const remote: Mcp.RemoteTool = {
        server: "mail.example",
        name: "search.messages",
        action: "mail_example_search_messages",
        description: "Search mail",
        codemode: false,
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      }
      const mcp = {
        reload: () => Effect.void,
        tools: () =>
          Effect.sync(() => {
            calls += 1
            return [remote]
          }),
        servers: () => Effect.succeed([]),
        callTool: () => Effect.succeed({ content: [{ type: "text" as const, text: "ok" }] }),
      } as unknown as Parameters<typeof Mcp.Service.of>[0]
      const bus = { subscribe: () => Effect.succeed(Stream.never) } as unknown as Bus.Interface
      const ready = Layer.provideMerge(Tool.discovery, Tool.layer.pipe(Layer.provide(PluginHooks.layer))).pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(Mcp.Service, mcp), Layer.succeed(Bus.Service, bus))),
      )
      const { snapshot, actions } = yield* Effect.gen(function* () {
        const tools = yield* Tool.Service
        return { snapshot: yield* tools.snapshot([], "gateway"), actions: yield* tools.actions() }
      }).pipe(Effect.provide(ready), Effect.scoped)
      expect(calls).toBe(1)
      const names = snapshot.definitions.map((definition) => definition.name)
      expect(names).toContain("mail_example_search_messages")
      expect(names).toContain("execute")
      expect(JSON.stringify(snapshot.codeModeCatalog)).not.toContain("toolkit.mcp.connect")
      expect(actions).toContainEqual({
        name: "mail_example_search_messages",
        action: "mail_example_search_messages",
        description: "Search mail",
      })
      const callID = Tool.CallID.make("call_mcp")
      const result = yield* snapshot.execute({
        call: { type: "tool-call", id: callID, name: "mail_example_search_messages", input: { query: "mail" } },
        context: { id: callID, caller: { type: "gateway", userID: User.ID.make("usr_mcp") }, progress: () => Effect.void, permission: () => Effect.void, elicit: () => Effect.die("unused") },
      })
      expect(result.output).toBe("ok")
    }),
  )
})
