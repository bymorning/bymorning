import { NodeCrypto } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Catalog as CoreCatalog } from "@bymorning/core/catalog"
import { Config } from "@bymorning/core/config"
import { Limiter } from "@bymorning/core/limiter"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Plugin } from "@bymorning/core/plugin"
import { Usage } from "@bymorning/core/usage"
import { ConfigSchema } from "@bymorning/schema/config"
import { ModelError } from "@bymorning/schema/plugin-model"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, Option, Redacted, Ref, Schema, type Scope, Stream } from "effect"
import {
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpServerRequest,
} from "effect/unstable/http"
import type { ConfigGateway } from "@bymorning/schema/config/gateway"
import { LLMGateway } from "../../src/llm-gateway.js"
import type { GatewayInvocation } from "@bymorning/plugin/effect/model"
import * as Compatible from "@opencode-ai/ai/providers/openai-compatible"

const workspaceID = Workspace.ID.make("wrk_llm_gateway_service")
const principal = { type: "user", userID: User.ID.make("usr_llm_gateway_caller") } as const
const publicModel = "bymorning/gpt-5.6-luna"
const chat = "https://gateway.example/inference/openai/v1/chat/completions"
const googleChat = "https://gateway.example/inference/google/v1beta/models/bymorning%2Fgpt-5.6-luna:streamGenerateContent"

const model = ModelSchema.Info.make({
  id: "gpt-5.6-luna",
  provider: ProviderSchema.Bymorning,
  apiID: "upstream-luna",
  name: "Luna",
  description: "",
  status: "active",
  releaseDate: "2026-01-01",
  lastUpdated: "2026-01-01",
  openWeights: false,
  capabilities: { temperature: true, reasoning: true, attachment: false, tools: true, input: [], output: [] },
  variants: [],
  limit: { context: 1_000_000, output: 100_000 },
  cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
})

const minimalConfig = ConfigSchema.Info.make({
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
})

const unused = (..._input: ReadonlyArray<unknown>) => Effect.die("unused")

const configService = (gateway: ConfigGateway.Info | undefined, routing?: ReadonlyArray<unknown>) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.succeed(
        routing === undefined
          ? gateway === undefined
            ? minimalConfig
            : { ...minimalConfig, gateway }
          : Schema.decodeUnknownSync(ConfigSchema.Info)({
              ...minimalConfig,
              ...(gateway === undefined ? {} : { gateway }),
              routing,
            }),
      ),
      update: () => Effect.die(new Error("unused")),
      refresh: Effect.die(new Error("unused")),
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.succeed([]),
      changes: () => Stream.never,
    }),
  )

const catalogLayer = (format: "oa-compat" | "google") =>
  Layer.succeed(
  CoreCatalog.Service,
  CoreCatalog.Service.of({
    transform: unused,
    reload: unused,
    provider: {
      get: unused,
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
      directory: () => Effect.succeed([]),
      update: unused,
    },
    model: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.succeed([model]),
      available: () => Effect.succeed([model]),
      visible: () => Effect.succeed([]),
      requireAvailable: () => Effect.succeed(model),
      requireExecution: () =>
        Effect.succeed({
          implementation: { model: (id, settings) => Compatible.model(id, { ...settings, baseURL: String(settings.baseURL) }) },
          authentication: { type: "none" },
          selection: {
            info: model,
            format,
            options: {},
            settings: {},
            package: "@opencode-ai/ai/providers/openai-compatible",
          },
          package: "@opencode-ai/ai/providers/openai-compatible",
          settings: {},
          routing: { type: "fixed" },
        }),
      toggle: unused,
      setDefault: unused,
      create: unused,
      update: unused,
      delete: unused,
      default: () => Effect.succeed(model),
    },
  }),
)

const googleCatalog = catalogLayer("google")

const resolverLayer = (format: "oa-compat" | "google", url: string, headers: Record<string, string>) =>
  Layer.mock(ModelResolver.Service, {
    native: () =>
      Effect.succeed({
        model,
        format,
        baseURL: new URL(url),
        headers: Redacted.make(headers),
      }),
  })

const recordedCost = 12

