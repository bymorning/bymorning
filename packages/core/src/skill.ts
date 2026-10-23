import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Exposes the Skill capability owned by this module. */
export * as Skill from "./skill.js"

import { Skill } from "@bymorning/schema/skill"
import { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { SkillEvent } from "@bymorning/schema/skill-event"
import { and, asc, eq } from "drizzle-orm"
import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Stream, Types } from "effect"
import { Bus } from "./bus.js"
import { Database } from "./database.js"
import { SkillTable } from "./database/schema/skill.sql.js"
import { State } from "./state.js"
import { Actor } from "./actor.js"

/** The requested Skill does not exist in the bound Workspace. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Skill.NotFoundError", {
  skillID: Skill.ID,
}) {}

/** Workspace-bound effective Skill catalog and persistence authority. */
export interface Editor {
  readonly list: () => readonly Types.DeepMutable<Skill.Info>[]
  readonly get: (id: string) => Types.DeepMutable<Skill.Info> | undefined
  readonly add: (skill: Skill.Info) => void
  readonly update: (id: string, update: (skill: Types.DeepMutable<Skill.Info>) => void) => void
  readonly remove: (id: string) => void
}

export interface Interface extends State.Transformable<Editor> {
  /** List plugin Skills followed by unshadowed persisted Skills in stable order. */
  readonly list: Effect.Effect<ReadonlyArray<Skill.Info>>
  /** Get one effective Skill, preferring a plugin contribution with the same identity. */
  readonly get: (skillID: Skill.ID) => Effect.Effect<Skill.Info, NotFoundError>
  /** Create a Skill with a newly generated identity. Shared Skill authoring requires the admin Role. */
  readonly create: (input: Skill.Create) => Effect.Effect<Skill.Info, Actor.ForbiddenError>
  /** Fully replace one Skill in the bound Workspace. Requires the admin Role. */
  readonly update: (skill: Skill.Info) => Effect.Effect<Skill.Info, NotFoundError | Actor.ForbiddenError>
  /** Delete one Skill in the bound Workspace. Requires the admin Role. */
  readonly delete: (skillID: Skill.ID) => Effect.Effect<void, NotFoundError | Actor.ForbiddenError>
}

/** Workspace-bound effective Skill catalog and persistence authority. */
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Skill") {}

type Row = typeof SkillTable.$inferSelect

class FollowerEndedError extends Schema.TaggedError<FollowerEndedError>()("Skill.FollowerEndedError", {}) {}

const followerRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(5)))),
  Schedule.while(({ input }: { readonly input: Cause.Cause<unknown> }) => !Cause.hasInterrupts(input)),
)

const info = (row: Row): Skill.Info =>
  Skill.Info.make({
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
  })

