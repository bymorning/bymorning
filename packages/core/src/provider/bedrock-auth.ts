import type { AwsRegion } from "@bymorning/schema/aws-region"
import type { HttpMiddleware } from "@opencode-ai/ai/route/executor"
import { BedrockAuth } from "@opencode-ai/ai/protocols/utils/bedrock-auth"
import { Effect, Option } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import type { BedrockConnection } from "../catalog.js"
import { Integration } from "../integration.js"
import { Provider } from "../provider.js"

export interface Input {
  readonly integrations: Integration.Interface
  readonly integration: Integration.ID
  readonly region: AwsRegion
  readonly connection: BedrockConnection
  readonly canonicalOrigin: string
  readonly plannedOrigin: string
  readonly apiID: string
  readonly path?: string
  readonly service?: "bedrock" | "bedrock-mantle"
}

const staleHeaders = ["authorization", "x-amz-date", "x-amz-security-token", "x-amz-content-sha256"] as const

/** Authenticate only the exact canonical Bedrock request after plugin middleware has run. */
export const middleware =
  (input: Input): HttpMiddleware =>
  (request, handler) => {
    const physical = HttpClientRequest.toUrl(request)
    if (Option.isNone(physical))
      return Effect.fail(new Provider.FailureError({ cause: "Provider request URL is invalid" }))
    if (
      input.plannedOrigin !== input.canonicalOrigin ||
      physical.value.origin !== input.canonicalOrigin ||
      request.method !== "POST" ||
      physical.value.pathname !== (input.path ?? `/model/${encodeURIComponent(input.apiID)}/converse-stream`) ||
      physical.value.search !== ""
    )
      return handler(request)
    if (request.body._tag !== "Uint8Array")
      return Effect.fail(new Provider.FailureError({ cause: "Provider request body is unsupported" }))
    const body = request.body.body

    return Effect.gen(function* () {
      const integration = yield* input.integrations
        .get(input.integration, { deployment: input.connection.type === "deployment" ? "allow" : "omit" })
        .pipe(Effect.mapError(() => new Provider.FailureError({ cause: "Provider integration could not be read" })))
      if (!integration) return yield* new Provider.FailureError({ cause: "Provider integration is unavailable" })
      const active = yield* input.integrations.connection.active(input.integration, {
        deployment: input.connection.type === "deployment" ? "allow" : "omit",
      })
      if (
        !active ||
        (active.type !== "regional-credential" &&
          active.type !== "regional-env" &&
          active.type !== "regional-deployment")
      )
        return yield* new Provider.FailureError({ cause: "Provider connection is unavailable" })
      if (active.region !== input.region)
        return yield* new Provider.FailureError({ cause: "Provider active region changed" })
      const sameConnection =
        input.connection.type === "credential"
          ? active.type === "regional-credential" &&
            active.id === input.connection.id &&
            active.authKind === input.connection.authKind
          : input.connection.type === "deployment"
            ? active.type === "regional-deployment"
            : active.type === "regional-env" && active.authKind === input.connection.authKind
      if (!sameConnection) return yield* new Provider.FailureError({ cause: "Provider connection changed" })

      const credential = yield* input.integrations.connection
        .resolve(active)
        .pipe(Effect.mapError(() => new Provider.FailureError({ cause: "Provider credential could not be resolved" })))
      const unsigned = staleHeaders.reduce((current, name) => HttpClientRequest.removeHeader(current, name), request)
      if (input.connection.authKind === "bearer") {
        if (
          credential?.type !== "key" ||
          credential.configuration?.type !== "aws-region" ||
          credential.configuration.region !== input.region
        )
          return yield* new Provider.FailureError({ cause: "Provider credential is unavailable" })
        return yield* handler(HttpClientRequest.bearerToken(unsigned, credential.key))
      }
      if (credential?.type !== "aws-sigv4" || credential.region !== input.region)
        return yield* new Provider.FailureError({ cause: "Provider credential is unavailable" })

      const signed = yield* BedrockAuth.sigV4(credential, { service: input.service ?? "bedrock" })
        .apply({
          request: {},
          method: "POST",
          url: physical.value.toString(),
          headers: unsigned.headers,
          body: new TextDecoder().decode(body),
        })
        .pipe(Effect.mapError(() => new Provider.FailureError({ cause: "Provider request signing failed" })))
      return yield* handler(HttpClientRequest.setHeaders(unsigned, Headers.fromInput(signed)))
    })
  }