const recordingUsage = (records: Ref.Ref<ReadonlyArray<Usage.RecordInput>>) => ({
  record: (input: Usage.RecordInput) => Ref.update(records, (current) => [...current, input]).pipe(Effect.as({ cost: recordedCost })),
  spend: () => Effect.succeed(0),
  list: unused,
  records: unused,
  overview: unused,
  leaderboard: unused,
})

const failingUsage = () =>
  Usage.Service.of({
    record: () => Effect.fail(new Usage.StoreError({ operation: "record", cause: "offline" })),
    spend: () => Effect.succeed(0),
    list: unused,
    records: unused,
    overview: unused,
    leaderboard: unused,
  })

interface Fixture {
  readonly http: HttpClient.HttpClient
  readonly records?: Ref.Ref<ReadonlyArray<Usage.RecordInput>>
  readonly gateway?: ConfigGateway.Info
  /** Workspace routing rules, in their transport JSON shape. */
  readonly routing?: ReadonlyArray<unknown>
  readonly resolver?: Layer.Layer<ModelResolver.Service>
  readonly usage?: Usage.Interface
  readonly catalog?: Layer.Layer<CoreCatalog.Service>
  /** Registered gateway hooks; registered after the production admission hooks. */
  readonly hooks?: (hooks: Plugin.Hooks.Interface) => Effect.Effect<void, never, Scope.Scope>
}

/** LLM Gateway over a fake Workspace lease supplying the shared Workspace authorities. */
const gatewayLayer = (fixture: Fixture) => {
  const runtime = Layer.mergeAll(
    fixture.catalog ?? catalogLayer("oa-compat"),
    fixture.resolver ?? resolverLayer("oa-compat", "https://provider.example/v1", { authorization: "Bearer provider-secret" }),
    Layer.succeed(
      Usage.Service,
      fixture.usage ??
        Usage.Service.of(recordingUsage(fixture.records ?? Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([]))),
    ),
    configService(fixture.gateway, fixture.routing),
    Plugin.Hooks.layer,
    Limiter.sharedLayer.pipe(Layer.provideMerge(Limiter.stateMemory)),
  )
  const registered = Layer.effect(
    Plugin.Hooks.Service,
    Effect.gen(function* () {
      const hooks = yield* Plugin.Hooks.Service
      const config = yield* Config.Service
      const limiter = yield* Limiter.Service
      // The production built-in admission Plugins, expressed over public Core authorities.
      yield* hooks.register("gateway", "model.invoke", (input) =>
        Effect.gen(function* () {
          yield* limiter.consume({ workspaceID: input.workspaceID, model: input.publicModel }).pipe(
            Effect.provideService(Config.Service, config),
            Effect.mapError((error) =>
              error._tag === "Limiter.StoreError"
                ? new ModelError({ reason: "unavailable", message: "Inference limit store is unavailable" })
                : new ModelError({
                    reason: error.limit === "model" ? "model" : "rate",
                    message: "Inference activity limit exceeded",
                    ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
                  }),
            ),
          )
          input.onUsage((tokens) =>
            limiter
              .charge({
                workspaceID: input.workspaceID,
                tokens: tokens.input + tokens.output + tokens.reasoning,
              })
              .pipe(
                Effect.provideService(Config.Service, config),
                Effect.mapError(() =>
                  new ModelError({ reason: "unavailable", message: "Inference limit store is unavailable" }),
                ),
              ),
          )
        }),
      )
      if (fixture.hooks !== undefined) yield* fixture.hooks(hooks)
      return hooks
    }),
  )
  const activated = registered.pipe(Layer.provideMerge(runtime))
  return LLMGateway.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(
          LLMGateway.Lease.Service,
          Effect.gen(function* () {
            const context = yield* Layer.build(activated)
            return LLMGateway.Lease.Service.of({
              acquire: () => Effect.succeed(context),
              invalidate: () => Effect.void,
            })
          }),
        ),
        Layer.succeed(HttpClient.HttpClient, fixture.http),
        NodeCrypto.layer,
      ),
    ),
  )
}

/** Provide one Service-scoped program with a fresh gateway runtime. */
const withGateway = (fixture: Fixture) => <A, E>(effect: Effect.Effect<A, E, LLMGateway.Service | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(gatewayLayer(fixture)))

