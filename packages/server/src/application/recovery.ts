export * as WorkspaceRecovery from "./recovery.js"

import {
  AccountTable,
  Database,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { Session } from "@bymorning/core/session"
import { Message } from "@bymorning/schema/message"
import { SessionSchema } from "@bymorning/schema/session"
import { Context, Effect, Layer, MutableHashMap, Option, Schema } from "effect"
import { and, asc, eq, isNull } from "drizzle-orm"
import { WorkspaceMap } from "../workspace-map.js"
import { makeGlobalNode, type GlobalNode } from "@bymorning/util/effect/app-node"

export interface Interface {
  /** Acquire every owner-bound graph with durable work requiring restart recovery. */
  readonly recover: Effect.Effect<void>
}

/** Process-global coordinator for durable Workspace restart discovery. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/server/WorkspaceRecovery") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const workspaceMap = yield* WorkspaceMap.Service

    return Service.of({
      recover: recoverable(database).pipe(
        Effect.orDie,
        Effect.flatMap((owners) =>
          Effect.forEach(
            owners,
            (owner) =>
              Effect.void.pipe(
                Effect.provide(
                  WorkspaceMap.Service.get(owner).pipe(
                    Layer.provide(Layer.succeed(WorkspaceMap.Service, workspaceMap)),
                  ),
                ),
              ),
            { discard: true },
          ),
        ),
      ),
    })
  }),
)

/** Explicit production boot hook; the coordinator remains inert until this Layer is acquired. */
export const boot = Layer.effectDiscard(Service.pipe(Effect.flatMap((recovery) => recovery.recover)))

/** Canonical recovery coordinator and explicit process boot root. */
export const nodes = <E>(
  workspaces: GlobalNode<WorkspaceMap.Service, E>,
  database?: GlobalNode<Database.Service, E>,
) => {
  const service = makeGlobalNode({ service: Service, layer, deps: [database ?? Database.node, workspaces] })
  const bootNode = makeGlobalNode({
    name: "@bymorning/server/WorkspaceRecovery.boot",
    layer: boot,
    deps: [service],
  })
  return { service, boot: bootNode }
}

const ownerColumns = {
  workspaceID: SessionTable.workspaceID,
  userID: SessionTable.userID,
  accountID: UserTable.accountId,
  role: UserTable.role,
  userDeleted: UserTable.timeDeleted,
  accountStatus: AccountTable.status,
  accountDeleted: AccountTable.timeDeleted,
  workspaceStatus: WorkspaceTable.status,
  workspaceDeleted: WorkspaceTable.timeDeleted,
}

const recoverable = Effect.fn("WorkspaceRecovery.recoverable")((database: Database.Interface) =>
  database.use("WorkspaceRecovery.recoverable", (db) =>
    Effect.gen(function* () {
      const inbox = yield* db
        .selectDistinct(ownerColumns)
        .from(SessionTable)
        .innerJoin(
          UserTable,
          and(eq(UserTable.id, SessionTable.userID), eq(UserTable.workspaceId, SessionTable.workspaceID)),
        )
        .innerJoin(AccountTable, eq(AccountTable.id, UserTable.accountId))
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, SessionTable.workspaceID))
        .innerJoin(SessionInboxTable, eq(SessionInboxTable.sessionID, SessionTable.id))
        .where(isNull(SessionTable.parentID))
      const storedMessages = yield* db
        .select({ sessionID: SessionTable.id, ...ownerColumns, data: SessionMessageTable.data })
        .from(SessionTable)
        .innerJoin(
          UserTable,
          and(eq(UserTable.id, SessionTable.userID), eq(UserTable.workspaceId, SessionTable.workspaceID)),
        )
        .innerJoin(AccountTable, eq(AccountTable.id, UserTable.accountId))
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, SessionTable.workspaceID))
        .innerJoin(SessionMessageTable, eq(SessionMessageTable.sessionID, SessionTable.id))
        .where(isNull(SessionTable.parentID))
        .orderBy(asc(SessionTable.id), asc(SessionMessageTable.sequence))
      const latest = new Map<SessionSchema.ID, { readonly owner: WorkspaceMap.Owner; readonly message: Message }>()
      const owners = MutableHashMap.empty<WorkspaceMap.RuntimeKey, WorkspaceMap.Owner>()
      const add = (owner: WorkspaceMap.Owner) => {
        const key = new WorkspaceMap.RuntimeKey({ workspaceID: owner.workspaceID, accountID: owner.accountID })
        const current = MutableHashMap.get(owners, key)
        if (Option.isSome(current) && current.value.userID !== owner.userID) {
          throw new Error(`Conflicting persisted Session owners: ${owner.workspaceID}/${owner.accountID}`)
        }
        MutableHashMap.set(owners, key, owner)
      }
      for (const row of inbox) {
        const owner = yield* availableOwner(row)
        if (owner) add(owner)
      }
      for (const row of storedMessages) {
        const owner = yield* availableOwner(row)
        if (!owner) continue
        const message = yield* Schema.decodeUnknownEffect(Message)(row.data)
        if (message.type === "assistant" && message.time.completed === undefined) {
          add(owner)
        }
        latest.set(row.sessionID, { owner, message })
      }
      for (const { owner, message } of latest.values()) {
        if (Session.continues(message)) add(owner)
      }
      return MutableHashMap.values(owners)
    }),
  ),
)

const availableOwner = Effect.fn("WorkspaceRecovery.availableOwner")(function* (row: {
  readonly workspaceID: WorkspaceMap.Owner["workspaceID"]
  readonly userID: WorkspaceMap.Owner["userID"]
  readonly accountID: WorkspaceMap.Owner["accountID"] | null
  readonly role: WorkspaceMap.Owner["role"]
  readonly userDeleted: Date | null
  readonly accountStatus: "active" | "suspended"
  readonly accountDeleted: Date | null
  readonly workspaceStatus: "active" | "suspended"
  readonly workspaceDeleted: Date | null
}) {
  if (
    row.accountID === null ||
    row.userDeleted !== null ||
    row.accountStatus !== "active" ||
    row.accountDeleted !== null ||
    row.workspaceStatus !== "active" ||
    row.workspaceDeleted !== null
  ) {
    yield* Effect.logWarning("Skipping recovery for unavailable persisted Session owner").pipe(
      Effect.annotateLogs({ workspaceID: row.workspaceID, userID: row.userID }),
    )
    return undefined
  }
  return { workspaceID: row.workspaceID, accountID: row.accountID, userID: row.userID, role: row.role }
})
