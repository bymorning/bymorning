import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Exposes the Project capability owned by this module. */
export * as Project from "./project.js"
export * as WorkspaceProject from "./project.js"

import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { ascending } from "@bymorning/schema/identifier"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { Bus } from "./bus.js"
import { Database } from "./database.js"
import { ProjectPurgeTable, ProjectTable } from "./database/schema/project.sql.js"
import { Storage } from "./storage.js"
import { Actor } from "./actor.js"

/** Drain persisted storage-purge intents; the host runs it at boot and on an interval. */
export { drainPurge } from "./project/purge.js"

/** The requested Project does not exist in the current Workspace. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Project.NotFoundError", {
  projectID: Project.ID,
}) {}

/** The Project is archived, so it is read-only until restored. */
export class ArchivedError extends Schema.TaggedError<ArchivedError>()("Project.ArchivedError", {
  projectID: Project.ID,
}) {}

/** The Workspace's Default Project cannot be archived. */
export class DefaultError extends Schema.TaggedError<DefaultError>()("Project.DefaultError", {
  projectID: Project.ID,
}) {}

/** Workspace-bound Project persistence authority. */
export interface Interface {
  /** Create a Project, using `Default` when no display name is supplied. */
  readonly create: (input: Project.CreateInput) => Effect.Effect<Project.Info>
  /** Get one Project in the bound Workspace. */
  readonly get: (projectID: Project.ID) => Effect.Effect<Project.Info, NotFoundError>
  /** List active Projects, or only archived Projects with `archived: true`, in stable creation order. */
  readonly list: (options?: Project.ListInput) => Effect.Effect<ReadonlyArray<Project.Info>>
  /**
   * Patch one Project's display metadata, or archive (`archived: true`) or restore (`archived: false`) it.
   * The Default Project — the Workspace's first Project — cannot be archived.
   */
  readonly update: (input: Project.UpdateInput) => Effect.Effect<Project.Info, NotFoundError | DefaultError>
  /** Delete one Project in the bound Workspace. */
  readonly delete: (projectID: Project.ID) => Effect.Effect<void, NotFoundError>
}