const offline = HttpClient.make((request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request, description: "offline" }),
    }),
  ),
)

const jsonUpstream = (body: unknown) =>
  HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, Response.json(body))))

const text = (body: Stream.Stream<Uint8Array, LLMGateway.StreamError>) =>
  Effect.map(Stream.runCollect(body), (chunks) =>
    Array.from(chunks, (chunk) => new TextDecoder().decode(chunk)).join(""),
  )

const json = (reply: LLMGateway.Reply) => Effect.map(text(reply.body), (value): unknown => JSON.parse(value))

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  HttpServerRequest.fromWeb(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  )

const header = (headers: Headers.Headers, name: string) => Option.getOrUndefined(Headers.get(headers, name))

const authorized = { authorization: "Bearer caller-token" }


const recordingHttp = (sent: Ref.Ref<ReadonlyArray<Request>>, body: unknown) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
      yield* Ref.update(sent, (current) => [...current, web])
      return HttpClientResponse.fromWeb(request, body instanceof Response ? body : Response.json(body))
    }),
  )

const firstSent = (sent: Ref.Ref<ReadonlyArray<Request>>) =>
  Effect.gen(function* () {
    const first = (yield* Ref.get(sent))[0]
    if (first === undefined) return yield* Effect.die("Provider request missing")
    return first
  })


const googleResolver = resolverLayer("google", "https://google.example/v1beta", { "x-goog-api-key": "provider-secret" })

const sseBody = (body: string) =>
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(request, new Response(body, { headers: { "content-type": "text/event-stream" } })),
    ),
  )

