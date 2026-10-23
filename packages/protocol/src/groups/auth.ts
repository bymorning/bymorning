import * as AuthProvider from "@bymorning/schema/auth-provider"
import { Info as ProviderInfo, Setup as ProviderSetup } from "./auth-provider.js"
import { Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, ServiceUnavailableError } from "../errors.js"

const CallbackQueryWire = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
})

/**
 * OAuth callback query values. The wire form admits missing values so the Auth
 * handler can expire its attempt cookie and project every expected failure.
 */
export const CallbackQuery = CallbackQueryWire.pipe(
  Schema.decodeTo(
    Schema.Struct({ code: Schema.String, state: Schema.String }),
    SchemaTransformation.transform({
      decode: (query) => ({ code: query.code ?? "", state: query.state ?? "" }),
      encode: (query) => query,
    }),
  ),
)

/** Optional query values accepted from a provider's public OAuth redirect. */
export const IntegrationCallbackQuery = Schema.Struct({
  state: Schema.optionalKey(Schema.String).annotate({ description: "Opaque OAuth state." }),
  code: Schema.optionalKey(Schema.String).annotate({ description: "Provider authorization code." }),
  error: Schema.optionalKey(Schema.String).annotate({ description: "Provider OAuth error code." }),
  error_description: Schema.optionalKey(Schema.String).annotate({ description: "Provider OAuth error description." }),
})

/** Origin declaration shared by unsafe cookie-authenticated operations. */
export const UnsafeOrigin = Schema.Struct({
  origin: Schema.optionalKey(Schema.String),
})

/** Redirect response returned when browser authentication starts. */
export const LoginSuccess = HttpApiSchema.Empty(302)

/** Redirect response returned for both successful and expected-failure callbacks. */
export const CallbackSuccess = HttpApiSchema.Empty(303)

/** Minimal browser page returned after an Integration authorization response. */
export const IntegrationCallbackPageSuccess = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" }),
)

/** Clean-URL redirect returned after consuming a provider response. */
export const IntegrationCallbackRedirect = HttpApiSchema.Empty(303)

/** Empty response that expires the Account cookie. */
export const LogoutSuccess = HttpApiSchema.Empty(204)

/** Secret-free Auth Provider summary exposed on the public login page. */
export const MethodProvider = Schema.Struct({
  id: AuthProvider.ID,
  displayName: Schema.NonEmptyString,
  kind: AuthProvider.Kind,
})
export type MethodProvider = typeof MethodProvider.Type

/** Public login readiness when no Auth Provider is configured yet. */
export const MethodSetup = Schema.Struct({
  state: Schema.Literal("setup"),
  callbackBase: Schema.String,
  /** System use notification text; the sign-in page requires acknowledgment before continuing. */
  banner: Schema.optionalKey(Schema.String),
  /** Login Session idle limit in milliseconds; clients lock their display after this much inactivity. */
  idleTimeout: Schema.optionalKey(Schema.Finite),
})
export type MethodSetup = typeof MethodSetup.Type

/** Public login readiness with the enabled Auth Provider list. */
export const MethodReady = Schema.Struct({
  state: Schema.Literal("ready"),
  callbackBase: Schema.String,
  providers: Schema.Array(MethodProvider),
  local: Schema.optionalKey(Schema.Boolean),
  /** System use notification text; the sign-in page requires acknowledgment before continuing. */
  banner: Schema.optionalKey(Schema.String),
  /** Login Session idle limit in milliseconds; clients lock their display after this much inactivity. */
  idleTimeout: Schema.optionalKey(Schema.Finite),
})
export type MethodReady = typeof MethodReady.Type

/** Public login readiness. Omits secrets, issuer, client ID, domains, disabled providers, and revisions. */
export const Method = Schema.Union([MethodSetup, MethodReady])
export type Method = typeof Method.Type

/** Setup-token proof accepted by the public inspect endpoint. */
export const InspectInput = Schema.Struct({
  token: Schema.String,
})
export type InspectInput = typeof InspectInput.Type

const header = (schema: Record<string, unknown>) => ({ schema })
const noStore = header({ type: "string", const: "no-store" })
const text = header({ type: "string" })
const integrationCallbackHeaders = {
  "referrer-policy": header({ type: "string", const: "no-referrer" }),
  "content-security-policy": header({
    type: "string",
    const: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  }),
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const responseHeaders = (status: string, success: Record<string, unknown>, common: Record<string, unknown> = {}) =>
  OpenApi.annotations({
    transform: (operation) => {
      const responses: unknown = operation.responses
      if (!isRecord(responses)) return operation
      return {
        ...operation,
        responses: Object.fromEntries(
          Object.entries(responses).map(([code, response]) => {
            if (!isRecord(response)) return [code, response]
            const headers = isRecord(response.headers) ? response.headers : undefined
            return [
              code,
              {
                ...response,
                headers: {
                  ...headers,
                  "cache-control": noStore,
                  ...common,
                  ...(code === status ? success : {}),
                },
              },
            ]
          }),
        ),
      }
    },
  })

/** Public browser authentication flow. */
export const AuthGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("auth.login", "/login", {
      query: Schema.Struct({
        redirect: Schema.optionalKey(Schema.String),
        provider: Schema.optionalKey(Schema.String),
      }),
      success: LoginSuccess,
      error: ServiceUnavailableError,
    }).annotateMerge(responseHeaders("302", { location: text, "set-cookie": text })),
  )
  .add(
    HttpApiEndpoint.get("auth.callback", "/callback", {
      query: CallbackQuery,
      success: CallbackSuccess,
    }).annotateMerge(responseHeaders("303", { location: text, "set-cookie": text })),
  )
  .add(
    HttpApiEndpoint.get("auth.callbackProvider", "/callback/:providerID", {
      params: { providerID: Schema.String },
      query: CallbackQuery,
      success: CallbackSuccess,
    }).annotateMerge(responseHeaders("303", { location: text, "set-cookie": text })),
  )
  .add(
    HttpApiEndpoint.get("auth.method", "/method", {
      success: Method,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("auth.inspect", "/inspect", {
      payload: InspectInput,
      success: Schema.Array(ProviderInfo),
      error: [ForbiddenError, InputError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.post("auth.setup", "/setup", {
      payload: ProviderSetup,
      success: ProviderInfo,
      error: [ForbiddenError, InputError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.get("auth.integration.callback", "/integration/callback", {
      query: IntegrationCallbackQuery,
      success: IntegrationCallbackRedirect,
    }).annotateMerge(responseHeaders("303", { location: text }, integrationCallbackHeaders)),
  )
  .add(
    HttpApiEndpoint.get("auth.integration.page", "/integration/callback/complete", {
      success: IntegrationCallbackPageSuccess,
    }).annotateMerge(responseHeaders("200", {}, integrationCallbackHeaders)),
  )
  .add(
    HttpApiEndpoint.post("auth.logout", "/logout", {
      headers: UnsafeOrigin.fields,
      success: LogoutSuccess,
      error: [ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(responseHeaders("204", { "set-cookie": text })),
  )
  .prefix("/auth")