/** Build the plugin-aware PostgreSQL Skill capability for one Workspace. */
export const layer = (
  workspaceID: Workspace.ID,
  coordinator = State.makeCoordinator(),
): Layer.Layer<Service, never, Database.Service | Bus.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      // The bound member's Role authorizes shared Skill writes. Caller-less
      // constructions (tests, internal system contexts) are trusted.
      const binding = yield* Effect.serviceOption(Actor.Binding.Service)
      const whereID = (skillID: Skill.ID) => and(eq(SkillTable.workspaceID, workspaceID), eq(SkillTable.id, skillID))
      const notFound = (skillID: Skill.ID) => new NotFoundError({ skillID })

      const loadBase = Effect.gen(function* () {
        const rows = yield* database.use("Skill.list", (db) =>
          db
            .select()
            .from(SkillTable)
            .where(eq(SkillTable.workspaceID, workspaceID))
            .orderBy(asc(SkillTable.list_position))
            .pipe(Effect.orDie),
        )
        return Object.freeze(rows.map(info).map(freezeInfo))
      }).pipe(Effect.withSpan("Skill.loadBase"))
      // Attach the volatile follower before reading state. The following read
      // repairs any change racing with subscription acquisition.
      const updates = yield* bus.subscribe(SkillEvent.Definitions)
      let base = yield* loadBase
      const state = State.create<Map<Skill.ID, Types.DeepMutable<Skill.Info>>, Editor>({
        name: "skill",
        coordinator,
        initial: () => new Map(base.map((skill) => [skill.id, structuredClone(skill)])),
        editor: (skills) => ({
          list: () => Array.from(skills.values()),
          get: (id) => skills.get(Skill.ID.make(id)),
          add: (skill) => skills.set(skill.id, structuredClone(skill)),
          update: (id, update) => {
            const skill = skills.get(Skill.ID.make(id))
            if (!skill) return
            update(skill)
            skill.id = Skill.ID.make(id)
          },
          remove: (id) => {
            skills.delete(Skill.ID.make(id))
          },
        }),
      })
      const refresh = () =>
        state.rebase(loadBase, (next) => {
          if (JSON.stringify(base) === JSON.stringify(next)) return false
          base = next
          return true
        })
      yield* updates.pipe(
        Stream.mapEffect(() => refresh()),
        Stream.runDrain,
        Effect.orDie,
        Effect.forkScoped,
      )
      const list = Effect.sync(() => Object.freeze(Array.from(state.get().values(), freezeInfo))).pipe(
        Effect.withSpan("Skill.list"),
      )

      const get = Effect.fn("Skill.get")(function* (skillID: Skill.ID) {
        const skill = state.get().get(skillID)
        return skill === undefined ? yield* notFound(skillID) : freezeInfo(skill)
      })

      const create = Effect.fn("Skill.create")(function* (input: Skill.Create) {
        yield* Actor.Binding.requireAdmin(binding, "Only Workspace administrators can author Skills")
        const id = Skill.ID.create()
        yield* database.transact(
          Effect.gen(function* () {
            yield* database.use("Skill.create", (db) =>
              db
                .insert(SkillTable)
                .values({ workspaceID, id, ...input })
                .pipe(Effect.orDie),
            )
            yield* database.afterCommit(
              refresh().pipe(Effect.andThen(bus.publish(SkillEvent.Created, { workspaceID, skillID: id }))),
            )
          }),
        ).pipe(Effect.catchTag("SqlError", Effect.die))
        yield* refresh()
        const created = state.get().get(id)
        if (created === undefined) return yield* Effect.die(new Error("Skill insert was not reloaded"))
        return freezeInfo(created)
      })

      const update = Effect.fn("Skill.update")(function* (skill: Skill.Info) {
        yield* Actor.Binding.requireAdmin(binding, "Only Workspace administrators can author Skills")
        yield* database.transact(
          Effect.gen(function* () {
            yield* database.use("Skill.update", (db) =>
              db
                .update(SkillTable)
                .set({ name: skill.name, description: skill.description, instructions: skill.instructions })
                .where(whereID(skill.id))
                .returning({ id: SkillTable.id })
                .pipe(
                  Effect.orDie,
                  Effect.flatMap((rows) => (rows[0] === undefined ? Effect.fail(notFound(skill.id)) : Effect.void)),
                ),
            )
            yield* database.afterCommit(
              refresh().pipe(Effect.andThen(bus.publish(SkillEvent.Updated, { workspaceID, skillID: skill.id }))),
            )
          }),
        ).pipe(Effect.catchTag("SqlError", Effect.die))
        yield* refresh()
        return freezeInfo(skill)
      })

      const remove = Effect.fn("Skill.delete")(function* (skillID: Skill.ID) {
        yield* Actor.Binding.requireAdmin(binding, "Only Workspace administrators can author Skills")
        yield* database.transact(
          Effect.gen(function* () {
            yield* database.use("Skill.delete", (db) =>
              db
                .delete(SkillTable)
                .where(whereID(skillID))
                .returning({ id: SkillTable.id })
                .pipe(
                  Effect.orDie,
                  Effect.flatMap((rows) => (rows[0] === undefined ? Effect.fail(notFound(skillID)) : Effect.void)),
                ),
            )
            yield* database.afterCommit(
              refresh().pipe(Effect.andThen(bus.publish(SkillEvent.Deleted, { workspaceID, skillID }))),
            )
          }),
        ).pipe(Effect.catchTag("SqlError", Effect.die))
        yield* refresh()
        return undefined
      })

      return Service.of({ transform: state.transform, reload: state.reload, list, get, create, update, delete: remove })
    }),
  )

export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  bus: WorkspaceNode<Bus.Service, E>,
  coordinator = State.makeCoordinator(),
  database?: GlobalNode<Database.Service, E>,
) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(workspaceID, coordinator),
    deps: [database ?? Database.node, bus],
  })

/** Canonical member Skill authority with the shared state coordinator. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const { workspaceID } = yield* Actor.Binding.Service
      return layer(workspaceID, yield* State.Service)
    }),
  ),
  deps: [Actor.binding, Database.node, Bus.node, State.node],
})

const freezeInfo = (skill: Skill.Info): Skill.Info =>
  Object.freeze({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
  })
