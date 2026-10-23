import { Auth } from "@bymorning/core/auth"
import { Audit } from "@bymorning/core/audit"
import type { Audit as AuditSchema } from "@bymorning/schema/audit"
import { User } from "@bymorning/core/user"
import { AccountTable, Database, SessionTable, UserTable, WorkspaceTable } from "@bymorning/core/database"
import { AccountActor, UserActor } from "@bymorning/schema/actor"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import {
  ForbiddenError,
  InvalidRequestError,
  SessionNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@bymorning/protocol/errors"
import { CurrentAccount, CurrentSession } from "@bymorning/protocol/middleware/account-middleware"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Effect, Layer, Option, Redacted, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpRouter } from "effect/unstable/http"
import { and, eq } from "drizzle-orm"
import { WorkspaceMap } from "../workspace-map.js"
import { Plugin } from "@bymorning/core/plugin"
import { WebCookie } from "../web-cookie.js"
import { AccountMiddleware, SessionWorkspaceMiddleware, WorkspaceMiddleware } from "../api.js"
import { GatewayActor, GatewayMiddleware } from "@bymorning/gateway/api"
import { Actor } from "@bymorning/core/actor"
import { clientIP, parseTrustedProxy } from "./rate-limit.js"

/** Client network context for the Audit record, from the connection peer and headers. */
export const requestContext = (trusted: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const proxies = trusted.map(parseTrustedProxy).filter((proxy) => proxy !== undefined)
    return {
      ip: clientIP({
        peer: Option.getOrUndefined(request.remoteAddress),
        forwardedFor: Option.getOrUndefined(Headers.get(request.headers, "x-forwarded-for")),
        trusted: proxies,
      }),
      userAgent: Option.getOrUndefined(Headers.get(request.headers, "user-agent")),
    } satisfies AuditSchema.Context
  })

const unauthorized = () => new UnauthorizedError({ message: "Authentication required" })
const unavailable = () => new ServiceUnavailableError({ message: "Authentication is unavailable" })
const unavailableDefect = (operation: string) =>
  Effect.logError("Authentication dependency failed").pipe(
    Effect.annotateLogs({ operation }),
    Effect.andThen(Effect.fail(unavailable())),
  )

export const accountCookieName = "__Host-bm_auth"

