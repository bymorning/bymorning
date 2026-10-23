import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as ServiceAccount from "./service-account.js"

import { createHash, randomBytes } from "node:crypto"
import { ApiKey } from "@bymorning/schema/api-key"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { Workspace } from "@bymorning/schema/workspace"
import { and, asc, count, eq, gt, isNull, or } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { ApiKeyTable } from "./database/schema/api-key.sql.js"
import { ServiceAccountTable } from "./database/schema/service-account.sql.js"
import { WorkspaceTable } from "./database/schema/workspace.sql.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

export interface Interface {
  readonly create: (input: {
    workspaceID: Workspace.ID
    name: string
    policy?: ServiceAccount.Policy
  }) => Effect.Effect<ServiceAccount.Info>
  readonly list: (workspaceID: Workspace.ID) => Effect.Effect<readonly ServiceAccount.Info[]>
  readonly listSummaries: (workspaceID: Workspace.ID) => Effect.Effect<readonly ServiceAccount.Summary[]>
  readonly get: (workspaceID: Workspace.ID, id: ServiceAccount.ID) => Effect.Effect<ServiceAccount.Info | undefined>
  readonly update: (
    workspaceID: Workspace.ID,
    id: ServiceAccount.ID,
    input: { name?: string; policy?: ServiceAccount.Policy; status?: ServiceAccount.Status },
  ) => Effect.Effect<ServiceAccount.Info, NotFoundError>
  readonly remove: (workspaceID: Workspace.ID, id: ServiceAccount.ID) => Effect.Effect<void, NotFoundError>
  readonly key: {
    readonly create: (
      workspaceID: Workspace.ID,
      serviceAccountID: ServiceAccount.ID,
      input: { name: string; timeExpires?: Date },
    ) => Effect.Effect<{ key: ApiKey.Info; secret: ApiKey.Secret }, NotFoundError>
    readonly list: (
      workspaceID: Workspace.ID,
      serviceAccountID: ServiceAccount.ID,
    ) => Effect.Effect<readonly ApiKey.Info[]>
    readonly revoke: (workspaceID: Workspace.ID, id: ApiKey.ID) => Effect.Effect<void, NotFoundError>
    readonly verify: (secret: string) => Effect.Effect<Verified | undefined>
  }
}

export interface Verified {
  readonly workspaceID: Workspace.ID
  readonly account: ServiceAccount.Info
  readonly keyID: ApiKey.ID
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ServiceAccount.NotFoundError", {
  id: Schema.String,
}) {}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ServiceAccount") {}

const accountInfo = (row: typeof ServiceAccountTable.$inferSelect): ServiceAccount.Info => ({
  id: row.id,
  workspaceID: row.workspaceID,
  name: row.name,
  status: row.status,
  policy: row.policy,
  timeCreated: row.timeCreated,
  timeUpdated: row.timeUpdated,
})

const keyInfo = (row: typeof ApiKeyTable.$inferSelect): ApiKey.Info => ({
  id: row.id,
  workspaceID: row.workspaceID,
  serviceAccountID: row.serviceAccountID,
  name: row.name,
  prefix: row.prefix,
  timeExpires: row.timeExpires ?? undefined,
  timeUsed: row.timeUsed ?? undefined,
  timeCreated: row.timeCreated,
  timeRevoked: row.timeRevoked ?? undefined,
})

