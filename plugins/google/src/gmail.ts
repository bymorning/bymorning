import { Credential, Integration, Plugin } from "@bymorning/plugin/effect"
import type { Context as EffectPluginContext, Plugin as EffectPlugin } from "@bymorning/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { googleGmail } from "./google.js"
import { gmailOpenAPI } from "./openapi.js"

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
  refresh_token: Schema.optionalKey(Schema.String),
})
const UserInfoResponse = Schema.Struct({ sub: Schema.NonEmptyString, email: Schema.NonEmptyString })
const OAuthClient = Schema.Struct({
  client_id: Schema.Trim.check(Schema.isMinLength(1)),
  client_secret: Schema.Trim.check(Schema.isMinLength(1)),
})
class ProviderError extends Schema.TaggedError<ProviderError>()("GoogleGmail.ProviderError", {
  message: Schema.String,
}) {}

/** Gmail plugin using the public Integration and Tool APIs with an injectable HTTP client. */
export function makePlugin(client: HttpClient.HttpClient): EffectPlugin {
  return Plugin.define({
    id: googleGmail.pluginID,
    effect: (context) => register(context, client),
  })
}

type GmailContext = {
  readonly integration: Pick<EffectPluginContext["integration"], "transform"> & {
    readonly oauth: Pick<EffectPluginContext["integration"]["oauth"], "callback">
  }
  readonly tool: Pick<EffectPluginContext["tool"], "openapi">
}

