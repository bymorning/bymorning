import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Effect, Option } from "effect"
import { Headers, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { PluginHooks } from "../../src/plugin/hooks.js"
import { SessionHttp } from "../../src/session/http.js"

const model = Model.Ref.make({ provider: Provider.Bymorning, id: "gpt-5.6-sol" })
const context = {
  purpose: "assistant" as const,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000801"),
  agent: Agent.ID.make("build"),
  requestedModel: model,
  model,
}

describe("SessionHttp", () => {
  it.effect("applies request and response hooks around the physical request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        let responseHookAuthorization: string | null | undefined
        yield* hooks.register("session", "http.request", (event) =>
          Effect.sync(() => {
            expect(event).toMatchObject({
              purpose: "assistant",
              sessionID: context.sessionID,
              agent: context.agent,
              requestedModel: model,
              model,
            })
            event.request = new Request("https://router.example.test/v1/chat", {
              method: event.request.method,
              headers: { ...Object.fromEntries(event.request.headers), "x-request-hook": "applied" },
              body: event.request.body,
              duplex: "half",
            } as RequestInit)
          }),
        )
        yield* hooks.register("session", "http.response", (event) =>
          Effect.sync(() => {
            responseHookAuthorization = event.request.headers.get("authorization")
            event.response = new Response(event.response.body, {
              status: event.response.status,
              headers: { ...Object.fromEntries(event.response.headers), "x-response-hook": "applied" },
            })
          }),
        )
        const middleware = yield* SessionHttp.middleware(context)
        const response = yield* middleware(
          HttpClientRequest.bodyText(HttpClientRequest.post("https://bymorning.ai/gateway/v1/chat"), "request body"),
          (request) => {
            if (request.body._tag !== "Uint8Array") return Effect.die(new Error(`Unexpected body: ${request.body._tag}`))
            expect(request.body.contentLength).toBe(12)
            expect(Option.getOrUndefined(Headers.get(request.headers, "content-type"))).toBe("text/plain")
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                HttpClientRequest.bearerToken(request, "deployment-secret"),
                new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
              ),
            )
          },
        )

        expect(HttpClientRequest.toUrl(response.request).pipe(Option.getOrThrow).origin).toBe(
          "https://router.example.test",
        )
        expect(Option.getOrUndefined(Headers.get(response.request.headers, "x-request-hook"))).toBe("applied")
        expect(Option.getOrUndefined(Headers.get(response.request.headers, "authorization"))).toBe(
          "Bearer deployment-secret",
        )
        expect(responseHookAuthorization).toBeNull()
        expect(Option.getOrUndefined(Headers.get(response.headers, "x-response-hook"))).toBe("applied")
        expect(yield* response.text).toBe("ok")
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("isolates concurrent Workspace hook middleware", () => {
    const run = (value: string, sessionID: Session.ID) =>
      Effect.scoped(
        Effect.gen(function* () {
          const hooks = yield* PluginHooks.Service
          yield* hooks.register("session", "http.request", (event) =>
            Effect.sync(() => {
              event.request = new Request(event.request, { headers: { "x-workspace-policy": value } })
            }),
          )
          const middleware = yield* SessionHttp.middleware({ ...context, sessionID })
          const response = yield* middleware(HttpClientRequest.get("https://bymorning.ai/test"), (request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(Option.getOrUndefined(Headers.get(request.headers, "x-workspace-policy")) ?? "missing"),
              ),
            ),
          )
          return yield* response.text
        }),
      ).pipe(Effect.provide(PluginHooks.layer))

    return Effect.all(
      [
        run("workspace-a", Session.ID.make("00000000-0000-4000-8000-000000000811")),
        run("workspace-b", Session.ID.make("00000000-0000-4000-8000-000000000812")),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.tap((results) => Effect.sync(() => expect(results).toEqual(["workspace-a", "workspace-b"]))))
  })
})