describe("LLMGateway", () => {
  it.effect("routes the transformed native request before admitting immutable final facts", () => {
    const admissions: GatewayInvocation[] = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const sentRequest = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    return withGateway({
      http: recordingHttp(sentRequest, { usage: { prompt_tokens: 2, completion_tokens: 1 } }),
      records,
      hooks: (hooks) =>
        Effect.gen(function* () {
          yield* hooks.register("gateway", "model.request", (draft) =>
            Effect.sync(() => {
              draft.model = publicModel
              draft.body = { ...draft.body, messages: [{ role: "user", content: "transformed" }] }
            }),
          )
          yield* hooks.register("gateway", "model.invoke", (event) =>
            Effect.sync(() => {
              admissions.push(event)
            }),
          )
        }),
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: "missing/original", messages: [] }, authorized),
        })
        expect(reply.status).toBe(200)
        expect(admissions.length).toBe(1)
        expect(admissions[0]?.workspaceID).toBe(workspaceID)
        expect(admissions[0]?.publicModel).toBe(publicModel)
        expect(Object.isFrozen(admissions[0])).toBe(true)
        const upstream = yield* firstSent(sentRequest)
        expect(yield* Effect.promise(() => upstream.json())).toMatchObject({
          model: "upstream-luna",
          messages: [{ role: "user", content: "transformed" }],
        })
      }),
    )
  })

  it.effect("rejects malformed request-hook output as a server failure before admission", () => {
    let admitted = false
    return withGateway({
      http: offline,
      hooks: (hooks) =>
        Effect.gen(function* () {
          yield* hooks.register("gateway", "model.request", (draft) =>
            Effect.sync(() => {
              draft.body = { ...draft.body, stream: true }
            }),
          )
          yield* hooks.register("gateway", "model.invoke", () => Effect.sync(() => (admitted = true)))
        }),
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        })
        expect(reply.status).toBe(503)
        expect(admitted).toBe(false)
      }),
    )
  })

  it.effect("maps custom refusal natively and closes failed admission immediately", () => {
    let closed = 0
    return withGateway({
      http: offline,
      hooks: (hooks) =>
        Effect.gen(function* () {
          yield* hooks.register("gateway", "model.invoke", (event) =>
            Effect.gen(function* () {
              event.onClose(Effect.sync(() => { closed++ }))
              return yield* new ModelError({ reason: "denied", message: "custom policy" })
            }),
          )
        }),
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        })
        expect(reply.status).toBe(403)
        expect(closed).toBe(1)
      }),
    )
  })

  it.effect("keeps unconsumed stream resources until request Scope closes", () => {
    let closed = 0
    return withGateway({
      http: jsonUpstream({}),
      hooks: (hooks) =>
        Effect.gen(function* () {
          yield* hooks.register("gateway", "model.invoke", (event) =>
            Effect.sync(() => {
              event.onClose(Effect.sync(() => { closed++ }))
            }),
          )
        }),
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        yield* Effect.scoped(
          Effect.gen(function* () {
            const reply = yield* gateway.invoke({
              workspaceID,
              principal,
              protocol: "openai-chat",
          settle: () => Effect.void,
              request: post(chat, { model: publicModel, messages: [], stream: true }, authorized),
            })
            expect(reply.status).toBe(200)
            expect(closed).toBe(0)
          }),
        )
        expect(closed).toBe(1)
      }),
    )
  })

  it.effect("returns 503 and closes without notifying observers when non-stream Usage recording fails", () => {
    let observed = 0
    let closed = 0
    return withGateway({
      http: jsonUpstream({ usage: { prompt_tokens: 2, completion_tokens: 1 } }),
      usage: failingUsage(),
      hooks: (hooks) =>
        Effect.gen(function* () {
          yield* hooks.register("gateway", "model.invoke", (event) =>
            Effect.sync(() => {
              event.onUsage(() => Effect.sync(() => { observed++ }))
              event.onClose(Effect.sync(() => { closed++ }))
            }),
          )
        }),
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        })
        expect(reply.status).toBe(503)
        expect(observed).toBe(0)
        expect(closed).toBe(1)
      }),
    )
  })

  it.effect("lists discoverable Models in the OpenAI envelope", () =>
    withGateway({ http: offline })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.list({ workspaceID, protocol: "openai-chat" })
        expect(reply.status).toBe(200)
        expect(header(reply.headers, "content-type")).toBe("application/json")
        expect(yield* json(reply)).toMatchObject({
          object: "list",
          data: expect.arrayContaining([
            expect.objectContaining({ id: publicModel, object: "model", owned_by: "bymorning" }),
          ]),
        })
      }),
    ))

  it.effect("previews a title purpose with the default Tier and no judge exchange", () => {
    const sent = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    return withGateway({
      http: recordingHttp(sent, { usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      routing: [
        {
          match: { model: { provider: "auto", id: "general" } },
          to: {
            tiers: [
              { name: "fast", model: { provider: model.provider, id: model.id }, description: "Short questions" },
              { name: "deep", model: { provider: model.provider, id: model.id }, description: "Hard multi-step work" },
            ],
            default: "fast",
            judge: { model: { provider: model.provider, id: model.id } },
          },
        },
      ],
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const decision = yield* gateway.preview({
          workspaceID,
          principal,
          model: ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("auto"), id: "general" }),
          prompt: "Say hello",
          purpose: "title",
          reserve: () => Effect.succeed({ settle: () => Effect.void }),
        })
        expect(decision).toEqual({
          requestedModel: { provider: "auto", id: "general" },
          model: { provider: model.provider, id: model.id },
          route: { cause: "rule", rule: 0, tier: "fast" },
        })
        expect(yield* Ref.get(sent)).toEqual([])
      }),
    )
  })

  it.effect("authenticates, parses, exchanges natively, and records usage", () => {
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const sentRequest = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    return withGateway({
      http: recordingHttp(sentRequest, { usage: { prompt_tokens: 4, completion_tokens: 2 } }),
      records,
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const settled: Array<number> = []
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: (amount) => Effect.sync(() => { settled.push(amount) }),
          request: post(
            chat,
            { model: publicModel, messages: [] },
            { ...authorized, "x-api-key": "caller-api-key", cookie: "caller-cookie", "x-client": "preserved" },
          ),
        })
        expect(reply.status).toBe(200)
        expect(yield* json(reply)).toEqual({ usage: { prompt_tokens: 4, completion_tokens: 2 } })
        const upstream = yield* firstSent(sentRequest)
        expect(upstream.url).toBe("https://provider.example/v1/chat/completions")
        expect(upstream.headers.get("authorization")).toBe("Bearer provider-secret")
        expect(upstream.headers.get("x-api-key")).toBeNull()
        expect(upstream.headers.get("cookie")).toBeNull()
        expect(upstream.headers.get("x-client")).toBe("preserved")
        expect(yield* Effect.promise(() => upstream.json())).toMatchObject({ model: "upstream-luna" })
        expect(yield* Ref.get(records)).toMatchObject([
          { model: publicModel, upstreamModel: "upstream-luna", tokens: { input: 4, output: 2 } },
        ])
        expect(settled).toEqual([recordedCost])
      }),
    )
  })


  it.effect("keeps the leased runtime available while a streaming body is consumed", () => {
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return withGateway({
      http: sseBody('data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'),
      records,
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [], stream: true }, authorized),
        })
        expect(yield* text(reply.body)).toContain("prompt_tokens")
        expect(yield* Ref.get(records)).toMatchObject([{ tokens: { input: 4, output: 2 } }])
      }),
    )
  })

  it.effect("parses Google model actions from the path and rejects malformed actions natively", () => {
    const sentRequest = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    return withGateway({
      http: recordingHttp(sentRequest, Response.json({ ok: true })),
      resolver: googleResolver,
      catalog: googleCatalog,
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const reply = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "google-generate",
          settle: () => Effect.void,
          request: post(googleChat, { contents: [] }, { "x-goog-api-key": "caller-token" }),
        })
        expect(reply.status).toBe(200)
        expect(yield* json(reply)).toEqual({ ok: true })
        const upstream = yield* firstSent(sentRequest)
        expect(upstream.url).toBe(
          "https://google.example/v1beta/models/upstream-luna:streamGenerateContent?alt=sse",
        )
        expect(upstream.headers.get("x-goog-api-key")).toBe("provider-secret")
        const malformed = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "google-generate",
          settle: () => Effect.void,
          request: post("https://gateway.example/inference/google/v1beta/models/x:unknown", {}, authorized),
        })
        expect(malformed.status).toBe(400)
        expect(yield* json(malformed)).toMatchObject({
          error: { code: 400, message: "Invalid Google model action", status: "INVALID_ARGUMENT" },
        })
        expect(yield* Ref.get(sentRequest)).toHaveLength(1)
      }),
    )
  })

  it.effect("renders Gateway denial and upstream failure natively", () =>
    withGateway({ http: offline, gateway: { models: [] } })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const forbidden = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        })
        expect(forbidden.status).toBe(403)
        expect(yield* json(forbidden)).toMatchObject({
          error: { type: "permission_error", message: "Request denied" },
        })
      }),
    ))

  it.effect("renders upstream failure and invalid JSON natively", () =>
    withGateway({ http: offline })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const failed = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        })
        expect(failed.status).toBe(502)
        expect(yield* json(failed)).toMatchObject({
          error: { type: "server_error", message: "Upstream request failed" },
        })
        const invalid = yield* gateway.invoke({
          workspaceID,
          principal,
          protocol: "openai-chat",
          settle: () => Effect.void,
          request: HttpServerRequest.fromWeb(
            new Request(chat, { method: "POST", headers: authorized, body: "not json" }),
          ),
        })
        expect(invalid.status).toBe(400)
        expect(yield* json(invalid)).toMatchObject({
          error: { type: "invalid_request_error", message: "Invalid JSON body" },
        })
      }),
    ))



  it.effect("renders a rounded Retry-After header for a limiter refusal", () =>
    withGateway({
      http: jsonUpstream({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      gateway: { limits: { rpm: 1 } },
    })(
      Effect.gen(function* () {
        const gateway = yield* LLMGateway.Service
        const input = {
          workspaceID,
          principal,
          protocol: "openai-chat" as const,
          request: post(chat, { model: publicModel, messages: [] }, authorized),
        }
        yield* gateway.invoke({ ...input, settle: () => Effect.void })
        const refused = yield* gateway.invoke({ ...input, settle: () => Effect.void })
        expect(refused.status).toBe(429)
        const value = header(refused.headers, "retry-after")
        expect(value).toMatch(/^\d+$/)
        expect(Number(value)).toBeGreaterThanOrEqual(0)
      }),
    ))

})
