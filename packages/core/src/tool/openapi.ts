/** Core-owned adapter between Code Mode's OpenAPI converter and Tool. */

import { CodeMode } from "./codemode.js"
import { OpenAPI } from "@bymorning/plugin/effect"
import type { Integration } from "../integration.js"
import { ID } from "@bymorning/schema/integration"
import { Tool } from "@bymorning/schema/tool"
import type { Interface } from "../tool.js"
import { Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientError } from "effect/unstable/http"

export interface Dependencies {
  readonly tool: Pick<Interface, "transform">
  readonly integration: Pick<Integration.Interface, "connection">
  /** Host-constructed transport with redirects disabled before dispatch. */
  readonly http: HttpClient.HttpClient
}

const Nonempty = Schema.String.check(Schema.isMinLength(1))
const Configuration = Schema.Struct({
  namespace: Nonempty,
  permissionPrefix: Nonempty,
  spec: Schema.Record(Schema.String, Schema.Unknown),
  baseURL: Schema.optionalKey(Schema.String),
  expectedOrigin: Schema.String,
  authentication: Schema.Union([
    Schema.Struct({ type: Schema.Literal("none") }),
    Schema.Struct({
      type: Schema.Literal("integration"),
      integrationID: Nonempty,
      schemes: Schema.Record(Schema.String, Schema.Union([
        Schema.Struct({ type: Schema.Literal("bearer") }),
        Schema.Struct({ type: Schema.Literal("apiKey") }),
        Schema.Struct({ type: Schema.Literal("basic"), username: Nonempty }),
      ])),
    }),
  ]),
})

const configuration = Effect.fn("Tool.OpenAPI.configuration")(function* (input: unknown) {
  const options = yield* Schema.decodeUnknownEffect(Configuration)(input).pipe(
    Effect.mapError(() => new OpenAPI.Error({ message: "Invalid OpenAPI options" })),
  )
  if (!options.namespace.split(".").every((part) => /^[A-Za-z0-9_-]{1,64}$/.test(part)))
    return yield* new OpenAPI.Error({ message: "Invalid OpenAPI namespace" })
  if (options.permissionPrefix.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(options.permissionPrefix))
    return yield* new OpenAPI.Error({ message: "Invalid OpenAPI permission prefix" })
  const origin = httpURL(options.expectedOrigin)
  if (origin === undefined || origin.origin !== options.expectedOrigin)
    return yield* new OpenAPI.Error({ message: "Invalid OpenAPI expected origin" })
  if (options.baseURL !== undefined) {
    const base = httpURL(options.baseURL)
    if (base === undefined || base.origin !== origin.origin)
      return yield* new OpenAPI.Error({ message: "Invalid OpenAPI base URL: expected an HTTP(S) URL at the configured origin without credentials, query, or fragment" })
  }
  return options
})

