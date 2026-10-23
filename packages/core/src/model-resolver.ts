export * as ModelResolver from "./model-resolver.js"

import { LanguageModel } from "@opencode-ai/ai/schema/options"
import { Auth } from "@opencode-ai/ai/route/auth"
import { LLM } from "@opencode-ai/ai"
import type { HttpMiddleware } from "@opencode-ai/ai/route/executor"
import { ModelSchema } from "@bymorning/schema/model"
import { ProviderSchema } from "@bymorning/schema/provider"
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Catalog } from "./catalog.js"
import { Integration } from "./integration.js"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { middleware } from "./provider/bedrock-auth.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
export class ResolutionError extends Schema.TaggedError<ResolutionError>()("ModelResolver.ResolutionError", {
  model: ModelSchema.Ref,
  reason: Schema.Literals([
    "unavailable",
    "unknown-provider",
    "unknown-model",
    "invalid-route",
    "transport-unsupported",
    "region-unsupported",
    "connection-unavailable",
  ]),
}) {}

export interface ResolveInput {
  readonly model: ModelSchema.Ref
  readonly baseURL?: string
  readonly headers: Readonly<Record<string, string>>
}

export interface Resolved {
  readonly ref: ModelSchema.Ref
  readonly selection: Model.Selection
  readonly runtimeModel: LanguageModel
  readonly authentication: HttpMiddleware
}

/** Prepare an immutable catalog execution without selecting it again. */
export interface PrepareInput {
  readonly execution: Catalog.Execution
  readonly baseURL?: string
  readonly headers: Readonly<Record<string, string>>
}

/** Provider-native destination resolved from one Catalog execution. */
export interface Native {
  readonly model: ModelSchema.Info
  readonly format: ProviderSchema.Format
  /**
   * Effective fixed endpoint from the Catalog execution.
   *
   * Taken only from `execution.routing.baseURL`. Credentials still resolve
   * through Integration; a missing endpoint fails closed rather than using a
   * bundled production URL.
   */
  readonly baseURL: URL
  readonly headers: Redacted.Redacted<Readonly<Record<string, string>>>
  /** Native wire defaults encoded by the installed adapter, before caller overrides. */
  readonly defaults?: Readonly<Record<string, unknown>>
}

