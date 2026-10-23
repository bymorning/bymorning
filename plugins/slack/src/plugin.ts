import { Credential, Integration, Plugin } from "@bymorning/plugin/effect"
import type { Context as EffectPluginContext, Plugin as EffectPlugin } from "@bymorning/plugin/effect/plugin"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Deferred, Effect, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { slack } from "./slack.js"

const TokenResponse = Schema.Struct({
  ok: Schema.Literal(true),
  access_token: Schema.optionalKey(Schema.String),
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Finite),
  authed_user: Schema.optionalKey(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      access_token: Schema.optionalKey(Schema.String),
    }),
  ),
  team: Schema.optionalKey(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
    }),
  ),
})
const OAuthClient = Schema.Struct({
  client_id: Schema.Trim.check(Schema.isMinLength(1)),
  client_secret: Schema.Trim.check(Schema.isMinLength(1)),
})
class ProviderError extends Schema.TaggedError<ProviderError>()("Slack.ProviderError", {
  message: Schema.String,
}) {}

/** Slack Integration and remote MCP server plugin with an injectable HTTP client. */
export function makePlugin(client: HttpClient.HttpClient): EffectPlugin {
  return Plugin.define({
    id: slack.pluginID,
    effect: (context) => register(context, client),
  })
}

type SlackContext = {
  readonly integration: Pick<EffectPluginContext["integration"], "transform" | "connection"> & {
    readonly oauth: Pick<EffectPluginContext["integration"]["oauth"], "callback">
  }
  readonly event: Pick<EffectPluginContext["event"], "subscribe">
  readonly mcp: Pick<EffectPluginContext["mcp"], "transform" | "reload">
}

/** Internal Slack registration, shared by the package entrypoint and package-owned tests. */
export function register(context: SlackContext, client: HttpClient.HttpClient) {
  return Effect.orDie(
    Effect.gen(function* () {
      yield* context.integration.transform((editor) => {
        editor.update(slack.integrationID, (integration) => {
          integration.name = "Slack"
          integration.connectionPolicy = "member-only"
        })
        editor.method.update({
          integrationID: slack.integrationID,
          method: {
            id: slack.methodID,
            type: "oauth",
            label: "Slack OAuth web app",
            client: [
              { key: "client_id", type: "string", title: "OAuth client ID", required: true },
              { key: "client_secret", type: "string", title: "OAuth client secret", required: true, secret: true },
            ],
          },
          authorize: (_answer, clientAnswer) =>
            Effect.gen(function* () {
              const oauthClient = yield* decodeClient(clientAnswer)
              const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString("base64url")
              const callback = yield* context.integration.oauth.callback.register()
              const authorization = new URL(slack.authorizationURL)
              const challenge = Buffer.from(
                yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
              ).toString("base64url")
              authorization.search = new URLSearchParams({
                client_id: oauthClient.client_id,
                redirect_uri: callback.callbackURI,
                response_type: "code",
                scope: slack.authorizationScopes.join(","),
                code_challenge: challenge,
                code_challenge_method: "S256",
                state: callback.state,
              }).toString()
              return {
                mode: "auto" as const,
                url: authorization.href,
                instructions: "Complete Slack authorization in your browser, then return to ByMorning.",
                expiresAt: callback.expiresAt,
                callback: Effect.gen(function* () {
                  const response = yield* callback.wait
                  if ("error" in response) return yield* new ProviderError({ message: "Slack authorization failed" })
                  const token = yield* requestToken(client, {
                    client_id: oauthClient.client_id,
                    client_secret: oauthClient.client_secret,
                    code: response.code,
                    code_verifier: verifier,
                    grant_type: "authorization_code",
                    redirect_uri: callback.callbackURI,
                  })
                  return toCredential(token)
                }),
              }
            }),
          refresh: (credential, clientAnswer) =>
            Effect.gen(function* () {
              if (credential.refresh === "") {
                return yield* new ProviderError({ message: "Reconnect Slack" })
              }
              const oauthClient = yield* decodeClient(clientAnswer)
              const token = yield* requestToken(client, {
                client_id: oauthClient.client_id,
                client_secret: oauthClient.client_secret,
                refresh_token: credential.refresh,
                grant_type: "refresh_token",
              })
              return toCredential(token, credential)
            }),
          label: (credential) =>
            typeof credential.metadata?.team === "string"
              ? credential.metadata.team
              : typeof credential.metadata?.user === "string"
                ? credential.metadata.user
                : undefined,
        })
      })

      const connectionChanges = context.event.subscribe().pipe(
        Stream.filter(
          (event) =>
            event.type === "integration.connection.updated" && event.data.integrationID === slack.integrationID,
        ),
        Stream.retry(Schedule.spaced("1 second")),
        Stream.orDie,
      )
      const refresh = Effect.gen(function* () {
        const connection = yield* context.integration.connection.active(slack.integrationID)
        const credential =
          connection === undefined
            ? undefined
            : yield* context.integration.connection
                .resolve(connection)
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to resolve Slack connection", { cause }).pipe(Effect.as(undefined)),
                  ),
                )
        return {
          type: "remote",
          url: slack.url,
          oauth: false,
          ...(credential?.type === "oauth" && credential.access !== ""
            ? { headers: { Authorization: `Bearer ${credential.access}` } }
            : {}),
        } satisfies ConfigMCP.Remote
      })
      const ready = yield* Deferred.make<void>()
      let server: ConfigMCP.Remote = { type: "remote", url: slack.url, oauth: false }
      yield* connectionChanges.pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* Deferred.await(ready)
            server = yield* refresh
            yield* context.mcp.reload()
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      server = yield* refresh
      yield* context.mcp.transform((editor) => editor.set(slack.mcpName, server))
      yield* Deferred.succeed(ready, undefined)
    }),
  )
}