function httpURL(value: string) {
  // Reject URL-parser repairs and even empty userinfo/query/fragment delimiters.
  if (!/^https?:\/\//i.test(value) || /[\s\\?#]/.test(value) || value.split("/", 3)[2]?.includes("@")) return undefined
  const url = URL.parse(value)
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === ""
    ? url
    : undefined
}

/** Installs an OpenAPI spec and returns the activation summary. */
export const register = Effect.fn("Tool.OpenAPI.register")(function* (input: Dependencies & { readonly options: OpenAPI.Options }) {
  const options = yield* configuration(input.options)
  const http = confinedClient(input.http, options.expectedOrigin)
  const generated = yield* Effect.try({
    try: () => CodeMode.OpenAPI.fromSpec({
      spec: options.spec,
      ...(options.baseURL === undefined ? {} : { baseUrl: options.baseURL }),
      ...(options.authentication.type === "none" ? {} : {
        auth: { resolve: ({ name }: { readonly name: string }) => resolveAuth(input.integration, options.authentication.type === "integration" ? options.authentication : undefined, name) },
      }),
    }),
    catch: () => new OpenAPI.Error({ message: "Invalid OpenAPI document" }),
  })
  const operations: Array<{ readonly path: ReadonlyArray<string>; readonly tool: CodeMode.Tool.Tool<HttpClient.HttpClient> }> = []
  collect(generated.tools, [], operations)
  const names = new Map<string, number>()
  for (const [index, operation] of operations.entries()) {
    const name = operationName(operation.path)
    if (name.length > 64)
      return yield* new OpenAPI.Error({ message: `OpenAPI operation ${index + 1} exceeds the 64-character Tool name limit` })
    const previous = names.get(name)
    if (previous !== undefined)
      return yield* new OpenAPI.Error({ message: `OpenAPI operation name collision between operations ${previous + 1} and ${index + 1}` })
    names.set(name, index)
  }
  const registration = yield* input.tool.transform((editor) => {
    for (const operation of operations) {
      const name = operationName(operation.path)
      const action = `${options.permissionPrefix}_${name}`
      editor.add({
        name,
        description: operation.tool.description,
        input: operation.tool.input as Tool.ValueSchema,
        ...(operation.tool.output === undefined ? {} : { output: operation.tool.output as Tool.ValueSchema }),
        options: { namespace: options.namespace, permission: action },
        execute: (value, context) => context.permission({ action, resources: [options.expectedOrigin], save: [options.expectedOrigin] }).pipe(
          Effect.flatMap(() => Effect.scoped(Effect.gen(function* () {
            const scope = yield* Scope.Scope
            const scoped = HttpClient.transformResponse(HttpClient.withScope(http), Scope.provide(scope))
            return yield* operation.tool.execute(value).pipe(
              Effect.provideService(HttpClient.HttpClient, scoped),
              // HttpClient.make traces full URLs and arbitrary headers before
              // dispatch, including query auth and reflected response secrets.
              // Disable only these transport spans, before either client runs.
              Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
            )
          }))),
          Effect.timeout("30 seconds"),
          Effect.map((output) => output === undefined ? {} : { output }),
          Effect.mapError(() => new Tool.Error({ message: `${options.namespace} request failed` })),
          Effect.withSpan("Tool.OpenAPI.request", { attributes: { "server.address": options.expectedOrigin, "tool.namespace": options.namespace } }),
        ),
      })
    }
  })
  return { operationNames: operations.map((operation) => operationName(operation.path)), skipped: generated.skipped, ...registration }
})

function resolveAuth(integration: Dependencies["integration"], authentication: Extract<OpenAPI.Authentication, { readonly type: "integration" }> | undefined, name: string) {
  return Effect.gen(function* () {
    if (authentication === undefined) return undefined
    const scheme = authentication.schemes[name]
    if (scheme === undefined) return undefined
    const connection = yield* integration.connection.active(ID.make(authentication.integrationID))
    if (connection === undefined) return yield* new Tool.Error({ message: "Integration is not connected" })
    const credential = yield* integration.connection.resolve(connection)
    if (credential === undefined) return yield* new Tool.Error({ message: "Integration credential is unavailable" })
    if (scheme.type === "bearer" && (credential.type === "key" || credential.type === "oauth")) return { type: "bearer" as const, token: credential.type === "key" ? credential.key : credential.access }
    if (scheme.type === "apiKey" && credential.type === "key") return { type: "apiKey" as const, value: credential.key }
    if (scheme.type === "basic" && credential.type === "key") {
      const configuration = credential.configuration as Record<string, unknown> | undefined
      const username = configuration?.[scheme.username]
      if (typeof username !== "string" || username.length === 0) return yield* new Tool.Error({ message: "Username is unavailable" })
      return { type: "basic" as const, username, password: credential.key }
    }
    return yield* new Tool.Error({ message: "Integration credential is unavailable" })
  })
}

function collect(source: CodeMode.OpenAPI.Tools, parent: ReadonlyArray<string>, target: Array<{ readonly path: ReadonlyArray<string>; readonly tool: CodeMode.Tool.Tool<HttpClient.HttpClient> }>) {
  for (const [name, value] of Object.entries(source)) {
    const path = [...parent, name]
    if (CodeMode.Tool.isTool<HttpClient.HttpClient>(value)) target.push({ path, tool: value })
    else collect(value, path, target)
  }
}
function operationName(path: ReadonlyArray<string>) {
  // Match Tool's normalization; the converter already escapes reserved members
  // and leading digits. Never truncate or replace those safe identifiers.
  return path.join("_").replace(/[^A-Za-z0-9_-]/g, "_")
}

function confinedClient(delegate: HttpClient.HttpClient, expectedOrigin: string) {
  return HttpClient.make((request, url, _signal, _fiber) => {
    if (url.origin !== expectedOrigin)
      return Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description: "Request origin differs from the configured origin" }) }))
    return delegate.execute(request).pipe(
      Effect.flatMap((response) => response.status >= 300 && response.status < 400
        ? Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description: "Redirects are not permitted" }) }))
        : Effect.succeed(response)),
    )
  })
}
