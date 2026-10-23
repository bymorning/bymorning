import { Provider } from "@bymorning/core/provider"
import { Model } from "@bymorning/core/model"
import * as ProviderSchema from "@bymorning/schema/provider"
import { Agent } from "@bymorning/schema/agent"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Session } from "@bymorning/schema/session"
import { AIError, AuthenticationError, HttpContext } from "@opencode-ai/ai/schema/errors"
import { Message } from "@opencode-ai/ai/schema/messages"
import type { Interface } from "@opencode-ai/ai/route/client"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import { Effect, Layer, Stream } from "effect"
import { HttpBody, HttpClientRequest } from "effect/unstable/http"
import { expect, test } from "vitest"

const modelRef = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
const context = {
  purpose: "assistant" as const,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000003"),
  agent: Agent.ID.make("build"),
  requestedModel: modelRef,
  model: modelRef,
}
const runtimeModel = configure({ provider: "deepseek", baseURL: "https://provider.test/v1", auth: Auth.none }).model("deepseek-v4-pro")

test("redacts per-request header, query, and body credentials before a raw HTTP failure is observable", async () => {
  const sent: string[] = []
  const client: Interface = {
    compact: () => Effect.die("unused"),
    generate: () => Effect.die("unused"),
    stream: (_request, options) => Stream.unwrap(
      options!.http!(
        HttpClientRequest.post("https://provider.test/v1?sig=query-secret&safe=yes", {
          headers: { authorization: "Bearer header-secret", "x-custom-token": "custom-secret" },
          body: HttpBody.text('{"api_key":"body-secret"}', "application/json"),
        }),
        (request) => {
          sent.push(String(request.headers.authorization))
          return Effect.fail(new AIError({
            reason: new AuthenticationError({
              message: "provider echoed header-secret",
              body: '{"token":"custom-secret","echo":"body-secret query-secret header-secret"}',
              http: new HttpContext({
                url: "https://provider.test/v1?sig=query-secret",
                status: 401,
                headers: { "x-custom-token": "custom-secret", authorization: "Bearer header-secret" },
              }),
            }),
          }))
        },
      ).pipe(Effect.as(Stream.empty)),
    ).pipe(Stream.mapError((error) => error instanceof AIError ? error : new AIError({
      reason: new AuthenticationError({ message: error.message }),
    }))),
  }
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const selection = yield* models.get(modelRef)
      return yield* providers.stream({
        context,
        selection,
        runtimeModel,
        http: (request, handler) => handler(request),
        authentication: (request, handler) => handler(request),
        messages: [Message.user("prompt")],
      }).pipe(Stream.runDrain)
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client))), Effect.flip),
  )

  expect(sent).toEqual(["Bearer header-secret"])
  expect(error).toBeInstanceOf(Provider.FailureError)
  const observed = JSON.stringify(error)
  for (const secret of ["header-secret", "custom-secret", "body-secret", "query-secret"]) expect(observed).not.toContain(secret)
  expect(observed).toContain("<redacted>")
})
