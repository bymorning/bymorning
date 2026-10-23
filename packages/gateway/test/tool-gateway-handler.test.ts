import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import type { Tool } from "@bymorning/core/tool"
import { ToolGateway, UnavailableError } from "../src/tool-gateway.js"
import { CurrentActor } from "../src/contract.js"
import { Runtime } from "../src/tool-gateway/runtime.js"
import type { Member } from "../src/tool-gateway/member.js"

const actor = {
  type: "user" as const,
  properties: {
    workspaceID: "wrk_tool_gateway_handler",
    accountID: "acc_tool_gateway_handler",
    userID: "usr_tool_gateway_handler",
  },
} as never

const post = (body: unknown) =>
  HttpServerRequest.fromWeb(
    new Request("https://gateway.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    }),
  )

/** Member facade whose lifecycle events are observed without running any Tool. */
const member = (order: Ref.Ref<ReadonlyArray<string>>): Member.Interface => ({
  snapshot: Ref.update(order, (list) => [...list, "snapshot"]).pipe(
    Effect.as({
      definitions: [] as Tool.Snapshot["definitions"],
      execute: () => Effect.die("unused"),
    }),
  ),
  call: () => Effect.die("unused"),
  resume: () => Effect.die("unused"),
})

const run = (runtimes: Layer.Layer<Runtime.Service>) =>
  Effect.gen(function* () {
    const gateway = yield* ToolGateway.Service
    return yield* gateway.handle(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
  }).pipe(
    Effect.provideService(CurrentActor, actor),
    Effect.scoped,
    Effect.provide(ToolGateway.layer.pipe(Layer.provide(runtimes))),
  )

describe("ToolGateway handler", () => {
  it.effect("maps an unavailable retained runtime to the sanitized JSON-RPC 503 reply", () => {
    const unavailable = Layer.succeed(
      Runtime.Service,
      Runtime.Service.of({ acquire: () => Effect.fail(new UnavailableError()) }),
    )
    return Effect.gen(function* () {
      const response = yield* run(unavailable)
      expect(response.status).toBe(503)
      const web = HttpServerResponse.toWeb(response)
      const body = yield* Effect.promise(() => web.json())
      expect(body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32003, message: "Service unavailable" } })
    })
  })

  it.effect("keeps the acquisition Scope alive across dispatch and releases it after the request", () => {
    const order = Ref.makeUnsafe<ReadonlyArray<string>>([])
    const retained = Layer.succeed(
      Runtime.Service,
      Runtime.Service.of({
        acquire: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Ref.update(order, (list) => [...list, "release"]))
            yield* Ref.update(order, (list) => [...list, "acquire"])
            return member(order)
          }),
      }),
    )
    return Effect.gen(function* () {
      const response = yield* run(retained)
      expect(response.status).toBe(200)
      // The Scope outlived activation and SDK dispatch; finalization is last.
      expect(yield* Ref.get(order)).toEqual(["acquire", "snapshot", "release"])
    })
  })
})
