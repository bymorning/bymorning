/** Real loader-installed Plugin fixtures and deterministic lifecycle observations. */
export * as PluginScenario from "./plugin.js"

import { Model } from "@bymorning/schema/model"
import { Tokens } from "@bymorning/schema/usage"
import type { Session } from "@bymorning/schema/session"
import { NodeHttpServer } from "@effect/platform-node"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

/** Diagnostics emitted by an actual configured Plugin, never fabricated application events. */
export const Event = Schema.Struct({
  kind: Schema.Literals(["activate", "dispose", "request", "open", "usage", "close", "member"]),
  generation: Schema.Finite,
  workspaceID: Schema.String,
  id: Schema.optionalKey(Schema.String),
  domain: Schema.optionalKey(Schema.Literals(["session", "gateway"])),
  purpose: Schema.optionalKey(Schema.String),
  protocol: Schema.optionalKey(Schema.String),
  sessionID: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Model.Ref),
  publicModel: Schema.optionalKey(Schema.String),
  requestedModel: Schema.optionalKey(Schema.String),
  stream: Schema.optionalKey(Schema.Boolean),
  frozen: Schema.optionalKey(Schema.Boolean),
  tokens: Schema.optionalKey(Tokens),
  observer: Schema.optionalKey(Schema.Finite),
  caller: Schema.optionalKey(Schema.Boolean),
})

/** Parsed diagnostic observation from the fixture Plugin. */
export interface Event extends Schema.Schema.Type<typeof Event> {}

/** Correlate native Gateway calls at the external transport, preserving real request construction. */
export const transport = (sessionID: Session.ID) => Layer.effect(
  HttpClient.HttpClient,
  HttpClient.HttpClient.use((client) => Effect.succeed(HttpClient.mapRequest(client, (request) => {
    const host = new URL(request.url).hostname
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Unexpected fixture destination: ${host}`)
    if (request.headers["x-bm-test-session"] !== undefined) return request
    return request.pipe(
      HttpClientRequest.setHeader("x-bm-test-session", sessionID),
      HttpClientRequest.setHeader("x-bm-test-purpose", "assistant"),
    )
  }))),
).pipe(Layer.provide(FetchHttpClient.layer))

/** Acquire a loopback observer before the Application so Plugin cleanup remains observable at teardown. */
export const make = Effect.fn("PluginScenario.make")(function* () {
  const events: Event[] = []
  const waiters = new Set<{ readonly predicate: (event: Event) => boolean; readonly ready: Deferred.Deferred<Event> }>()
  const handler = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const event = yield* Schema.decodeUnknownEffect(Event)(yield* request.json)
    events.push(event)
    for (const waiter of waiters) {
      if (!waiter.predicate(event)) continue
      waiters.delete(waiter)
      yield* Deferred.succeed(waiter.ready, event)
    }
    return HttpServerResponse.empty({ status: 204 })
  }).pipe(Effect.orDie)
  const context = yield* Layer.build(
    HttpRouter.serve(HttpRouter.add("POST", "/", handler), { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
    ),
  )
  const endpoint = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
  const wait = Effect.fn("PluginScenario.wait")(function* (predicate: (event: Event) => boolean) {
    const existing = events.find(predicate)
    if (existing !== undefined) return existing
    const ready = yield* Deferred.make<Event>()
    const waiter = { predicate, ready }
    waiters.add(waiter)
    return yield* Deferred.await(ready).pipe(Effect.ensuring(Effect.sync(() => waiters.delete(waiter))))
  })
  return {
    endpoint,
    plugin: { package: fileURLToPath(new URL("../inference-plugin.ts", import.meta.url)), options: { endpoint } },
    member: { package: fileURLToPath(new URL("../member-plugin.ts", import.meta.url)), options: { endpoint } },
    wait,
    list: Effect.sync((): readonly Event[] => [...events]),
  }
})
