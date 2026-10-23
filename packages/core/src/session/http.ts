export * as SessionHttp from "./http.js"

import { Cause, Effect, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { PluginHooks } from "../plugin/hooks.js"
import { Provider } from "../provider.js"
import type { HttpHandler } from "@opencode-ai/ai/route/executor"

const runHook = <A>(effect: Effect.Effect<A>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.fail(new Provider.FailureError({ cause: "Provider HTTP hook failed" })),
    ),
  )

/** Build request-local HTTP hook middleware from the current Workspace plugin authority. */
export const middleware = Effect.fn("SessionHttp.middleware")(function* (context: Provider.RequestContext) {
  const hooks = yield* PluginHooks.Service
  const http = (request: HttpClientRequest.HttpClientRequest, handler: HttpHandler) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpClientRequest.toWeb(request).pipe(
        Effect.mapError(() => new Provider.FailureError({ cause: "Provider request is invalid" })),
      )
      const requested = yield* runHook(
        hooks.trigger("session", "http.request", {
          ...context,
          request: webRequest,
        }),
      )
      const physicalRequest = HttpClientRequest.fromWeb(requested.request)
      // Buffer the hook-owned Web stream so Node fetch receives a sized body and does not require duplex.
      const requestBody =
        requested.request.body === null
          ? undefined
          : new Uint8Array(
              yield* Effect.tryPromise({
                try: () => requested.request.arrayBuffer(),
                catch: () => new Provider.FailureError({ cause: "Provider request body could not be read" }),
              }),
            )
      const response = yield* handler(
        requestBody === undefined
          ? physicalRequest
          : HttpClientRequest.bodyUint8Array(
              physicalRequest,
              requestBody,
              requested.request.headers.get("content-type") ?? undefined,
            ),
      )
      const body =
        response.status === 204 || response.status === 205 || response.status === 304
          ? null
          : yield* response.stream.pipe(Stream.toReadableStreamEffect())
      const responded = yield* runHook(
        hooks.trigger("session", "http.response", {
          ...context,
          request: requested.request,
          response: new Response(body, { status: response.status, headers: response.headers }),
        }),
      )
      return HttpClientResponse.fromWeb(response.request, responded.response)
    })
  return http
})
