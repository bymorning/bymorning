import { Provider } from "@bymorning/core/provider"
import { Model } from "@bymorning/core/model"
import * as ProviderSchema from "@bymorning/schema/provider"
import { Agent } from "@bymorning/schema/agent"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Session } from "@bymorning/schema/session"
import { NodeCrypto } from "@effect/platform-node"
import { LLM } from "@opencode-ai/ai"
import { TestLLM } from "@opencode-ai/ai/testing"
import * as OpenAIChat from "@opencode-ai/ai/protocols/openai-chat"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import { configure as configureGoogle } from "@opencode-ai/ai/providers/google"
import { LLMEvent } from "@opencode-ai/ai/schema/events"
import {
  AIError,
  AuthenticationError,
  HttpContext,
  RateLimitError,
} from "@opencode-ai/ai/schema/errors"
import { Message, type LLMRequest } from "@opencode-ai/ai/schema/messages"
import type { Interface } from "@opencode-ai/ai/route/client"
import { Effect, Layer, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { expect, test } from "vitest"
import { Database } from "../src/database.js"
import { Usage } from "../src/usage.js"

const modelRef = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
const context = {
  purpose: "assistant" as const,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
  agent: Agent.ID.make("build"),
  requestedModel: modelRef,
  model: modelRef,
}
const http: import("@opencode-ai/ai/route/executor").HttpMiddleware = (request, handler) => handler(request)
const runtimeModel = (id: string) =>
  configure({ provider: "deepseek", baseURL: "https://api.deepseek.com", auth: Auth.none }).model(id)

test("normalizes five OpenAI Chat calls that reuse one provider index", async () => {
  const model = OpenAIChat.route
    .with({ endpoint: { baseURL: "https://openai.test/v1/" }, auth: Auth.none })
    .model({ id: "test" })
  const request = LLM.request({ id: "request", model, prompt: "run five tools" })
  const chunks = [
    ...Array.from({ length: 5 }, (_, value) => [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${value}`,
                  type: "function" as const,
                  function: { name: "lookup", arguments: '{"value":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, type: "function" as const, function: { arguments: `${value}}` } }] },
          },
        ],
      },
    ]).flat(),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ]
  const result = await Effect.runPromise(
    Effect.reduce(
      chunks,
      () => [OpenAIChat.protocol.stream.initial(request), [] as ReadonlyArray<LLMEvent>] as const,
      ([state, emitted], chunk) =>
        OpenAIChat.protocol.stream
          .step(state, chunk)
          .pipe(Effect.map(([next, events]) => [next, [...emitted, ...events]] as const)),
    ),
  )

  const halted = OpenAIChat.protocol.stream.onHalt?.(result[0])
  const events = [...result[1], ...(halted === undefined ? [] : await Effect.runPromise(halted))]
  expect(events.filter((event) => event.type === "tool-call")).toEqual(
    Array.from({ length: 5 }, (_, value) =>
      LLMEvent.toolCall({ id: `call_${value}`, name: "lookup", input: { value } }),
    ),
  )
})

test("fails unknown Providers before execution", async () => {
  const provider = ProviderSchema.Name.make("missing")
  const error = await Effect.runPromise(
    Provider.Service.use((providers) => providers.get(provider)).pipe(Effect.provide(Provider.layer), Effect.flip),
  )
  expect(error).toEqual(new Provider.NotFoundError({ provider }))
})

test("constructs the physical Bymorning model and owns streaming", async () => {
  const requests: LLMRequest[] = []
  const client: Interface = {
    compact: () => Effect.die("unused"),
    stream: (request) => {
      requests.push(request)
      return Stream.make(LLMEvent.textDelta({ id: "text", text: "hello" }))
    },
    generate: () => Effect.die("unused"),
  }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const selected = yield* models.get({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
      return yield* providers
        .stream({
          context,
          http,
          selection: selected,
          runtimeModel: runtimeModel(selected.info.apiID),
          authentication: http,
          messages: [Message.user("prompt")],
        })
        .pipe(Stream.runCollect)
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client)))),
  )

  expect(result).toHaveLength(1)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.model).toMatchObject({ id: "deepseek-v4-pro", provider: "deepseek" })
  const route = requests[0]?.model.route
  if (route === undefined) throw new Error("request model has no route")
  const headers = await Effect.runPromise(
    route.auth.apply({
      request: {},
      method: "POST",
      url: "https://api.deepseek.com/chat/completions",
      body: "{}",
      headers: Headers.empty,
    }),
  )
  expect(headers).toEqual({})
})

test("preserves provider context overflow classification", async () => {
  const client: Interface = {
    compact: () => Effect.die("unused"),
    stream: () =>
      Stream.make(
        LLMEvent.providerError({
          message: "maximum context length exceeded",
          classification: "context-overflow",
        }),
      ),
    generate: () => Effect.die("unused"),
  }
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const model = yield* models.get({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
      return yield* providers
        .stream({
          context,
          http,
          selection: model,
          runtimeModel: runtimeModel(model.info.apiID),
          authentication: http,
          messages: [Message.user("prompt")],
        })
        .pipe(Stream.runDrain)
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client))), Effect.flip),
  )
  expect(error).toBeInstanceOf(Provider.ContextOverflowError)
})

test("surfaces event-level provider errors", async () => {
  const client: Interface = {
    compact: () => Effect.die("unused"),
    stream: () => Stream.make(LLMEvent.providerError({ message: "payload rejected", classification: "payload-too-large" })),
    generate: () => Effect.die("unused"),
  }
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const model = yield* models.get(modelRef)
      return yield* providers
        .stream({
          context,
          http,
          selection: model,
          runtimeModel: runtimeModel(model.info.apiID),
          authentication: http,
          messages: [Message.user("prompt")],
        })
        .pipe(Stream.runDrain)
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client))), Effect.flip),
  )

  expect(error).toMatchObject({ message: "payload rejected", category: "invalid-request" })
})

test("restores unknown only for implicit OpenAI Chat finishes", async () => {
  const streams: Array<ReadonlyArray<LLMEvent>> = [
    [LLMEvent.finish({ reason: { normalized: "stop" } })],
    [LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop", raw: "stop" } })],
    [LLMEvent.finish({ reason: { normalized: "stop" } })],
  ]
  const client: Interface = {
    compact: () => Effect.die("unused"),
    generate: () => Effect.die("unused"),
    stream: () => Stream.fromIterable(streams.shift() ?? []),
  }
  const results = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const selection = yield* models.get(modelRef)
      const stream = (runtimeModel: Parameters<typeof providers.stream>[0]["runtimeModel"]) =>
        providers.stream({
          context,
          http,
          selection,
          runtimeModel,
          authentication: http,
          messages: [Message.user("prompt")],
        }).pipe(Stream.runCollect)
      return yield* Effect.all([
        stream(runtimeModel("deepseek-v4-pro")),
        stream(runtimeModel("deepseek-v4-pro")),
        stream(configureGoogle({ baseURL: "https://google.test", auth: Auth.none }).model("gemini-test")),
      ], { concurrency: 1 })
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client)))),
  )

  expect(results[0][0]).toMatchObject({ type: "finish", reason: { normalized: "unknown" } })
  expect(results[1][0]).toMatchObject({ type: "step-finish", reason: { normalized: "stop", raw: "stop" } })
  expect(results[2][0]).toMatchObject({ type: "finish", reason: { normalized: "stop" } })
})

test("preserves classified AI failures for the Session retry policy", async () => {
  const failure = new AIError({
    reason: new RateLimitError({ message: "limited", retryAfterMs: 5_000 }),
  })
  const error = await Effect.runPromise(
    TestLLM.Service.use((llm) =>
      Effect.gen(function* () {
        yield* llm.push(Stream.fail(failure))
        const models = yield* Model.Service
        const providers = yield* Provider.Service
        const model = yield* models.get(modelRef)
        return yield* providers
          .stream({
            context,
            http,
            selection: model,
            runtimeModel: runtimeModel(model.info.apiID),
            authentication: http,
            messages: [Message.user("prompt")],
          })
          .pipe(Stream.runDrain)
      }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(llm.client))), Effect.flip),
    ).pipe(Effect.provide(TestLLM.layer())),
  )

  expect(error).toEqual(
    new Provider.FailureError({
      cause: failure,
      message: "limited",
      category: "rate-limit",
      provider: "deepseek",
      model: "deepseek-v4-pro",
    }),
  )
})

test("preserves redacted HTTP provider failure details with a local body cap", async () => {
  const responseBody = JSON.stringify({
    error: { message: "Invalid API key", api_key: "<redacted>" },
    padding: "x".repeat(20_000),
  })
  const failure = new AIError({
    reason: new AuthenticationError({
      message: "Provider request failed with HTTP 401",
      body: responseBody,
      http: new HttpContext({
        url: "https://provider.test",
        status: 401,
        headers: { "x-request-id": "req_123" },
      }),
    }),
  })
  const client: Interface = {
    stream: () => Stream.fail(failure),
    compact: () => Effect.die("unused"),
    generate: () => Effect.die("unused"),
  }
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const model = yield* models.get(modelRef)
      return yield* providers
        .stream({
          context,
          http,
          selection: model,
          runtimeModel: runtimeModel(model.info.apiID),
          authentication: http,
          messages: [Message.user("prompt")],
        })
        .pipe(Stream.runDrain)
    }).pipe(Effect.provide(Layer.merge(Model.layer, Provider.layerWith(client))), Effect.flip),
  )

  expect(error).toMatchObject({
    _tag: "Provider.FailureError",
    message: "Invalid API key",
    category: "auth",
    status: 401,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    requestID: "req_123",
    bodyTruncated: true,
  })
  if (!(error instanceof Provider.FailureError)) throw new Error("Expected Provider failure")
  expect(error.responseBody).toHaveLength(16_384)
  expect(error.responseBody).toContain('"api_key":"<redacted>"')
})

test("persists one session usage observation before forwarding a provider Step finish", async () => {
  const records: Array<Record<string, unknown>> = []
  const client: Interface = {
    compact: () => Effect.die("unused"),
    stream: () =>
      Stream.make(
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "content-filter" },
          usage: { inputTokens: 10, nonCachedInputTokens: 8, outputTokens: 3 },
        }),
      ),
    generate: () => Effect.die("unused"),
  }
  const database = Layer.succeed(Database.Service, Database.Service.of({
    use: ((_label: string, operation: (database: unknown) => Effect.Effect<unknown>) => operation({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed([{ workspaceID: "wrk_provider", userID: "usr_provider" }]) }) }) }),
      insert: () => ({ values: (value: Record<string, unknown>) => Effect.sync(() => records.push(value)) }),
    })) as unknown as Database.Interface["use"],
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: Effect.asVoid,
  }))
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const selected = yield* models.get(modelRef)
      return yield* providers
        .stream({
          context,
          http,
          selection: selected,
          runtimeModel: runtimeModel(selected.info.apiID),
          authentication: http,
          messages: [Message.user("prompt")],
        })
        .pipe(Stream.runCollect)
    }).pipe(
      Effect.provide(
        Layer.merge(
          Model.layer,
          Usage.providerLayer.pipe(
            Layer.provideMerge(Layer.mergeAll(Provider.layerWith(client), database, NodeCrypto.layer)),
          ),
        ),
      ),
    ),
  )

  expect(events).toHaveLength(1)
  expect(records).toEqual([
    expect.objectContaining({
      sessionID: context.sessionID,
      model: modelRef.id,
      input: 8,
      output: 3,
    }),
  ])
})