/** Workspace-bound Project persistence authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Project") {}

function fromRow(row: typeof ProjectTable.$inferSelect): Project.Info {
  const icon =
    row.icon_url === null && row.icon_url_override === null && row.icon_color === null
      ? undefined
      : {
          url: row.icon_url === null ? undefined : new URL(row.icon_url),
          override: row.icon_url_override === null ? undefined : new URL(row.icon_url_override),
          color: row.icon_color ?? undefined,
        }
  return {
    id: row.id,
    name: row.name ?? undefined,
    icon,
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
    time_created: row.timeCreated.getTime(),
    time_updated: row.timeUpdated.getTime(),
  }
}

/** Build the PostgreSQL Project capability for one Workspace. */
export const layer = (
  workspaceID: Workspace.ID,
): Layer.Layer<Service, never, Database.Service | Bus.Service | Storage.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const { object: storage } = yield* Storage.Service
      const create = Effect.fn("Project.create")(function* (input: Project.CreateInput) {
        return yield* database
          .transact(
            Effect.gen(function* () {
              const [row] = yield* database
                .use("Project.create", (db) =>
                  db
                    .insert(ProjectTable)
                    .values({
                      workspaceID,
                      id: Project.ID.create(),
                      name: input.name ?? "Default",
                      icon_url: input.icon?.url?.href,
                      icon_url_override: input.icon?.override?.href,
                      icon_color: input.icon?.color,
                    })
                    .returning(),
                )
                .pipe(Effect.orDie)
              if (!row) return yield* Effect.die(new Error("Project insert returned no row"))
              const project = fromRow(row)
              yield* database.afterCommit(bus.publish(Project.Updated, { project }).pipe(Effect.orDie, Effect.asVoid))
              yield* database.afterCommit(
                storage
                  .set([{ workspaces: workspaceID }, { projects: project.id }], {
                    body: Stream.empty,
                    contentLength: 0,
                  })
                  .pipe(Effect.orDie, Effect.asVoid),
              )
              return project
            }),
          )
          .pipe(Effect.orDie)
      })

      const get = Effect.fn("Project.get")(function* (projectID: Project.ID) {
        const [row] = yield* database
          .use("Project.get", (db) =>
            db
              .select()
              .from(ProjectTable)
              .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, projectID)))
              .limit(1),
          )
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ projectID })
        return fromRow(row)
      })

      const list = Effect.fn("Project.list")(function* (options: Project.ListInput = {}) {
        return yield* database
          .use("Project.list", (db) =>
            db
              .select()
              .from(ProjectTable)
              .where(
                and(
                  eq(ProjectTable.workspaceID, workspaceID),
                  options.archived === true ? isNotNull(ProjectTable.archivedAt) : isNull(ProjectTable.archivedAt),
                ),
              )
              .orderBy(asc(ProjectTable.timeCreated), asc(ProjectTable.id)),
          )
          .pipe(
            Effect.map((rows) => rows.map(fromRow)),
            Effect.orDie,
          )
      })

      const update = Effect.fn("Project.update")(function* (input: Project.UpdateInput) {
        return yield* database
          .transact(
            Effect.gen(function* () {
              const [current] = yield* database
                .use("Project.updateLock", (db) =>
                  db
                    .select()
                    .from(ProjectTable)
                    .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, input.projectID)))
                    .limit(1)
                    .for("update"),
                )
                .pipe(Effect.orDie)
              if (!current) return yield* new NotFoundError({ projectID: input.projectID })
              if (input.archived === true && current.archivedAt === null) {
                // The Default Project is the Workspace's first Project, provisioned with it.
                const [first] = yield* database
                  .use("Project.default", (db) =>
                    db
                      .select({ id: ProjectTable.id })
                      .from(ProjectTable)
                      .where(eq(ProjectTable.workspaceID, workspaceID))
                      .orderBy(asc(ProjectTable.timeCreated), asc(ProjectTable.id))
                      .limit(1),
                  )
                  .pipe(Effect.orDie)
                if (first?.id === input.projectID) return yield* new DefaultError({ projectID: input.projectID })
              }
              const [row] = yield* database
                .use("Project.update", (db) =>
                  db
                    .update(ProjectTable)
                    .set({
                      ...(input.name === undefined ? {} : { name: input.name }),
                      ...(input.icon === undefined
                        ? {}
                        : input.icon === null
                          ? { icon_url: null, icon_url_override: null, icon_color: null }
                          : {
                              icon_url: input.icon.url?.href ?? null,
                              icon_url_override: input.icon.override?.href ?? null,
                              icon_color: input.icon.color ?? null,
                            }),
                      // Archiving an archived Project keeps its original archive time.
                      ...(input.archived === undefined
                        ? {}
                        : { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }),
                      timeUpdated: new Date(),
                    })
                    .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, input.projectID)))
                    .returning(),
                )
                .pipe(Effect.orDie)
              if (!row) return yield* Effect.die(new Error("Project update returned no row"))
              const project = fromRow(row)
              yield* database.afterCommit(bus.publish(Project.Updated, { project }).pipe(Effect.orDie, Effect.asVoid))
              return project
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      })

      const remove = Effect.fn("Project.delete")(function* (projectID: Project.ID) {
        const prefixPath = Storage.path({ workspaces: workspaceID }, { projects: projectID })
        const prefix = yield* Storage.key(prefixPath).pipe(Effect.orDie)
        yield* database
          .transact(
            Effect.gen(function* () {
              const [row] = yield* database.use("Project.delete", (db) =>
                db
                  .delete(ProjectTable)
                  .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, projectID)))
                  .returning({ id: ProjectTable.id })
                  .pipe(Effect.orDie),
              )
              if (!row) return yield* new NotFoundError({ projectID })
              // Durable purge intent in the same transaction: the Project's
              // storage prefix is removed by the purge drain even when the
              // process dies before the objects are gone.
              yield* database.use("Project.purgeIntent", (db) =>
                db
                  .insert(ProjectPurgeTable)
                  .values({ id: `purge_${ascending()}`, workspaceID, projectID, prefix })
                  .pipe(Effect.orDie),
              )
              // The purge drain records the file.delete summary Entry per
              // outcome once the prefix is gone (see project/purge.ts).
              yield* database.afterCommit(bus.publish(Project.Deleted, { projectID }).pipe(Effect.orDie, Effect.asVoid))
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      })
      return Service.of({ create, get, list, update, delete: remove })
    }),
  )

export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  bus: WorkspaceNode<Bus.Service, E>,
  deps?: { readonly database: GlobalNode<Database.Service, E>; readonly storage: GlobalNode<Storage.Service, E> },
) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(workspaceID),
    deps: [deps?.database ?? Database.node, bus, deps?.storage ?? Storage.defaultNode],
  })

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Database.node, Bus.node, Storage.node],
})
