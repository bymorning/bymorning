import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as ToolUsage from "./tool-usage.js"

import { Session } from "@bymorning/schema/session"
import { ToolUsageSchema } from "@bymorning/schema/tool-usage"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database, SessionTable, ToolUsageTable } from "./database.js"
import { PluginHooks } from "./plugin/hooks.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "./actor.js"

/** A Tool Usage pagination cursor is malformed or belongs to different filters. */
export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()("ToolUsage.InvalidCursorError", {}) {}

/** Read-only Tool invocation history in one Workspace. */
export interface Interface {
  readonly records: (input?: {
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: User.ID
    readonly sessionID?: Session.ID
  }) => Effect.Effect<
    { readonly data: ReadonlyArray<ToolUsageSchema.Record>; readonly cursor?: string },
    InvalidCursorError
  >
}

/** Read-only Tool invocation history in one Workspace. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ToolUsage") {}

const RecordCursor = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("tool-usage-record"),
  occurredAt: Schema.DateFromString,
  id: ToolUsageSchema.ID,
  userID: Schema.NullOr(User.ID),
  sessionID: Schema.NullOr(Session.ID),
})

/** PostgreSQL-backed Tool Usage reader for one Workspace. */
export const layer = (workspaceID: Workspace.ID) =>
  Layer.effect(
    Service,
    Database.Service.use((database) =>
      Effect.succeed(
        Service.of({
          records: Effect.fn("ToolUsage.records")(function* (input = {}) {
            const userID = input.userID ?? null
            const sessionID = input.sessionID ?? null
            const cursor =
              input.cursor === undefined
                ? undefined
                : yield* Effect.try(() => JSON.parse(Buffer.from(input.cursor!, "base64url").toString("utf8"))).pipe(
                    Effect.flatMap(Schema.decodeUnknownEffect(RecordCursor)),
                    Effect.filterOrFail(
                      (decoded) => decoded.userID === userID && decoded.sessionID === sessionID,
                      () => new InvalidCursorError(),
                    ),
                    Effect.mapError(() => new InvalidCursorError()),
                  )
            const requestedLimit = input.limit ?? 50
            const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 50
            const rows = yield* database.use("toolUsageRecords", (db) =>
              db
                .select()
                .from(ToolUsageTable)
                .where(
                  and(
                    eq(ToolUsageTable.workspaceID, workspaceID),
                    input.userID === undefined ? undefined : eq(ToolUsageTable.userID, input.userID),
                    input.sessionID === undefined ? undefined : eq(ToolUsageTable.sessionID, input.sessionID),
                    cursor === undefined
                      ? undefined
                      : or(
                          lt(ToolUsageTable.occurredAt, cursor.occurredAt),
                          and(eq(ToolUsageTable.occurredAt, cursor.occurredAt), gt(ToolUsageTable.id, cursor.id)),
                        ),
                  ),
                )
                .orderBy(desc(ToolUsageTable.occurredAt), asc(ToolUsageTable.id))
                .limit(limit + 1)
                .pipe(Effect.orDie),
            )
            const selected = rows.slice(0, limit)
            const data = selected.map((row) => ToolUsageSchema.Record.make(row))
            const last = selected.at(-1)
            if (rows.length <= limit || last === undefined) return { data }
            return {
              data,
              cursor: Buffer.from(
                JSON.stringify({
                  version: 1,
                  kind: "tool-usage-record",
                  occurredAt: last.occurredAt.toISOString(),
                  id: last.id,
                  userID,
                  sessionID,
                }),
              ).toString("base64url"),
            }
          }),
        }),
      ),
    ),
  )

/** Register internal Session and gateway hooks that persist Tool Usage directly. */
export const recorderLayer = (workspaceID: Workspace.ID) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const hooks = yield* PluginHooks.Service
      const record = (input: {
        readonly userID: User.ID
        readonly sessionID: Session.ID | null
        readonly tool: string
        readonly status: ToolUsageSchema.Status
      }) =>
        database
          .transact(
            database.use("ToolUsage.record", (db) =>
              db.insert(ToolUsageTable).values({
                id: ToolUsageSchema.ID.make(crypto.randomUUID()),
                workspaceID,
                ...input,
                occurredAt: new Date(),
              }),
            ),
          )
          .pipe(Effect.orDie, Effect.asVoid)
      yield* hooks.register("tool", "execute.after", (event) =>
        Effect.gen(function* () {
          const session = (yield* database
            .use("toolUsageRecorderSession", (db) =>
              db
                .select({ userID: SessionTable.userID })
                .from(SessionTable)
                .where(and(eq(SessionTable.id, event.sessionID), eq(SessionTable.workspaceID, workspaceID)))
                .limit(1),
            )
            .pipe(Effect.orDie))[0]
          if (session === undefined) return yield* Effect.die(new Error("Tool Usage Session missing"))
          yield* record({ userID: session.userID, sessionID: event.sessionID, tool: event.tool, status: event.status })
        }),
      )
      yield* hooks.register("gateway", "tool.execute.after", (event) =>
        record({ userID: event.userID, sessionID: null, tool: event.tool, status: event.status }),
      )
    }),
  )

/** Canonical Tool Usage query node for one Workspace. */
export const workspaceNodes = <E>(workspaceID: Workspace.ID, database?: GlobalNode<Database.Service, E>) =>
  makeWorkspaceNode({ service: Service, layer: layer(workspaceID), deps: [database ?? Database.node] })

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Database.node],
})

/** Register the Tool Usage gateway recorder for the bound member hooks. */
export const recorder = makeWorkspaceNode({
  name: "@bymorning/core/ToolUsage.recorder",
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => recorderLayer(workspaceID))),
  deps: [Actor.binding, Database.node, PluginHooks.node],
})

/** Canonical private Tool Usage recorder node registered on one Workspace Plugin Hooks service. */
export const recorderNode = <E>(
  workspaceID: Workspace.ID,
  hooks: WorkspaceNode<PluginHooks.Service, E>,
  database?: GlobalNode<Database.Service, E>,
) =>
  makeWorkspaceNode({
    name: "@bymorning/core/ToolUsage.recorder",
    layer: recorderLayer(workspaceID),
    deps: [database ?? Database.node, hooks],
  })
