import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as Workspace from "./workspace.js"

import { WorkspaceAccess } from "@bymorning/schema/workspace-access"
import { AccountActor } from "@bymorning/schema/actor"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { WorkspaceTable } from "./database/schema/workspace.sql.js"
import { UserTable } from "./database/schema/user.sql.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

/** Account-scoped Workspace discovery authority. */
export interface Interface {
  /** List active, non-deleted Workspaces in stable creation order with the Account's membership role. */
  readonly list: (account: AccountActor) => Effect.Effect<ReadonlyArray<WorkspaceAccess.Info>, ReadError>
}

/** Workspace membership information could not be read from persistence. */
export class ReadError extends Schema.TaggedError<ReadError>()("Workspace.ReadError", {
  cause: Schema.Defect(),
}) {}

/** Account-scoped Workspace discovery authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Workspace") {}

/** Workspace discovery backed by the shared Database service. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const list = Effect.fn("Workspace.list")(function* (account: AccountActor) {
      return yield* database.use("Workspace.list", (db) =>
        db
          .select({
            id: WorkspaceTable.id,
            name: WorkspaceTable.name,
            status: WorkspaceTable.status,
            role: UserTable.role,
          })
          .from(WorkspaceTable)
          .innerJoin(UserTable, eq(UserTable.workspaceId, WorkspaceTable.id))
          .where(
            and(
              eq(UserTable.accountId, account.properties.accountID),
              isNull(UserTable.timeDeleted),
              eq(WorkspaceTable.status, "active"),
              isNull(WorkspaceTable.timeDeleted),
            ),
          )
          .orderBy(asc(UserTable.timeCreated), asc(UserTable.id))
          .pipe(Effect.mapError((cause) => new ReadError({ cause }))),
      )
    })

    return Service.of({ list })
  }),
)

export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