const hash = (value: string) => createHash("sha256").update(value, "ascii").digest("hex")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    const create = Effect.fn("ServiceAccount.create")(function* (input: {
      workspaceID: Workspace.ID
      name: string
      policy?: ServiceAccount.Policy
    }) {
      const [row] = yield* database
        .use("ServiceAccount.create", (db) =>
          db
            .insert(ServiceAccountTable)
            .values({
              id: ServiceAccount.ID.create(),
              workspaceID: input.workspaceID,
              name: input.name,
              status: "active",
              policy: input.policy ?? {},
            })
            .returning(),
        )
        .pipe(Effect.orDie)
      if (row === undefined) return yield* Effect.die(new Error("ServiceAccount insert returned no row"))
      return accountInfo(row)
    })

    const list = Effect.fn("ServiceAccount.list")((workspaceID: Workspace.ID) =>
      database
        .use("ServiceAccount.list", (db) =>
          db
            .select()
            .from(ServiceAccountTable)
            .where(and(eq(ServiceAccountTable.workspaceID, workspaceID), isNull(ServiceAccountTable.timeDeleted)))
            .orderBy(asc(ServiceAccountTable.timeCreated), asc(ServiceAccountTable.id)),
        )
        .pipe(
          Effect.map((rows) => rows.map(accountInfo)),
          Effect.orDie,
        ),
    )

    const listSummaries = Effect.fn("ServiceAccount.listSummaries")(function* (workspaceID: Workspace.ID) {
      const accounts = yield* list(workspaceID)
      const counts = yield* database
        .use("ServiceAccount.listSummaries.keyCounts", (db) =>
          db
            .select({ serviceAccountID: ApiKeyTable.serviceAccountID, keyCount: count() })
            .from(ApiKeyTable)
            .where(and(eq(ApiKeyTable.workspaceID, workspaceID), isNull(ApiKeyTable.timeDeleted)))
            .groupBy(ApiKeyTable.serviceAccountID),
        )
        .pipe(Effect.orDie)
      const keyCounts = new Map(counts.map(({ serviceAccountID, keyCount }) => [serviceAccountID, keyCount]))
      return accounts.map((account) => ({ ...account, keyCount: keyCounts.get(account.id) ?? 0 }))
    })

    const get = Effect.fn("ServiceAccount.get")((workspaceID: Workspace.ID, id: ServiceAccount.ID) =>
      database
        .use("ServiceAccount.get", (db) =>
          db
            .select()
            .from(ServiceAccountTable)
            .where(
              and(
                eq(ServiceAccountTable.workspaceID, workspaceID),
                eq(ServiceAccountTable.id, id),
                isNull(ServiceAccountTable.timeDeleted),
              ),
            )
            .limit(1),
        )
        .pipe(
          Effect.map((rows) => (rows[0] === undefined ? undefined : accountInfo(rows[0]))),
          Effect.orDie,
        ),
    )

    const update = Effect.fn("ServiceAccount.update")(function* (
      workspaceID: Workspace.ID,
      id: ServiceAccount.ID,
      input: { name?: string; policy?: ServiceAccount.Policy; status?: ServiceAccount.Status },
    ) {
      const [row] = yield* database
        .use("ServiceAccount.update", (db) =>
          db
            .update(ServiceAccountTable)
            .set({
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.policy === undefined ? {} : { policy: input.policy }),
              ...(input.status === undefined ? {} : { status: input.status }),
              timeUpdated: new Date(),
            })
            .where(
              and(
                eq(ServiceAccountTable.workspaceID, workspaceID),
                eq(ServiceAccountTable.id, id),
                isNull(ServiceAccountTable.timeDeleted),
              ),
            )
            .returning(),
        )
        .pipe(Effect.orDie)
      if (row === undefined) return yield* new NotFoundError({ id })
      return accountInfo(row)
    })

    const remove = Effect.fn("ServiceAccount.remove")(function* (workspaceID: Workspace.ID, id: ServiceAccount.ID) {
      return yield* database
        .transact(
          Effect.gen(function* () {
            const now = new Date()
            const [row] = yield* database
              .use("ServiceAccount.remove", (db) =>
                db
                  .update(ServiceAccountTable)
                  .set({ timeDeleted: now, timeUpdated: now })
                  .where(
                    and(
                      eq(ServiceAccountTable.workspaceID, workspaceID),
                      eq(ServiceAccountTable.id, id),
                      isNull(ServiceAccountTable.timeDeleted),
                    ),
                  )
                  .returning({ id: ServiceAccountTable.id }),
              )
              .pipe(Effect.orDie)
            if (row === undefined) return yield* new NotFoundError({ id })
            yield* database
              .use("ServiceAccount.remove.revokeKeys", (db) =>
                db
                  .update(ApiKeyTable)
                  .set({ timeRevoked: now, timeUpdated: now })
                  .where(
                    and(
                      eq(ApiKeyTable.workspaceID, workspaceID),
                      eq(ApiKeyTable.serviceAccountID, id),
                      isNull(ApiKeyTable.timeRevoked),
                    ),
                  ),
              )
              .pipe(Effect.orDie)
          }),
        )
        .pipe(Effect.orDie)
    })

    const createKey = Effect.fn("ServiceAccount.key.create")(function* (
      workspaceID: Workspace.ID,
      serviceAccountID: ServiceAccount.ID,
      input: { name: string; timeExpires?: Date },
    ) {
      const account = yield* get(workspaceID, serviceAccountID)
      if (account === undefined) return yield* new NotFoundError({ id: serviceAccountID })
      const secret = ApiKey.Secret.make(`bm_${randomBytes(32).toString("base64url")}`)
      const [row] = yield* database
        .use("ServiceAccount.key.create", (db) =>
          db
            .insert(ApiKeyTable)
            .values({
              id: ApiKey.ID.create(),
              workspaceID,
              serviceAccountID,
              name: input.name,
              prefix: secret.slice(0, 12),
              hash: hash(secret),
              timeExpires: input.timeExpires,
            })
            .returning(),
        )
        .pipe(Effect.orDie)
      if (row === undefined) return yield* Effect.die(new Error("ApiKey insert returned no row"))
      return { key: keyInfo(row), secret }
    })

    const listKeys = Effect.fn("ServiceAccount.key.list")(
      (workspaceID: Workspace.ID, serviceAccountID: ServiceAccount.ID) =>
        database
          .use("ServiceAccount.key.list", (db) =>
            db
              .select({ key: ApiKeyTable })
              .from(ApiKeyTable)
              .innerJoin(
                ServiceAccountTable,
                and(
                  eq(ServiceAccountTable.workspaceID, ApiKeyTable.workspaceID),
                  eq(ServiceAccountTable.id, ApiKeyTable.serviceAccountID),
                  isNull(ServiceAccountTable.timeDeleted),
                ),
              )
              .where(
                and(
                  eq(ApiKeyTable.workspaceID, workspaceID),
                  eq(ApiKeyTable.serviceAccountID, serviceAccountID),
                  isNull(ApiKeyTable.timeDeleted),
                ),
              )
              .orderBy(asc(ApiKeyTable.timeCreated), asc(ApiKeyTable.id)),
          )
          .pipe(
            Effect.map((rows) => rows.map(({ key }) => keyInfo(key))),
            Effect.orDie,
          ),
    )

    const revokeKey = Effect.fn("ServiceAccount.key.revoke")(function* (workspaceID: Workspace.ID, id: ApiKey.ID) {
      const [row] = yield* database
        .use("ServiceAccount.key.revoke", (db) =>
          db
            .update(ApiKeyTable)
            .set({ timeRevoked: new Date(), timeUpdated: new Date() })
            .where(
              and(
                eq(ApiKeyTable.workspaceID, workspaceID),
                eq(ApiKeyTable.id, id),
                isNull(ApiKeyTable.timeRevoked),
                isNull(ApiKeyTable.timeDeleted),
              ),
            )
            .returning({ id: ApiKeyTable.id }),
        )
        .pipe(Effect.orDie)
      if (row === undefined) return yield* new NotFoundError({ id })
    })

    const verify = Effect.fn("ServiceAccount.key.verify")(function* (secret: string) {
      const now = new Date()
      const [row] = yield* database.use("ServiceAccount.key.verify", (db) =>
        db
          .select({ keyID: ApiKeyTable.id, account: ServiceAccountTable })
          .from(ApiKeyTable)
          .innerJoin(
            ServiceAccountTable,
            and(
              eq(ServiceAccountTable.workspaceID, ApiKeyTable.workspaceID),
              eq(ServiceAccountTable.id, ApiKeyTable.serviceAccountID),
              eq(ServiceAccountTable.status, "active"),
              isNull(ServiceAccountTable.timeDeleted),
            ),
          )
          .innerJoin(
            WorkspaceTable,
            and(
              eq(WorkspaceTable.id, ApiKeyTable.workspaceID),
              eq(WorkspaceTable.status, "active"),
              isNull(WorkspaceTable.timeDeleted),
            ),
          )
          .where(
            and(
              eq(ApiKeyTable.hash, hash(secret)),
              isNull(ApiKeyTable.timeRevoked),
              isNull(ApiKeyTable.timeDeleted),
              or(isNull(ApiKeyTable.timeExpires), gt(ApiKeyTable.timeExpires, now)),
            ),
          )
          .limit(1),
      )
      if (row === undefined) return undefined
      yield* database.use("ServiceAccount.key.verify.touch", (db) =>
        db.update(ApiKeyTable).set({ timeUsed: now, timeUpdated: now }).where(eq(ApiKeyTable.id, row.keyID)),
      )
      return {
        workspaceID: row.account.workspaceID,
        account: accountInfo(row.account),
        keyID: row.keyID,
      }
    }, Effect.orDie)

    return Service.of({
      create,
      list,
      listSummaries,
      get,
      update,
      remove,
      key: { create: createKey, list: listKeys, revoke: revokeKey, verify },
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