function decodeClient(clientAnswer: unknown) {
  return Effect.mapError(
    Schema.decodeUnknownEffect(OAuthClient)(clientAnswer),
    () => new ProviderError({ message: "OAuth client configuration is incomplete" }),
  )
}

function requestToken(client: HttpClient.HttpClient, body: Record<string, string>) {
  return Effect.gen(function* () {
    const response = yield* Effect.mapError(
      client.execute(HttpClientRequest.bodyUrlParams(HttpClientRequest.post(slack.tokenURL), body)),
      () => new ProviderError({ message: "Slack token request failed" }),
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* new ProviderError({ message: `Slack token request failed (${response.status})` })
    }
    const json = yield* Effect.mapError(
      response.json,
      () => new ProviderError({ message: "Slack token request failed" }),
    )
    const token = yield* Effect.mapError(
      Schema.decodeUnknownEffect(TokenResponse)(json),
      () => new ProviderError({ message: "Slack token response was invalid" }),
    )
    const access = token.access_token || token.authed_user?.access_token
    if (access === undefined || access === "") {
      return yield* new ProviderError({ message: "Slack token response was invalid" })
    }
    return {
      access,
      refresh: token.refresh_token,
      expires_in: token.expires_in,
      user: token.authed_user?.id,
      team: token.team?.name ?? token.team?.id,
    }
  })
}

function toCredential(
  token: {
    readonly access: string
    readonly refresh?: string
    readonly expires_in?: number
    readonly user?: string
    readonly team?: string
  },
  previous?: Credential.OAuth,
) {
  const user = retained(token.user, previous?.metadata?.user)
  const team = retained(token.team, previous?.metadata?.team)
  return Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(slack.methodID),
    access: token.access,
    refresh: token.refresh ?? previous?.refresh ?? "",
    expires: token.expires_in === undefined ? (previous?.expires ?? 0) : Date.now() + token.expires_in * 1_000,
    metadata: {
      ...(user === undefined ? {} : { user }),
      ...(team === undefined ? {} : { team }),
    },
  })
}

function retained(value: string | undefined, previous: unknown) {
  if (typeof value === "string") return value
  return typeof previous === "string" ? previous : undefined
}