/** Raw reserved-cookie parsing rejects duplicate names before any cookie-map normalization. */
export const reservedCookieValues = (header: string | undefined, name: string): ReadonlyArray<string> =>
  header === undefined
    ? []
    : header
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${name}=`))
        .map((part) => part.slice(name.length + 1))

/** Strict Login Session cookie authentication. Raw parsing prevents cookie shadowing. */
export const accountLayer = (policy: WebCookie.Policy = WebCookie.secure, trustedProxies: ReadonlyArray<string> = []) =>
  Layer.effect(
    AccountMiddleware,
    Effect.gen(function* () {
      const cookies = yield* WebCookie.Service
      const auth = yield* Auth.Service
      const authenticate = (httpEffect: Parameters<ReturnType<typeof AccountMiddleware.of>["cookie"]>[0]) =>
        Effect.gen(function* () {
          const session = yield* readSession(policy).pipe(Effect.provideService(WebCookie.Service, cookies))
          const actor = yield* auth.authenticate(session).pipe(
            Effect.mapError(() => unauthorized()),
            Effect.catchDefect(() => unavailableDefect("auth.authenticate")),
          )
          const context = yield* requestContext(trustedProxies)
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentAccount, actor),
            Effect.provideService(CurrentSession, session),
            Effect.provideService(Audit.RequestContext, context),
          )
        })
      return AccountMiddleware.of({
        cookie: authenticate,
      })
    }),
  )

export const accountMiddlewareLayer = accountLayer()

/** Decrypt the Login Session cookie into a Core Auth Session. All failures are the existing 401. */
export const readSession = (policy: WebCookie.Policy = WebCookie.secure) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const cookies = yield* WebCookie.Service
    const values = reservedCookieValues(
      Option.getOrUndefined(Headers.get(request.headers, "cookie")),
      policy.accountName,
    )
    const [raw] = values
    if (values.length !== 1 || raw === undefined || raw === "") return yield* unauthorized()
    const value = yield* Schema.decodeUnknownEffect(WebCookie.Value)(Redacted.make(raw)).pipe(
      Effect.mapError(unauthorized),
    )
    const payload = yield* cookies.decrypt(value).pipe(Effect.mapError(unauthorized))
    if (payload.type !== "session") return yield* unauthorized()
    return payload
  })

/** End a Login Session for the logout path. The handler resolves the session, calls this, then expires the cookie. */
export const endSession = (session: Auth.Session) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* auth.end(session).pipe(
      Effect.mapError(() => unavailable()),
      Effect.catchDefect(() => unavailableDefect("auth.end")),
    )
  })

/** Expire the Login Session cookie for the logout path. */
export const expireSession = (policy: WebCookie.Policy = WebCookie.secure) =>
  HttpServerResponse.setCookieUnsafe(policy.accountName, "", {
    secure: policy.secure,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  })

/** Authenticate dedicated Gateway requests without coupling its contract to the control-plane Protocol API. */
export const gatewayMiddlewareLayer = Layer.effect(
  GatewayMiddleware,
  Effect.gen(function* () {
    const actors = yield* Actor.Service
    return GatewayMiddleware.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const authorization = Option.getOrUndefined(Headers.get(request.headers, "authorization"))
        const apiKey = Option.getOrUndefined(Headers.get(request.headers, "x-api-key"))
        const googleApiKey = Option.getOrUndefined(Headers.get(request.headers, "x-goog-api-key"))
        const token =
          authorization === undefined ? (apiKey === undefined ? googleApiKey : apiKey) : bearerToken(authorization)
        if (token === undefined) return yield* unauthorized()
        const actor = yield* actors.resolve(Redacted.make(token)).pipe(
          Effect.mapError(() => unauthorized()),
          Effect.catchDefect(() => unavailableDefect("actor.resolve")),
        )
        return yield* httpEffect.pipe(Effect.provideService(GatewayActor, actor))
      }),
    )
  }),
)

/** Authorization has strict precedence and accepts only a non-empty Bearer credential. */
const bearerToken = (authorization: string): string | undefined => {
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  return match?.[1]
}

const unsafe = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const validateOrigin = (request: HttpServerRequest.HttpServerRequest, appOrigin: string) =>
  unsafe.has(request.method) && Option.getOrUndefined(Headers.get(request.headers, "origin")) !== appOrigin
    ? Effect.fail(new ForbiddenError({ message: "Origin not allowed" }))
    : Effect.void

/** Select membership once and provide the complete bound Workspace capability Layer. */
export const workspaceMiddlewareLayer = (appOrigin: string) =>
  Layer.effect(
    WorkspaceMiddleware,
    Effect.gen(function* () {
      const users = yield* User.Service
      const workspaceMap = yield* WorkspaceMap.Service
      return WorkspaceMiddleware.of((httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* validateOrigin(request, appOrigin)
          const account = yield* CurrentAccount
          const raw = new URL(request.url, appOrigin).searchParams.get("workspace")
          const workspaceID =
            raw === null
              ? undefined
              : yield* Schema.decodeUnknownEffect(Workspace.ID)(raw).pipe(
                  Effect.mapError(() => new InvalidRequestError({ message: "Invalid request" })),
                )
          const actor = yield* users.select({ account, ...(workspaceID === undefined ? {} : { workspaceID }) }).pipe(
            Effect.mapError(() => unauthorized()),
            Effect.catchDefect(() => unavailableDefect("user.select")),
          )
          const ready = requiresPlugins(new URL(request.url, appOrigin).pathname)
            ? Plugin.awaitActivation.pipe(
                Effect.mapError(() => new ServiceUnavailableError({ message: "Required Plugin is unavailable" })),
                Effect.andThen(httpEffect),
              )
            : httpEffect
          return yield* ready.pipe(
            Effect.provide(workspaceMap.get(actor.properties)),
            Effect.provideService(CurrentActor, actor),
          )
        }),
      )
    }),
  )

const requiresPlugins = (pathname: string) =>
  [
    "/api/agent",
    "/api/skill",
    "/api/integration",
    "/api/credential",
    "/api/command",
    "/api/reference",
    "/api/config",
    "/api/mcp",
    "/api/session",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

/** Bind persisted Session endpoints to the Workspace recorded on the globally unique Session row. */
export const sessionWorkspaceMiddlewareLayer = (appOrigin: string) =>
  Layer.effect(
    SessionWorkspaceMiddleware,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const workspaceMap = yield* WorkspaceMap.Service
      return SessionWorkspaceMiddleware.of((httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* validateOrigin(request, appOrigin)
          const route = yield* HttpRouter.RouteContext
          const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(route.params.sessionID).pipe(
            Effect.mapError(() => new InvalidRequestError({ message: "Invalid request" })),
          )
          const account = yield* CurrentAccount
          const [session] = yield* database
            .use("SessionWorkspaceMiddleware.lookup", (db) =>
              db
                .select({
                  workspaceID: SessionTable.workspaceID,
                  userID: SessionTable.userID,
                  accountID: UserTable.accountId,
                  role: UserTable.role,
                  userDeleted: UserTable.timeDeleted,
                  accountStatus: AccountTable.status,
                  accountDeleted: AccountTable.timeDeleted,
                  workspaceStatus: WorkspaceTable.status,
                  workspaceDeleted: WorkspaceTable.timeDeleted,
                })
                .from(SessionTable)
                .innerJoin(
                  UserTable,
                  and(eq(UserTable.id, SessionTable.userID), eq(UserTable.workspaceId, SessionTable.workspaceID)),
                )
                .innerJoin(AccountTable, eq(AccountTable.id, UserTable.accountId))
                .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, SessionTable.workspaceID))
                .where(eq(SessionTable.id, sessionID))
                .limit(1),
            )
            .pipe(
              Effect.mapError(unavailable),
              Effect.catchDefect(() => unavailableDefect("session.lookup")),
            )
          if (session === undefined) {
            return yield* new SessionNotFoundError({ sessionID, message: `Session not found: ${sessionID}` })
          }
          const sessionAccountID = session.accountID
          if (
            sessionAccountID === null ||
            sessionAccountID !== account.properties.accountID ||
            session.userDeleted !== null ||
            session.accountStatus !== "active" ||
            session.accountDeleted !== null ||
            session.workspaceStatus !== "active" ||
            session.workspaceDeleted !== null
          ) {
            return yield* unauthorized()
          }
          const actor = new UserActor({
            type: "user",
            properties: {
              workspaceID: session.workspaceID,
              userID: session.userID,
              accountID: sessionAccountID,
              role: session.role,
            },
          })
          return yield* Plugin.awaitActivation.pipe(
            Effect.mapError(() => new ServiceUnavailableError({ message: "Required Plugin is unavailable" })),
            Effect.andThen(httpEffect),
            Effect.provide(workspaceMap.get({ ...session, accountID: sessionAccountID })),
            Effect.provideService(CurrentActor, actor),
          )
        }),
      )
    }),
  )