export interface Interface {
  readonly resolve: (input: ResolveInput) => Effect.Effect<Resolved, ResolutionError>
  readonly prepare: (input: PrepareInput) => Effect.Effect<Resolved, ResolutionError>
  readonly native: (execution: Catalog.Execution) => Effect.Effect<Native, ResolutionError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ModelResolver") {}

/**
 * AWS_USE_FIPS_ENDPOINT honors the AWS SDK's boolean env semantics: only the
 * string "true" (any case) selects FIPS-designated endpoints.
 */
const useFipsEndpoint = () => process.env.AWS_USE_FIPS_ENDPOINT?.toLowerCase() === "true"

/**
 * Endpoint override for in-process-signed Bedrock model traffic, which never
 * passes through an AWS SDK client and so never sees the SDK's own
 * AWS_USE_FIPS_ENDPOINT handling. Converse reroutes to the FIPS-designated
 * Bedrock Runtime hostname (SigV4 service stays "bedrock"); Bedrock Mantle has
 * no FIPS-designated endpoint and always keeps its standard hostname.
 */
const bedrockEndpoint = (plan: Catalog.Execution): { readonly baseURL?: string } =>
  plan.routing.type === "aws-bedrock" &&
  plan.package === "@opencode-ai/ai/providers/amazon-bedrock" &&
  useFipsEndpoint()
    ? { baseURL: ProviderSchema.bedrockRuntimeAPI(plan.routing.region, { fips: true }) }
    : {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const native = Effect.fn("ModelResolver.native")(function* (execution: Catalog.Execution) {
      const model = execution.selection.info
      if (execution.routing.type !== "fixed")
        return yield* new ResolutionError({ model, reason: "transport-unsupported" })
      const baseURL = execution.routing.baseURL
      if (baseURL === undefined)
        return yield* new ResolutionError({ model, reason: "transport-unsupported" })
      const prepared = yield* prepare({ execution, headers: {} })
      const body = yield* prepared.runtimeModel.route.body.from(LLM.request({
        model: prepared.runtimeModel,
        prompt: "",
        providerOptions: execution.selection.options,
        ...(prepared.runtimeModel.route.defaults.generation === undefined ? {} : { generation: prepared.runtimeModel.route.defaults.generation }),
      })).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))),
        Effect.mapError(() => new ResolutionError({ model, reason: "invalid-route" })),
      )
      // Preserve the caller's native request envelope; only adapter-encoded defaults are inherited.
      const envelope = new Set(["model", "messages", "input", "system", "tools", "tool_choice", "contents", "stream", "stream_options"])
      const defaults = Object.fromEntries(Object.entries({ ...body, ...prepared.runtimeModel.route.defaults.http?.body }).filter(([key]) => !envelope.has(key)))
      const headers = prepared.runtimeModel.route.defaults.headers ?? {}
      const auth = execution.authentication
      if (auth.type === "none") return { model, format: execution.selection.format, baseURL, defaults, headers: Redacted.make(headers) }
      const integrationID = Integration.ID.make(auth.integration)
      const integration = yield* integrations
        .get(integrationID)
        .pipe(Effect.mapError(() => new ResolutionError({ model, reason: "connection-unavailable" })))
      if (integration === undefined) return yield* new ResolutionError({ model, reason: "connection-unavailable" })
      const connection = yield* integrations.connection.active(integrationID)
      if (connection === undefined) return yield* new ResolutionError({ model, reason: "connection-unavailable" })
      const credential = yield* integrations.connection
        .resolve(connection)
        .pipe(Effect.mapError(() => new ResolutionError({ model, reason: "connection-unavailable" })))
      if (credential === undefined || credential.type !== "key")
        return yield* new ResolutionError({ model, reason: "connection-unavailable" })
      return {
        model,
        format: execution.selection.format,
        baseURL,
        defaults,
        headers: Redacted.make({ ...headers, [auth.header]: `${auth.prefix ?? ""}${credential.key}` }),
      }
    })

    const prepare = Effect.fn("ModelResolver.prepare")(function* (input: PrepareInput) {
      const plan = input.execution
      const model = plan.selection.info
      if (plan.routing.type === "fixed" && plan.routing.baseURL === undefined)
        return yield* new ResolutionError({ model, reason: "transport-unsupported" })
      const selection = plan.selection
      const implementation = plan.implementation
      // Routing owns endpoints. Regional adapters derive theirs from the selected
      // AWS region; a source template must never become a literal request URL.
      const { baseURL: _baseURL, ...settings } = plan.settings
      const selected = yield* Effect.try({
        try: () =>
          implementation.model(selection.info.apiID, {
            ...settings,
            ...(plan.routing.type === "fixed" && plan.routing.baseURL ? { baseURL: plan.routing.baseURL.toString().replace(/\/$/, "") } : {}),
            ...(plan.routing.type === "aws-bedrock"
              ? { region: plan.routing.region, auth: "sigv4", ...bedrockEndpoint(plan) }
              : {}),
            provider: model.provider,
            providerOptions: selection.options,
          }),
        catch: () => new ResolutionError({ model, reason: "invalid-route" }),
      })
      const canonicalAPI = selected.route.endpoint.baseURL
      if (!canonicalAPI) return yield* new ResolutionError({ model, reason: "invalid-route" })
      const urls = yield* Effect.try({
        try: () => ({ canonical: new URL(canonicalAPI), planned: new URL(input.baseURL ?? canonicalAPI) }),
        catch: () => new ResolutionError({ model, reason: "invalid-route" }),
      })
      // Authentication runs after Session HTTP hooks, on the final bytes and origin.
      const runtimeModel = LanguageModel.update(selected, {
        provider: model.provider,
        route: selected.route.with({
          auth: Auth.none,
          endpoint: { baseURL: urls.planned.toString().replace(/\/$/, "") },
          headers: { ...selected.route.defaults.headers, ...input.headers },
          providerOptions: selection.options,
          ...(selection.format === "anthropic" ? { generation: { maxTokens: selection.info.limit.output } } : {}),
        }),
      })
      const authentication = (
        plan.routing.type === "aws-bedrock"
          ? middleware({
              integrations,
              integration: plan.routing.integration,
              region: plan.routing.region,
              connection: plan.routing.connection,
              canonicalOrigin: urls.canonical.origin,
              plannedOrigin: urls.planned.origin,
              apiID: selection.info.apiID,
              path:
                selected.route.protocol === "bedrock-converse"
                  ? `/model/${encodeURIComponent(selection.info.apiID)}/converse-stream`
                  : "/v1/responses",
              service: selected.route.protocol === "bedrock-converse" ? "bedrock" : "bedrock-mantle",
            })
           : (request, handler) => {
              const auth = plan.authentication
              if (auth.type === "none") return handler(request)
              const physical = HttpClientRequest.toUrl(request)
              if (Option.isNone(physical))
                return Effect.fail(new Provider.FailureError({ cause: "Provider request URL is invalid" }))
              if (urls.planned.origin !== urls.canonical.origin || physical.value.origin !== urls.canonical.origin)
                return handler(request)
              return Effect.gen(function* () {
                const integrationID = Integration.ID.make(auth.integration)
                const integration = yield* integrations
                  .get(integrationID)
                  .pipe(
                    Effect.mapError(
                      () => new Provider.FailureError({ cause: "Provider integration could not be read" }),
                    ),
                  )
                if (!integration)
                  return yield* new Provider.FailureError({ cause: "Provider integration is unavailable" })
                const connection = yield* integrations.connection.active(integrationID)
                if (!connection)
                  return yield* new Provider.FailureError({ cause: "Provider connection is unavailable" })
                const credential = yield* integrations.connection
                  .resolve(connection)
                  .pipe(
                    Effect.mapError(
                      () => new Provider.FailureError({ cause: "Provider credential could not be resolved" }),
                    ),
                  )
                if (!credential || credential.type !== "key")
                  return yield* new Provider.FailureError({ cause: "Provider credential is unavailable" })
                return yield* handler(
                  HttpClientRequest.setHeader(request, auth.header, `${auth.prefix ?? ""}${credential.key}`),
                )
              })
            }
      ) satisfies HttpMiddleware
      return {
        ref: { id: model.id, provider: model.provider },
        selection,
        runtimeModel,
        authentication,
      }
    })
    return Service.of({
      native,
      prepare,
      resolve: Effect.fn("ModelResolver.resolve")(function* (input) {
        const execution = yield* catalog.model.requireExecution(input.model).pipe(
          Effect.mapError(
            (error) =>
              new ResolutionError({
                model: input.model,
                reason:
                  error.reason === "transport-unsupported" ||
                  error.reason === "region-unsupported" ||
                  error.reason === "connection-unavailable"
                    ? error.reason
                    : "unavailable",
              }),
          ),
        )
        const resolved = yield* prepare({
          execution,
          headers: input.headers,
          ...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
        })
        return { ...resolved, ref: input.model }
      }),
    })
  }),
)

/** Canonical model resolver over the workspace Catalog and Integration authorities. */
export const node = makeWorkspaceNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly catalog: WorkspaceNode<Catalog.Service, E>
  readonly integration: WorkspaceNode<Integration.Service, E>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer,
    deps: [input.catalog, input.integration],
  })
