/** Exposes the Share contract owned by this module. */
export * as Share from "./share.js"

import { Message } from "@bymorning/schema/message"
import { Share } from "@bymorning/schema/share"
import { type Session } from "@bymorning/schema/session"
import { type Workspace } from "@bymorning/schema/workspace"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { and, asc, eq } from "drizzle-orm"
import { Array, Context, Effect, Layer, Option, Schema } from "effect"
import { Database, SessionMessageTable, SessionTable } from "./database.js"
import { Storage } from "./storage.js"

/** The requested Share token does not resolve to a public Session view. */
export const NotFoundError = Share.NotFoundError
/** The requested Share token does not resolve to a public Session view. */
export type NotFoundError = Share.NotFoundError

/** Namespace used by the Share plugin's durable grants. */
export const PluginID = "bymorning.share"

/** Storage key for a Session's Share grant. */
export const sessionKey = (sessionID: Session.ID) => `session:${sessionID}`

/** Storage key resolving a Share token to its Session. */
export const tokenKey = (token: Share.Token) => `token:${token}`

/** Reads the public, durable view authorized by a Share token. */
export interface Interface {
  readonly get: (input: {
    readonly workspaceID: Workspace.ID
    readonly token: Share.Token
  }) => Effect.Effect<Share.View, NotFoundError>
}

/** Application-wide Share read authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Share") {}

/** Share read implementation backed by plugin storage and durable Sessions. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const database = yield* Database.Service

    return Service.of({
      get: Effect.fn("Share.get")(function* (input) {
        const notFound = () => new Share.NotFoundError({ workspaceID: input.workspaceID, token: input.token })
        const scoped = storage.scope({ workspaceID: input.workspaceID, pluginID: PluginID })
        const lookupValue = yield* scoped.get(tokenKey(input.token)).pipe(Effect.mapError(notFound))
        if (lookupValue === undefined) return yield* notFound()
        const lookup = yield* Schema.decodeUnknownEffect(Share.Lookup)(lookupValue).pipe(Effect.mapError(notFound))

        const grantValue = yield* scoped.get(sessionKey(lookup.sessionID)).pipe(Effect.mapError(notFound))
        if (grantValue === undefined) return yield* notFound()
        const grant = yield* Schema.decodeUnknownEffect(Share.Grant)(grantValue).pipe(Effect.mapError(notFound))
        if (grant.token !== input.token) return yield* notFound()

        const session = yield* database.use("Share.get", (db) =>
          db
            .select({ id: SessionTable.id, title: SessionTable.title })
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, input.workspaceID), eq(SessionTable.id, lookup.sessionID)))
            .limit(1)
            .pipe(Effect.map(Array.head), Effect.orDie),
        )
        if (Option.isNone(session)) return yield* notFound()

        const rows = yield* database.use("Share.get", (db) =>
          db
            .select({ data: SessionMessageTable.data })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.sessionID, lookup.sessionID))
            .orderBy(asc(SessionMessageTable.sequence))
            .pipe(Effect.orDie),
        )
        const messages = yield* Effect.forEach(rows, (row) => Schema.decodeUnknownEffect(Message)(row.data).pipe(Effect.orDie))

        return Share.View.make({
          workspaceID: input.workspaceID,
          sessionID: lookup.sessionID,
          title: session.value.title,
          token: input.token,
          createdAt: grant.createdAt,
          messages,
        })
      }),
    })
  }),
)

/** Process-global Share authority. */
export const node = makeGlobalNode({ service: Service, layer, deps: [Storage.node, Database.node] })
