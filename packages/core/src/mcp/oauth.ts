import {
  auth,
  UnauthorizedError,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { ID, OAuth } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Effect, FiberSet, Schema } from "effect"
import { request } from "./http.js"
import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import type { Credential } from "../credential.js"
import type { Integration as IntegrationService } from "../integration.js"
import type { IntegrationOAuthCallback } from "../integration-oauth-callback.js"

const methodID = "oauth"

class ProviderError extends Schema.TaggedError<ProviderError>()("McpOAuth.ProviderError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

export const identity = (name: string, url: string) =>
  `mcp-${createHash("sha256").update(name).update("\0").update(url).digest("hex")}`

export const register = Effect.fn("McpOAuth.register")(function* (
  integration: IntegrationService.Interface,
  callbackService: IntegrationOAuthCallback.Interface,
  owner: IntegrationOAuthCallback.Owner,
  name: string,
  config: ConfigMCP.Remote,
) {
  const runtime = yield* FiberSet.makeRuntimePromise()
  if (config.oauth === false) return undefined
  const integrationID = identity(name, config.url)
  yield* integration.transform((editor) => {
    editor.update(Integration.ID.make(integrationID), (integration) => {
      integration.name = `${name} MCP`
      integration.connectionPolicy = "member-only"
    })
    editor.method.update({
      integrationID: Integration.ID.make(integrationID),
      method: { id: Integration.MethodID.make(methodID), type: "oauth", label: "OAuth" },
      authorize: () =>
        Effect.gen(function* () {
          // The host callback capability is supplied by the member-bound graph.
          const callback = yield* callbackService.register(owner)
          const state = makeAuthorizeState(callback)
          const provider = makeProvider(
            config,
            callback.callbackURI,
            callback.state,
            undefined,
            state,
            undefined,
            runtime,
          )
          yield* Effect.tryPromise(() =>
            auth(provider, { serverUrl: config.url, scope: oauthConfig(config)?.scope, fetchFn: request }),
          )
          if (state.authorizationURL === undefined)
            return yield* Effect.die(new Error("MCP OAuth did not request authorization"))
          return {
            mode: "auto" as const,
            url: state.authorizationURL.href,
            instructions: "Complete authorization in your browser.",
            expiresAt: callback.expiresAt,
            callback: callback.wait.pipe(
              Effect.flatMap((response) =>
                "error" in response
                  ? Effect.fail(new ProviderError({ cause: new Error(response.errorDescription ?? response.error) }))
                  : Effect.tryPromise(() =>
                      auth(provider, {
                        serverUrl: config.url,
                        authorizationCode: response.code,
                        scope: oauthConfig(config)?.scope,
                        fetchFn: request,
                      }),
                    ).pipe(Effect.mapError((cause) => new ProviderError({ cause }))),
              ),
              Effect.flatMap(() =>
                state.tokens === undefined
                  ? Effect.fail(new ProviderError({ cause: new Error("MCP OAuth token exchange returned no tokens") }))
                  : Effect.succeed(toCredential(state.tokens, state.clientInformation, state.discoveryState)),
              ),
            ),
          }
        }),
      refresh: (credential) =>
        Effect.gen(function* () {
          const state: ProviderState = {}
          const provider = makeProvider(
            config,
            "https://invalid.local",
            "refresh",
            credential,
            state,
            undefined,
            runtime,
          )
          yield* Effect.tryPromise(() =>
            auth(provider, { serverUrl: config.url, scope: oauthConfig(config)?.scope, fetchFn: request }),
          )
          if (state.tokens === undefined) return credential
          return toCredential(state.tokens, state.clientInformation, state.discoveryState, credential.refresh)
        }),
    })
  })
  return integrationID
})

export const connectionProvider = Effect.fn("McpOAuth.connectionProvider")(function* (
  integration: IntegrationService.Interface,
  integrationID: string,
  config: ConfigMCP.Remote,
  credentials: Credential.Interface,
) {
  const runtime = yield* FiberSet.makeRuntimePromise()
  const active = yield* integration.connection.active(Integration.ID.make(integrationID))
  const stored = active?.type === "credential" ? yield* credentials.get(ID.make(active.id), "member") : undefined
  const credential = stored?.scope === "member" && stored.value.type === "oauth" ? stored.value : undefined
  // Hosted authorization owns DCR/PKCE. An unauthenticated connection only
  // classifies the remote 401; starting a second ephemeral SDK auth flow here
  // would register a client that the subsequent hosted attempt cannot reuse.
  if (credential === undefined) return undefined
  const state: ProviderState = {}
  const provider = makeProvider(
    config,
    "https://invalid.local",
    "connect",
    credential,
    state,
    active?.type === "credential" && credential !== undefined ? { id: ID.make(active.id), credentials } : undefined,
    runtime,
  )
  // Do not open a catalog connection with a token that will expire during its
  // initialize/list handshake. Refresh it before transport creation instead
  // of allowing the transport to retry a possibly mutating tools/call after a
  // 401 response.
  if (credential.expires !== 0 && credential.expires <= Date.now() + 5_000)
    yield* Effect.tryPromise(() =>
      auth(provider, { serverUrl: config.url, scope: oauthConfig(config)?.scope, fetchFn: request }),
    ).pipe(Effect.mapError((cause) => new ProviderError({ cause })))
  return provider
})

type ProviderState = {
  authorizationURL?: URL
  codeVerifier?: string
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
  discoveryState?: OAuthDiscoveryState
  credential?: OAuth
}

const makeAuthorizeState = <C>(callback: C): ProviderState & { readonly callback: C } => ({ callback })

/** SDK callbacks run across awaits inside transport.send. Isolate each send's
 * presented credential from simultaneous header reads and refresh attempts. */
export interface Provider extends OAuthClientProvider {
  readonly request: <A>(work: () => Promise<A>) => Promise<A>
}

export function makeProvider(
  config: ConfigMCP.Remote,
  redirectUrl: string,
  stateValue: string,
  credential: OAuth | undefined,
  initialState: ProviderState,
  persistence?: { readonly id: Credential.ID; readonly credentials: Credential.Interface },
  runtime: <A>(effect: Effect.Effect<A>) => Promise<A> = Effect.runPromise,
): Provider {
  const requests = new AsyncLocalStorage<ProviderState>()
  const currentState = () => requests.getStore() ?? initialState
  const state = initialState
  const metadata = credential?.metadata
  const configured = oauthConfig(config)
  state.clientInformation = configured?.client_id
    ? { client_id: configured.client_id }
    : isRecord(metadata?.clientInformation)
      ? (metadata.clientInformation as OAuthClientInformationMixed)
      : undefined
  state.discoveryState = isRecord(metadata?.discoveryState)
    ? (metadata.discoveryState as unknown as OAuthDiscoveryState)
    : undefined
  state.tokens = credential === undefined ? undefined : fromCredential(credential)
  state.credential = credential
  return {
    request: (work) => requests.run({ ...initialState }, work),
    redirectUrl,
    clientMetadata: {
      redirect_uris: [redirectUrl],
      client_name: "ByMorning",
      token_endpoint_auth_method: "none",
      ...(configured?.scope ? { scope: configured.scope } : {}),
    },
    state: () => stateValue,
    clientInformation: () => currentState().clientInformation,
    saveClientInformation: async (value) => {
      const state = currentState()
      state.clientInformation = value
      await persistState(state, persistence, runtime)
    },
    tokens: async () => {
      const state = currentState()
      if (persistence !== undefined) {
        // Another connection may already have rotated this member's credential.
        // Present the current token, never a connection-time cached identity.
        const stored = await runtime(persistence.credentials.get(persistence.id, "member"))
        state.credential = stored?.scope === "member" && stored.value.type === "oauth" ? stored.value : undefined
        state.tokens = state.credential === undefined ? undefined : fromCredential(state.credential)
      }
      return state.tokens
    },
    saveTokens: async (value) => {
      const state = currentState()
      state.tokens = value
      await persistState(state, persistence, runtime)
    },
    redirectToAuthorization: (url) => {
      currentState().authorizationURL = url
    },
    saveCodeVerifier: (value) => {
      currentState().codeVerifier = value
    },
    codeVerifier: () => currentState().codeVerifier ?? "",
    saveDiscoveryState: async (value) => {
      const state = currentState()
      state.discoveryState = value
      await persistState(state, persistence, runtime)
    },
    discoveryState: () => currentState().discoveryState,
    invalidateCredentials: async (scope) => {
      const state = currentState()
      if (scope === "verifier" || scope === "all") state.codeVerifier = undefined
      if (scope === "discovery" || scope === "all") state.discoveryState = undefined
      if (scope === "client" || scope === "all") state.clientInformation = undefined
      if (scope === "tokens" || scope === "all") {
        const current = state.credential
        state.tokens = undefined
        state.credential = undefined
        if (current !== undefined && persistence !== undefined)
          await runtime(
            persistence.credentials.removeOAuth(persistence.id, {
              access: current.access,
              refresh: current.refresh,
            }),
          )
        return
      }
      await persistState(state, persistence, runtime)
    },
  }
}

async function persistState(
  state: ProviderState,
  persistence?: { readonly id: Credential.ID; readonly credentials: Credential.Interface },
  runtime: <A>(effect: Effect.Effect<A>) => Promise<A> = Effect.runPromise,
) {
  if (persistence === undefined || state.credential === undefined || state.tokens === undefined) return
  const previous = state.credential
  const next = toCredential(state.tokens, state.clientInformation, state.discoveryState, previous.refresh)
  // v2 can replay the credential that won a concurrent rotation after the
  // losing flow has reloaded it. It is already durable; avoid turning that
  // replay into a second compare-and-swap write.
  if (sameCredential(previous, next)) return
  const updated = await runtime(
    persistence.credentials.updateOAuth(persistence.id, { access: previous.access, refresh: previous.refresh }, next),
  )
  if (!updated) {
    const winner = await runtime(persistence.credentials.get(persistence.id, "member"))
    if (winner?.value.type !== "oauth") {
      state.tokens = undefined
      state.clientInformation = undefined
      state.discoveryState = undefined
      state.credential = undefined
      throw new UnauthorizedError("MCP OAuth credential is no longer available")
    }
    state.tokens = fromCredential(winner.value)
    state.clientInformation = isRecord(winner.value.metadata?.clientInformation)
      ? (winner.value.metadata.clientInformation as OAuthClientInformationMixed)
      : undefined
    state.discoveryState = isRecord(winner.value.metadata?.discoveryState)
      ? (winner.value.metadata.discoveryState as unknown as OAuthDiscoveryState)
      : undefined
    state.credential = winner.value
    return
  }
  state.credential = next
}

const sameCredential = (left: OAuth, right: OAuth) =>
  left.access === right.access &&
  left.refresh === right.refresh &&
  left.expires === right.expires &&
  JSON.stringify(left.metadata) === JSON.stringify(right.metadata)

function oauthConfig(config: ConfigMCP.Remote) {
  return typeof config.oauth === "object" ? config.oauth : undefined
}

function fromCredential(credential: OAuth): OAuthTokens {
  return {
    access_token: credential.access,
    token_type: typeof credential.metadata?.tokenType === "string" ? credential.metadata.tokenType : "Bearer",
    ...(credential.refresh === "" ? {} : { refresh_token: credential.refresh }),
    ...(typeof credential.metadata?.scope === "string" ? { scope: credential.metadata.scope } : {}),
    ...(credential.expires === 0
      ? {}
      : { expires_in: Math.max(0, Math.floor((credential.expires - Date.now()) / 1_000)) }),
  }
}

function toCredential(
  tokens: OAuthTokens,
  clientInformation?: OAuthClientInformationMixed,
  discoveryState?: OAuthDiscoveryState,
  previousRefresh = "",
) {
  return OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make(methodID),
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? previousRefresh,
    expires: tokens.expires_in === undefined ? 0 : Date.now() + tokens.expires_in * 1_000,
    metadata: {
      tokenType: tokens.token_type,
      ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
      ...(clientInformation === undefined ? {} : { clientInformation }),
      ...(discoveryState === undefined ? {} : { discoveryState }),
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export * as McpOAuth from "./oauth.js"
