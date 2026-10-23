import { Auth } from "@bymorning/core/auth"
import { Audit } from "@bymorning/core/audit"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { AuthSchema } from "@bymorning/schema/auth"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import { ForbiddenError, InputError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { DateTime, Duration, Effect, Option, Redacted, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { WebCookie } from "../web-cookie.js"
import { endSession, readSession, requestContext, reservedCookieValues } from "../middleware/auth.js"

class CallbackError extends Schema.TaggedError<CallbackError>()("AuthCallbackError", {}) {}

// Match the default ByMorning theme on this standalone, script-free page.
const integrationCallbackPageStyle = `
@font-face {
  font-family: "Atkinson Hyperlegible Next";
  src: url("/assets/fonts/AtkinsonHyperlegibleNext/AtkinsonHyperlegibleNext-Regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Atkinson Hyperlegible Next";
  src: url("/assets/fonts/AtkinsonHyperlegibleNext/AtkinsonHyperlegibleNext-SemiBold.woff2") format("woff2");
  font-weight: 600;
  font-display: swap;
}
:root {
  color-scheme: light dark;
  font-family: "Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif;
  background: #f7f6f4;
  color: #100902;
  --surface: #fff;
  --muted: #544d44;
  --border: rgba(16, 9, 2, .1);
  --accent-soft: rgba(238, 138, 62, .12);
}
* { box-sizing: border-box; }
body { display: grid; min-height: 100vh; min-height: 100dvh; margin: 0; padding: 24px; place-items: center; }
main { width: min(400px, 100%); }
section { padding: 32px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 2px 4px rgba(16, 9, 2, .04), 0 1px 2px rgba(16, 9, 2, .08); }
[data-slot=icon] { display: grid; width: 40px; height: 40px; margin-bottom: 24px; place-items: center; border: 1px solid rgba(238, 138, 62, .25); border-radius: 10px; background: var(--accent-soft); color: #a34d0c; }
[data-slot=icon] svg { width: 20px; height: 20px; }
h1 { margin: 0 0 12px; font-size: 26px; font-weight: 600; line-height: 1.2; letter-spacing: -.025em; text-wrap: balance; }
p { margin: 0; font-size: 15px; line-height: 1.5; }
[data-slot=description] { color: var(--muted); }
a { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; margin-top: 28px; padding: 8px 16px; border: 1px solid rgba(35, 27, 16, .15); border-radius: 6px; background: linear-gradient(180deg, rgba(255, 255, 255, .2), transparent), #ee8a3e; color: #231b10; font-size: 15px; font-weight: 600; text-decoration: none; box-shadow: 0 1px 1.5px rgba(16, 9, 2, .1); }
a:hover { background: #e68135; }
a:active { background: #d97830; }
a:focus-visible { outline: 2px solid #ee8a3e; outline-offset: 4px; }
a svg { width: 16px; height: 16px; }
@media (max-width: 420px) { body { padding: 20px; } section { padding: 24px; } }
@media (prefers-color-scheme: dark) {
  :root { background: #121110; color: #fefdfd; --surface: #1d1b19; --muted: #cdc8c5; --border: rgba(255, 255, 255, .1); }
  [data-slot=icon] { color: #ee8a3e; }
}
`
export const integrationCallbackPageStyleHash = "sha256-rUpXgSWTvfYfMhCasLmD39NLtF8NAku7yvpNTAZV7Go="
const integrationCallbackPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Integration authorization · ByMorning</title>
  <style>${integrationCallbackPageStyle}</style>
</head>
<body>
  <main>
    <section aria-labelledby="title">
      <div data-slot="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>
      </div>
      <h1 id="title">Authorization response received</h1>
      <p data-slot="description">You can close this tab and return to ByMorning.</p>
      <a href="/">Return to ByMorning<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></a>
    </section>
  </main>
</body>
</html>`

const redirect = (location: URL, status: 302 | 303) =>
  HttpServerResponse.empty({
    status,
    headers: {
      location: location.href,
      "cache-control": "no-store",
    },
  })

const unavailable = () => new ServiceUnavailableError({ message: "Authentication is unavailable" })

type FailureReason = AuthSchema.FailureReason

/** Auth rejection reasons projected onto the coarse redirect reason. */
const rejectedReason = {
  exchange: "exchange",
  token: "exchange",
  "email-missing": "claims",
  "email-unverified": "claims",
  "email-domain": "domain",
  "provider-missing": "provider",
  "provider-disabled": "provider",
  "provider-changed": "provider",
  "local-disabled": "provider",
  state: "expired",
  "account-unavailable": "account",
  provisioning: "account",
  "session-revoked": "unknown",
  "session-idle": "unknown",
  response: "unknown",
  callback: "unknown",
} as const satisfies Record<Auth.RejectedError["reason"], FailureReason>

/** Project a callback failure onto its coarse reason. */
const callbackReason = (stage: string, error: unknown): FailureReason => {
  // No readable attempt cookie: it expired, was lost, or belongs to another browser.
  if (stage === "attempt-cookie") return "expired"
  if (error instanceof Auth.ExpiredError) return "expired"
  if (error instanceof Auth.RejectedError) return rejectedReason[error.reason]
  return "unknown"
}

/** Loopback origins admit Local Login; Core Auth enforces the same callback rule when opening. */
const isLoopback = (origin: string) => {
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
}

/** Public Auth flow. All expected callback failures collapse to one safe redirect. */
export const authHandler = (
  appOrigin: string,
  {
    cookiePolicy: policy = WebCookie.secure,
    seed,
    banner,
  }: {
    readonly cookiePolicy?: WebCookie.Policy
    readonly seed?: {
      readonly issuer: string
      readonly clientID: string
    }
    /** System use notification text reported by auth.method; the sign-in page requires acknowledgment. */
    readonly banner?: string
  } = {},
) =>
  HttpApiBuilder.group(Api, "auth", (handlers) => {
    const attemptName = policy.attemptName
    const options = { secure: policy.secure, httpOnly: true, sameSite: "lax" } as const
    const expireAttempt = HttpServerResponse.setCookieUnsafe(attemptName, "", {
      ...options,
      path: "/auth/callback",
      maxAge: 0,
    })
    const attemptCookie = (value: string) =>
      HttpServerResponse.setCookieUnsafe(attemptName, value, {
        ...options,
        path: "/auth/callback",
        maxAge: WebCookie.attemptLifetime,
      })
    const sessionCookie = (maxAge: Duration.Duration) => (value: string) =>
      HttpServerResponse.setCookieUnsafe(policy.accountName, value, {
        ...options,
        path: "/",
        // The cookie never outlives the configured absolute Login Session lifetime.
        maxAge,
      })
    const expireAccount = HttpServerResponse.setCookieUnsafe(policy.accountName, "", {
      ...options,
      path: "/",
      maxAge: 0,
    })
    const callback = Effect.fn("AuthHandler.callback")(function* (query: {
      readonly code: string
      readonly state: string
    }) {
      const failure = (reason: FailureReason) => {
        const location = new URL("/login", appOrigin)
        location.searchParams.set("auth", "failed")
        location.searchParams.set("reason", reason)
        return redirect(location, 303).pipe(expireAttempt)
      }
      let stage = "query"
      const completed = Effect.gen(function* () {
        stage = "attempt-cookie"
        const cookies = yield* WebCookie.Service
        const request = yield* HttpServerRequest.HttpServerRequest
        const found = reservedCookieValues(Option.getOrUndefined(Headers.get(request.headers, "cookie")), attemptName)
        const [raw] = found
        if (found.length !== 1 || raw === undefined || raw === "") return yield* new CallbackError({})
        const wire = yield* Schema.decodeUnknownEffect(WebCookie.Value)(Redacted.make(raw))
        const attempt = yield* cookies.decrypt(wire)
        if (attempt.type !== "attempt") return yield* new CallbackError({})
        stage = "complete"
        const auth = yield* Auth.Service
        const context = yield* requestContext()
        const finished = yield* auth
          .complete({
            attempt,
            response: Redacted.make(new URLSearchParams({ code: query.code, state: query.state })),
          })
          .pipe(Effect.provideService(Audit.RequestContext, context))
        stage = "session-cookie"
        const limits = yield* Auth.sessionLimits.pipe(Effect.mapError(() => new CallbackError({})))
        const sessionValue = yield* cookies.encrypt(finished.session)
        return redirect(new URL(attempt.redirect ?? "/", appOrigin), 303).pipe(
          sessionCookie(limits.absolute)(Redacted.value(sessionValue)),
          expireAttempt,
        )
      })
      return yield* completed.pipe(
        Effect.catch((error) => {
          const reason = callbackReason(stage, error)
          return Effect.logWarning("Authentication callback failed").pipe(
            Effect.annotateLogs({
              stage,
              error: error._tag,
              ...(error instanceof Auth.RejectedError || error instanceof Auth.ExpiredError
                ? { rejection: error.reason }
                : {}),
              reason,
            }),
            Effect.as(failure(reason)),
          )
        }),
        Effect.catchDefect(() =>
          Effect.logWarning("Authentication callback failed").pipe(
            Effect.annotateLogs({ stage, reason: "unknown" }),
            Effect.as(failure("unknown")),
          ),
        ),
      )
    })
    return handlers
      .handle(
        "auth.login",
        Effect.fn("AuthHandler.login")(function* ({ query }) {
          const cookies = yield* WebCookie.Service
          const auth = yield* Auth.Service
          const loginRedirect =
            query.redirect?.startsWith("/") === true &&
            !query.redirect.startsWith("//") &&
            URL.canParse(query.redirect, appOrigin)
              ? new URL(query.redirect, appOrigin)
              : undefined
          const redirectPath = loginRedirect?.origin === appOrigin ? query.redirect : undefined
          let selection: Auth.Selection
          let redirectURI: URL
          if (query.provider === undefined) {
            selection = { type: "local" }
            redirectURI = new URL("/auth/callback", appOrigin)
          } else {
            const id = yield* Schema.decodeUnknownEffect(AuthProviderSchema.ID)(query.provider).pipe(
              Effect.mapError(() => unavailable()),
            )
            selection = { type: "oidc", id }
            redirectURI = new URL(`/auth/callback/${id}`, appOrigin)
            if (seed !== undefined) {
              const providers = yield* AuthProvider.Service
              const info = yield* providers.get(id).pipe(Effect.option)
              if (Option.isSome(info) && info.value.issuer === seed.issuer && info.value.clientID === seed.clientID) {
                redirectURI = new URL("/auth/callback", appOrigin)
              }
            }
          }
          const opened = yield* auth
            .open({
              selection,
              redirectURI,
              ...(redirectPath === undefined ? {} : { redirect: redirectPath }),
            })
            .pipe(
              Effect.tapError((error) =>
                Effect.logWarning("Authentication start failed").pipe(Effect.annotateLogs({ error: error._tag })),
              ),
              Effect.mapError(() => unavailable()),
              Effect.catchDefect((defect) =>
                Effect.logWarning("Authentication start failed", defect).pipe(
                  Effect.andThen(Effect.fail(unavailable())),
                ),
              ),
            )
          const value = yield* cookies.encrypt(opened.attempt).pipe(Effect.mapError(() => unavailable()))
          return redirect(opened.redirect, 302).pipe(attemptCookie(Redacted.value(value)))
        }),
      )
      .handle(
        "auth.callback",
        Effect.fn("AuthHandler.legacyCallback")(function* ({ query }) {
          return yield* callback(query)
        }),
      )
      .handle(
        "auth.callbackProvider",
        Effect.fn("AuthHandler.providerCallback")(function* ({ query }) {
          return yield* callback(query)
        }),
      )
      .handle(
        "auth.method",
        Effect.fn("AuthHandler.method")(function* () {
          const providers = yield* AuthProvider.Service
          const limits = yield* Auth.sessionLimits.pipe(Effect.mapError(() => unavailable()))
          const idleTimeout = Duration.toMillis(limits.idle)
          const infos = yield* providers.list().pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Authentication method is unavailable").pipe(
                Effect.annotateLogs({ error: error._tag }),
              ),
            ),
            Effect.mapError(() => unavailable()),
            Effect.catchDefect((defect) =>
              Effect.logWarning("Authentication method is unavailable", defect).pipe(
                Effect.andThen(Effect.fail(unavailable())),
              ),
            ),
          )
          const callbackBase = new URL("/auth/callback", appOrigin).href
          const enabled = infos.filter((info) => info.status === "enabled")
          const local = isLoopback(appOrigin)
          const notice = banner === undefined || banner === "" ? {} : { banner }
          if (enabled.length === 0 && !local) return { state: "setup", callbackBase, idleTimeout, ...notice } as const
          return {
            state: "ready",
            callbackBase,
            providers: enabled.map((info) => ({
              id: info.id,
              displayName: info.displayName,
              kind: info.kind,
            })),
            local,
            idleTimeout,
            ...notice,
          } as const
        }),
      )
      .handle(
        "auth.inspect",
        Effect.fn("AuthHandler.inspect")(function* ({ payload }) {
          if (payload.token.length === 0) return yield* new InputError({ error: "Setup token is required" })
          const providers = yield* AuthProvider.Service
          const infos = yield* providers.inspect(Redacted.make(payload.token)).pipe(
            Effect.catchTags({
              "AuthProvider.TokenError": () => Effect.fail(new ForbiddenError({ message: "Setup token is incorrect" })),
              "AuthProvider.UnavailableError": () => Effect.fail(unavailable()),
            }),
            Effect.catchDefect((defect) =>
              Effect.logWarning("Authentication inspect is unavailable", defect).pipe(
                Effect.andThen(Effect.fail(unavailable())),
              ),
            ),
          )
          return [...infos]
        }),
      )
      .handle(
        "auth.setup",
        Effect.fn("AuthHandler.setup")(function* ({ payload }) {
          const input = yield* Schema.decodeUnknownEffect(AuthProviderSchema.Setup)(payload).pipe(
            Effect.mapError(() => new InputError({ error: "Auth Provider setup input is invalid" })),
          )
          const providers = yield* AuthProvider.Service
          return yield* providers.setup(input).pipe(
            Effect.tapError((error) =>
              error._tag === "AuthProvider.DiscoveryError"
                ? Effect.logWarning("Auth Provider discovery failed").pipe(Effect.annotateLogs({ reason: error.reason }))
                : Effect.void,
            ),
            Effect.catchTags({
              "AuthProvider.TokenError": () => Effect.fail(new ForbiddenError({ message: "Setup token is incorrect" })),
              "AuthProvider.MissingError": (error) => Effect.fail(new InputError({ error: error.message })),
              "AuthProvider.ConflictError": (error) => Effect.fail(new InputError({ error: error.message })),
              // Discovery messages name only the operator-supplied issuer origin
              // and the remedy; an unreachable issuer is a Gateway egress fault.
              "AuthProvider.DiscoveryError": (error) =>
                error.reason === "unreachable"
                  ? Effect.fail(new ServiceUnavailableError({ message: error.message }))
                  : Effect.fail(new InputError({ error: error.message })),
              "AuthProvider.UnavailableError": () => Effect.fail(unavailable()),
            }),
            Effect.catchDefect((defect) =>
              Effect.logWarning("Authentication setup is unavailable", defect).pipe(
                Effect.andThen(Effect.fail(unavailable())),
              ),
            ),
          )
        }),
      )
      .handle(
        "auth.integration.callback",
        Effect.fn("AuthHandler.integrationCallback")(function* ({ query }) {
          const callback = yield* IntegrationOAuthCallback.Service
          const delivered = yield* callback.deliver({
            ...(query.state === undefined ? {} : { state: query.state }),
            ...(query.code === undefined ? {} : { code: query.code }),
            ...(query.error === undefined ? {} : { error: query.error }),
            ...(query.error_description === undefined ? {} : { errorDescription: query.error_description }),
          })
          if (!delivered) return HttpServerResponse.empty({ status: 503, headers: { "cache-control": "no-store" } })
          return redirect(new URL("/auth/integration/callback/complete", appOrigin), 303)
        }),
      )
      .handle(
        "auth.integration.page",
        Effect.fn("AuthHandler.integrationCallbackPage")(() => Effect.succeed(integrationCallbackPage)),
      )
      .handle(
        "auth.logout",
        Effect.fn("AuthHandler.logout")(function* ({ headers }) {
          if (headers.origin !== appOrigin) return yield* new ForbiddenError({ message: "Origin not allowed" })
          // Revoke the durable Login Session when its cookie is readable, and
          // record the logout with the session's Account. A missing or
          // unreadable cookie still completes logout client-side.
          const context = yield* requestContext()
          const session = yield* readSession(policy).pipe(Effect.option)
          if (Option.isSome(session)) {
            yield* Audit.record({
              actor: { type: "account", accountID: session.value.accountID },
              action: "auth.logout",
              target: session.value.accountID,
              outcome: "success",
            }).pipe(
              Effect.provideService(Audit.RequestContext, context),
              Effect.catchTag("Audit.StoreError", (cause) =>
                Effect.logError("Audit could not record a logout", cause),
              ),
            )
            yield* endSession(session.value)
          }
          return HttpServerResponse.empty({ status: 204, headers: { "cache-control": "no-store" } }).pipe(expireAccount)
        }),
      )
  })
