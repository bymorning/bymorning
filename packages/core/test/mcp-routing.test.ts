import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Fiber, Scope } from "effect"
import * as McpClient from "../src/mcp/client.js"
import { server } from "./mcp/transport.js"

describe("McpClient elicitation routing", () => {
  it.effect("routes concurrent nested server elicitation to the originating call", () =>
    Effect.gen(function* () {
      const upstream = yield* server(
        { name: "route", description: "route", inputSchema: { type: "object" } },
        {
          elicit: async (mcp, request) => {
            const id = (request.params.arguments as { readonly id: string }).id
            if (id === "ordinary") return { content: [{ type: "text", text: "ordinary" }] }
            const response = await mcp.elicitInput({
              mode: "form",
              message: `answer ${id}`,
              requestedSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
            })
            return { content: [{ type: "text", text: `${id}:${response.action}:${response.content?.id}` }] }
          },
        },
      )
      const scope = yield* Scope.make()
      const client = yield* McpClient.connect("routing", { type: "remote", url: upstream.url }).pipe(Scope.provide(scope))
      const call = (id: string, action: "accept" | "cancel") =>
        client.call("route", { id }, undefined, () => Effect.succeed(
          action === "accept" ? { action, answer: { id } } : { action },
        ))
      // Both fibers begin together. The connection lease deliberately serializes
      // legacy SDK callbacks, so each callback sees its originating handler.
      const results = yield* Effect.all([call("first", "accept"), call("second", "cancel")], { concurrency: "unbounded" })
      expect(results.map((result) => result.content[0])).toEqual([
        { type: "text", text: "first:accept:first" },
        { type: "text", text: "second:cancel:undefined" },
      ])
      expect(upstream.calls).toBe(2)
      expect(upstream.requests.some((request) => request.method === "GET")).toBe(true)

      // An actual server-originated request fails closed without a caller
      // handler, but that does not poison the connection for ordinary calls.
      const missing = yield* client.call("route", { id: "missing" }, undefined, undefined).pipe(Effect.exit)
      expect(Exit.isFailure(missing)).toBe(true)
      const ordinary = yield* client.call("route", { id: "ordinary" }, undefined, undefined)
      expect(ordinary.content).toEqual([{ type: "text", text: "ordinary" }])
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("cancels a queued call without disturbing the active elicitation lease", () =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const upstream = yield* server(
        { name: "route", description: "route", inputSchema: { type: "object" } },
        {
          elicit: async (mcp, request) => {
            const id = (request.params.arguments as { readonly id: string }).id
            if (id === "ordinary") return { content: [{ type: "text", text: "ordinary" }] }
            if (id === "held") {
              entered.resolve()
              await release.promise
            }
            const response = await mcp.elicitInput({
              mode: "form",
              message: `answer ${id}`,
              requestedSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
            })
            return { content: [{ type: "text", text: `${id}:${response.action}` }] }
          },
        },
      )
      const scope = yield* Scope.make()
      const client = yield* McpClient.connect("routing", { type: "remote", url: upstream.url }).pipe(Scope.provide(scope))
      const handler = () => Effect.succeed({ action: "accept" as const, answer: { id: "held" } })
      const held = yield* client.call("route", { id: "held" }, undefined, handler).pipe(Effect.forkChild)
      yield* Effect.promise(() => entered.promise)
      const queued = yield* client.call("route", { id: "queued" }, undefined, handler).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(upstream.calls).toBe(1)
      yield* Fiber.interrupt(queued)
      release.resolve()
      expect((yield* Fiber.join(held)).content).toEqual([{ type: "text", text: "held:accept" }])
      expect((yield* client.call("route", { id: "ordinary" }, undefined, undefined)).content)
        .toEqual([{ type: "text", text: "ordinary" }])
      expect(upstream.calls).toBe(2)
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