/** Internal Gmail registration, shared by the package entrypoint and package-owned tests. */
export function register(context: GmailContext, client: HttpClient.HttpClient) {
  return Effect.orDie(
    Effect.gen(function* () {
      yield* context.integration.transform((editor) => {
        editor.update(googleGmail.integrationID, (integration) => {
          integration.name = "Google Gmail"
          integration.connectionPolicy = "member-only"
        })
        editor.method.update({
          integrationID: googleGmail.integrationID,
          method: {
            id: googleGmail.methodID,
            type: "oauth",
            label: "Google OAuth web app",
            client: [
              { key: "client_id", type: "string", title: "OAuth client ID", required: true },
              { key: "client_secret", type: "string", title: "OAuth client secret", required: true, secret: true },
            ],
          },
          authorize: (_answer, clientAnswer) =>
            Effect.gen(function* () {
              const oauthClient = yield* Effect.mapError(
                Schema.decodeUnknownEffect(OAuthClient)(clientAnswer),
                () => new ProviderError({ message: "OAuth client configuration is incomplete" }),
              )
              const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString("base64url")
              const callback = yield* context.integration.oauth.callback.register()
              const authorization = new URL(googleGmail.authorizationURL)
              const challenge = Buffer.from(
                yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
              ).toString("base64url")
              authorization.search = new URLSearchParams({
                client_id: oauthClient.client_id,
                redirect_uri: callback.callbackURI,
                response_type: "code",
                scope: googleGmail.authorizationScopes.join(" "),
                access_type: "offline",
                prompt: "consent",
                include_granted_scopes: "true",
                code_challenge: challenge,
                code_challenge_method: "S256",
                state: callback.state,
              }).toString()
              return {
                mode: "auto" as const,
                url: authorization.href,
                instructions: "Complete Google authorization in your browser, then return to ByMorning.",
                expiresAt: callback.expiresAt,
                callback: Effect.gen(function* () {
                  const response = yield* callback.wait
                  if ("error" in response) return yield* new ProviderError({ message: "Google authorization failed" })
                  const tokenResponse = yield* Effect.mapError(
                    client.execute(
                      HttpClientRequest.bodyUrlParams(HttpClientRequest.post(googleGmail.tokenURL), {
                        client_id: oauthClient.client_id,
                        client_secret: oauthClient.client_secret,
                        code: response.code,
                        code_verifier: verifier,
                        grant_type: "authorization_code",
                        redirect_uri: callback.callbackURI,
                      }),
                    ),
                    () => new ProviderError({ message: "Google token request failed" }),
                  )
                  if (tokenResponse.status < 200 || tokenResponse.status >= 300)
                    return yield* new ProviderError({
                      message: `Google token request failed (${tokenResponse.status})`,
                    })
                  const tokenJSON = yield* Effect.mapError(
                    tokenResponse.json,
                    () => new ProviderError({ message: "Google token request failed" }),
                  )
                  const token = yield* Effect.mapError(
                    Schema.decodeUnknownEffect(TokenResponse)(tokenJSON),
                    () => new ProviderError({ message: "Google token response was invalid" }),
                  )
                  if (token.refresh_token === undefined)
                    return yield* new ProviderError({ message: "Google did not return a refresh token" })
                  const profileResponse = yield* Effect.mapError(
                    client.execute(
                      HttpClientRequest.bearerToken(HttpClientRequest.get(googleGmail.userInfoURL), token.access_token),
                    ),
                    () => new ProviderError({ message: "Google userinfo request failed" }),
                  )
                  if (profileResponse.status < 200 || profileResponse.status >= 300)
                    return yield* new ProviderError({
                      message: `Google userinfo request failed (${profileResponse.status})`,
                    })
                  const profileJSON = yield* Effect.mapError(
                    profileResponse.json,
                    () => new ProviderError({ message: "Google userinfo request failed" }),
                  )
                  const profile = yield* Effect.mapError(
                    Schema.decodeUnknownEffect(UserInfoResponse)(profileJSON),
                    () => new ProviderError({ message: "Google userinfo response was invalid" }),
                  )
                  return Credential.OAuth.make({
                    type: "oauth",
                    methodID: Integration.MethodID.make(googleGmail.methodID),
                    access: token.access_token,
                    refresh: token.refresh_token,
                    expires: Date.now() + token.expires_in * 1_000,
                    metadata: { sub: profile.sub, email: profile.email },
                  })
                }),
              }
            }),
          refresh: (credential, clientAnswer) =>
            Effect.gen(function* () {
              const oauthClient = yield* Effect.mapError(
                Schema.decodeUnknownEffect(OAuthClient)(clientAnswer),
                () => new ProviderError({ message: "OAuth client configuration is incomplete" }),
              )
              const response = yield* Effect.mapError(
                client.execute(
                  HttpClientRequest.bodyUrlParams(HttpClientRequest.post(googleGmail.tokenURL), {
                    client_id: oauthClient.client_id,
                    client_secret: oauthClient.client_secret,
                    refresh_token: credential.refresh,
                    grant_type: "refresh_token",
                  }),
                ),
                () => new ProviderError({ message: "Google token request failed" }),
              )
              if (response.status < 200 || response.status >= 300)
                return yield* new ProviderError({ message: `Google token request failed (${response.status})` })
              const responseJSON = yield* Effect.mapError(
                response.json,
                () => new ProviderError({ message: "Google token request failed" }),
              )
              const token = yield* Effect.mapError(
                Schema.decodeUnknownEffect(TokenResponse)(responseJSON),
                () => new ProviderError({ message: "Google token response was invalid" }),
              )
              return Credential.OAuth.make({
                ...credential,
                access: token.access_token,
                refresh: token.refresh_token ?? credential.refresh,
                expires: Date.now() + token.expires_in * 1_000,
                metadata: {
                  ...(typeof credential.metadata?.sub === "string" ? { sub: credential.metadata.sub } : {}),
                  ...(typeof credential.metadata?.email === "string" ? { email: credential.metadata.email } : {}),
                },
              })
            }),
          label: (credential) =>
            typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined,
        })
      })

      yield* context.tool.openapi({
        namespace: "gmail",
        permissionPrefix: "gmail",
        spec: gmailOpenAPI,
        baseURL: googleGmail.apiURL,
        expectedOrigin: googleGmail.apiURL,
        authentication: {
          type: "integration",
          integrationID: googleGmail.integrationID,
          schemes: { googleOAuth: { type: "bearer" } },
        },
      })
    }),
  )
}
