import { Effect, FileSystem, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpMiddleware } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AdminApi, adminHandlers } from "@bymorning/admin"
import { gatewayHandlers, spendMiddlewareLayer } from "@bymorning/gateway/api"
import { Budget } from "@bymorning/core/budget"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { ProjectFileUploadMiddleware } from "@bymorning/protocol/groups/project"
import { Api } from "./api.js"
import { handlers } from "./handlers.js"
import { AccountHandler } from "./handlers/account.js"
import { authHandler, integrationCallbackPageStyleHash } from "./handlers/auth.js"
import { UserHandler } from "./handlers/user.js"
import { AuthProviderHandler } from "./handlers/auth-provider.js"
import { InstallationHandler } from "./handlers/installation.js"
import { OAuthRawHandler } from "./handlers/oauth.js"
import { OAuthConsentHandler } from "./handlers/oauth-consent.js"
import { schemaErrorLayer } from "./middleware/schema-error.js"
import {
  accountLayer,
  gatewayMiddlewareLayer,
  sessionWorkspaceMiddlewareLayer,
  workspaceMiddlewareLayer,
} from "./middleware/auth.js"
import { Account } from "@bymorning/core/account"
import { Audit } from "@bymorning/core/audit"
import { Auth } from "@bymorning/core/auth"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Installation } from "@bymorning/core/installation"
import { User } from "@bymorning/core/user"
import { Workspace } from "@bymorning/core/workspace"
import { OAuth } from "@bymorning/core/oauth"
import { Actor } from "@bymorning/core/actor"
import { Storage } from "@bymorning/core/storage"
import { Database } from "@bymorning/core/database"
import { Share } from "@bymorning/core/share"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import { makeGlobalNode, type GlobalNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { WorkspaceMap } from "./workspace-map.js"
import { WebCookie } from "./web-cookie.js"
import { WebProvider } from "./web-provider.js"
import { WebUi } from "./web-ui.js"
import { rateLimit } from "./middleware/rate-limit.js"
import { HttpClient } from "effect/unstable/http"

/** Loopback HTTP origins are development hosts; only they may add development CORS origins. */
const isLoopback = (origin: string) => {
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
}

const hsts = "max-age=31536000; includeSubDomains"
const privateCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

/**
 * Baseline security headers on every routed (non-document) response. The SPA
 * document policy lives in WebUi; JSON and redirect responses refuse all
 * embedding, framing, and referrer leakage. The integration callback page
 * keeps its own stricter CSP with its hashed inline style.
 */
const securityHeaders = (appOrigin: string) => {
  const https = new URL(appOrigin).protocol === "https:"
  return HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const response = yield* httpEffect
      const url = request.url
      const secured = HttpServerResponse.setHeaders(
        response,
        url.startsWith("/auth/integration/callback")
          ? {
              "x-content-type-options": "nosniff",
              "x-frame-options": "DENY",
              "referrer-policy": "no-referrer",
              "permissions-policy": WebUi.permissionsPolicy,
              "cross-origin-opener-policy": "same-origin",
              "content-security-policy": `default-src 'none'; style-src '${integrationCallbackPageStyleHash}'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
            }
          : {
              "x-content-type-options": "nosniff",
              "x-frame-options": "DENY",
              "referrer-policy":
                url.startsWith("/auth/") || url.startsWith("/oauth/")
                  ? "no-referrer"
                  : "strict-origin-when-cross-origin",
              "permissions-policy": WebUi.permissionsPolicy,
              "cross-origin-opener-policy": "same-origin",
              "content-security-policy": privateCsp,
            },
      )
      // CUI responses are never stored by shared or private caches.
      const cached =
        url.startsWith("/auth/") ||
        url.startsWith("/oauth/") ||
        url === "/api" ||
        url.startsWith("/api/") ||
        url.startsWith("/inference") ||
        url === "/mcp" ||
        url.startsWith("/mcp/")
          ? HttpServerResponse.setHeader(secured, "cache-control", "no-store")
          : secured
      return https ? HttpServerResponse.setHeader(cached, "strict-transport-security", hsts) : cached
    }),
  ).layer
}

// Request body limits are chosen per request. Do not provide MaxBodySize as a Layer:
// HttpApi handlers run under their build-time context, so a Layer value would override
// every per-request limit (it silently capped /inference at 40 KiB).
// Inference matches the upstream Anthropic Messages request cap (agent requests carry images);
// authenticated API and MCP traffic carries pasted documents, Skills, and Tool arguments; the
// remaining public routes (auth, OAuth, setup) keep a small limit.
const inferenceBodyBytes = FileSystem.MiB(32)
const apiBodyBytes = FileSystem.MiB(10)
const defaultBodyBytes = FileSystem.KiB(40)
const bodyLimitFor = (url: string) =>
  url.startsWith("/inference")
    ? inferenceBodyBytes
    : url === "/api" || url.startsWith("/api/") || url.startsWith("/api?") || url === "/mcp" || url.startsWith("/mcp/") || url.startsWith("/mcp?")
      ? apiBodyBytes
      : defaultBodyBytes
// Project file uploads stream against their own 20 MiB limit (ProjectFileUploadMiddleware) and
// answer oversized bodies themselves, so the declared-length refusal below must not preempt them.
const projectFileUpload = /^\/api\/project\/[^/?]+\/directory\/file(?:\?|$)/
const bodyLimit = HttpRouter.middleware((httpEffect) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    const limit = bodyLimitFor(request.url)
    // Refuse a declared oversized body before reading it. The streaming limit destroys the
    // socket when exceeded, so the caller would otherwise see a reset instead of a 413.
    const declared = Number(request.headers["content-length"])
    if (!projectFileUpload.test(request.url) && Number.isFinite(declared) && declared > Number(limit))
      return Effect.succeed(tooLarge(request.url))
    return httpEffect.pipe(Effect.provideService(HttpServerRequest.MaxBodySize, limit))
  }),
).layer
/** 413 in the caller's native envelope for inference routes, plain JSON elsewhere. */
const tooLarge = (url: string) => {
  const message = "Request body is too large"
  const body = url.startsWith("/inference/anthropic")
    ? { type: "error", error: { type: "request_too_large", message } }
    : url.startsWith("/inference/google")
      ? { error: { code: 413, message, status: "INVALID_ARGUMENT" } }
      : { error: { message, type: "invalid_request_error", code: "request_too_large" } }
  return HttpServerResponse.jsonUnsafe(body, { status: 413 })
}
const projectFileUploadLimit = Layer.succeed(ProjectFileUploadMiddleware, (httpEffect) =>
  httpEffect.pipe(Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.MiB(20))),
)
const tokenChallenge = (appOrigin: string) =>
  HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const response = yield* httpEffect
      if (response.status !== 401) return response
      if (request.url.startsWith("/inference"))
        return HttpServerResponse.setHeader(response, "www-authenticate", "Bearer")
      if (request.url.startsWith("/mcp")) {
        const resource = new URL("/.well-known/oauth-protected-resource/mcp", appOrigin).toString()
        return HttpServerResponse.setHeader(response, "www-authenticate", `Bearer resource_metadata="${resource}"`)
      }
      return response
    }),
  ).layer
/**
 * CORS admission. Only the Application's own origin is admitted in production;
 * the Vite development origins are admitted only when the Application itself
 * runs on a loopback origin. The Anthropic SDK's direct-browser-access header
 * is deliberately absent: no supported browser caller sends it to this server.
 */
const cors = (appOrigin: string) => {
  const origins = new Set(
    isLoopback(appOrigin)
      ? [appOrigin, "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]
      : [appOrigin],
  )
  return HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => origins.has(origin),
      allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "accept",
        "authorization",
        "b3",
        "traceparent",
        "x-api-key",
        "x-goog-api-key",
        "anthropic-version",
        "anthropic-beta",
      ],
    }),
    { global: true },
  )
}

/** Options shared by every route handler Layer. */
export interface RouteOptions {
  readonly cookiePolicy?: WebCookie.Policy
  readonly seed?: {
    readonly issuer: string
    readonly clientID: string
  }
  /** Additional admitted invitation email domains, supplied only when Local Login is active. */
  readonly invitationDomains?: ReadonlyArray<string>
  /** System use notification text shown and acknowledged before sign-in continues. */
  readonly banner?: string
  /** Proxy IPs or CIDRs whose X-Forwarded-For chains are trusted for throttling. */
  readonly trustedProxies?: ReadonlyArray<string>
}

/** Complete HttpApi route Layer for production and adapter tests. */
export const makeRoutes = (appOrigin: string, options: RouteOptions = {}) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(
        Layer.mergeAll(
          handlers,
          AccountHandler(appOrigin),
          UserHandler(options.invitationDomains ?? []),
          authHandler(appOrigin, options),
          AuthProviderHandler,
          InstallationHandler,
          OAuthRawHandler(appOrigin),
          OAuthConsentHandler(appOrigin),
        ),
      ),
    ),
    gatewayHandlers,
    HttpApiBuilder.layer(AdminApi).pipe(Layer.provide(adminHandlers)),
  ).pipe(
    Layer.provide(accountLayer(options.cookiePolicy ?? WebCookie.secure, options.trustedProxies ?? [])),
    Layer.provide(gatewayMiddlewareLayer),
    Layer.provide(spendMiddlewareLayer),
    Layer.provide(workspaceMiddlewareLayer(appOrigin)),
    Layer.provide(sessionWorkspaceMiddlewareLayer(appOrigin)),
    Layer.provide(schemaErrorLayer),
    Layer.provide(securityHeaders(appOrigin)),
    Layer.provide(cors(appOrigin)),
    Layer.provide(rateLimit({ trustedProxies: options.trustedProxies ?? [] })),
    Layer.provide(projectFileUploadLimit),
    Layer.provide(tokenChallenge(appOrigin)),
    Layer.provide(bodyLimit),
  )

/** Canonical process route node; Workspace capabilities are supplied dynamically by request middleware. */
export const routes = <E>(
  appOrigin: string,
  dependencies: {
    readonly workspaces: GlobalNode<WorkspaceMap.Service, E>
    readonly cookie: GlobalNode<WebCookie.Service, E>
    readonly provider: GlobalNode<WebProvider.Service, E>
    readonly oauthCallback: GlobalNode<IntegrationOAuthCallback.Service, E>
    readonly httpClient?: GlobalNode<HttpClient.HttpClient, E>
    readonly cookiePolicy?: WebCookie.Policy
    readonly database?: GlobalNode<Database.Service, E>
    readonly share?: GlobalNode<Share.Service, E>
    readonly storage?: GlobalNode<Storage.Service, E>
    readonly account?: GlobalNode<Account.Service, E>
    readonly user?: GlobalNode<User.Service, E>
    readonly auth?: GlobalNode<Auth.Service, E>
    readonly authProvider?: GlobalNode<AuthProvider.Service, E>
    readonly workspace?: GlobalNode<Workspace.Service, E>
    readonly oauth?: GlobalNode<OAuth.Service, E>
    readonly llmGateway: GlobalNode<LLMGateway.Service, E>
    readonly toolGateway: GlobalNode<ToolGateway.Service, E>
    readonly toolRuntime: GlobalNode<ToolGateway.Runtime.Service, E>
    readonly seed?: {
      readonly issuer: string
      readonly clientID: string
    }
    readonly invitationDomains?: ReadonlyArray<string>
    readonly banner?: string
    readonly trustedProxies?: ReadonlyArray<string>
  },
) => {
  // HttpApiBuilder retains the request-time Workspace requirements statically even though
  // WorkspaceMiddleware supplies the bound Workspace Layer dynamically.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- middleware supplies the bound Workspace Layer
  const routes = makeRoutes(appOrigin, {
    ...(dependencies.cookiePolicy === undefined ? {} : { cookiePolicy: dependencies.cookiePolicy }),
    ...(dependencies.seed === undefined ? {} : { seed: dependencies.seed }),
    ...(dependencies.invitationDomains === undefined ? {} : { invitationDomains: dependencies.invitationDomains }),
    ...(dependencies.banner === undefined ? {} : { banner: dependencies.banner }),
    ...(dependencies.trustedProxies === undefined ? {} : { trustedProxies: dependencies.trustedProxies }),
  }).pipe(
    Layer.provide(WebUi.layer({ https: new URL(appOrigin).protocol === "https:" })),
  ) as Layer.Layer<HttpRouter.HttpRouter>
  return makeGlobalNode({
    service: HttpRouter.HttpRouter,
    layer: routes,
    deps: [
      dependencies.database ?? Database.node,
      dependencies.share ?? Share.node,
      Installation.node,
      dependencies.account ?? Account.node,
      dependencies.user ?? User.node,
      dependencies.auth ?? Auth.node,
      Audit.node,
      dependencies.authProvider ?? AuthProvider.node,
      dependencies.workspace ?? Workspace.node,
      dependencies.oauth ?? OAuth.node,
      Actor.node,
      Budget.node,
      dependencies.llmGateway,
      dependencies.toolGateway,
      dependencies.toolRuntime,
      // The Config handler releases the retained Gateway lease after Workspace policy changes.
      LLMGateway.lease,
      dependencies.workspaces,
      dependencies.storage ?? Storage.defaultNode,
      dependencies.cookie,
      dependencies.provider,
      dependencies.oauthCallback,
      dependencies.httpClient ?? LayerNodePlatform.httpClient,
    ],
  })
}
