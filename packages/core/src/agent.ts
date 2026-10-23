import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Exposes the Workspace-bound Agent contract owned by this module. */
export * as Agent from "./agent.js"

import { Agent } from "@bymorning/schema/agent"
import { AgentEvent } from "@bymorning/schema/agent-event"
import { Ref } from "@bymorning/schema/model"
import { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { and, asc, eq } from "drizzle-orm"
import {
  Cause,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
  Stream,
  SynchronizedRef,
  Types,
} from "effect"
import { Actor } from "./actor.js"
import type { WorkspaceConfig } from "./config.js"
import { Bus } from "./bus.js"
import { Database } from "./database.js"
import { AgentTable } from "./database/schema/agent.sql.js"
import { Catalog } from "./catalog.js"
import { State } from "./state.js"
import { Routing } from "./routing.js"

/** An Agent with the requested Workspace-local ID already exists. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("Agent.ConflictError", {
  id: Agent.ID,
}) {}

/** The requested persisted Agent does not exist in the bound Workspace. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Agent.NotFoundError", {
  id: Agent.ID,
}) {}

/** The requested Agent model cannot be resolved by the installed Model and Provider authorities. */
export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()("Agent.ModelUnavailableError", {
  model: Ref,
}) {}

/** Workspace-bound effective Agent catalog and resolution authority. */
export interface Editor {
  readonly list: () => readonly Types.DeepMutable<Agent.Info>[]
  readonly get: (id: string) => Types.DeepMutable<Agent.Info> | undefined
  readonly default: (id: string | undefined) => void
  readonly update: (id: string, update: (agent: Types.DeepMutable<Agent.Info>) => void) => void
  readonly remove: (id: string) => void
}

interface Data {
  readonly agents: Map<Agent.ID, Types.DeepMutable<Agent.Info>>
  default?: Agent.ID
}

export interface Interface extends State.Transformable<Editor> {
  /** List every effective Agent, persisted or plugin-contributed, in stable order. */
  readonly list: Effect.Effect<ReadonlyArray<Agent.Info>>
  /** Get one effective Agent by its Workspace-local ID, including hidden and subagent-only Agents. */
  readonly get: (id: Agent.ID) => Effect.Effect<Agent.Info | undefined>
  /** Resolve the configured Agent or the first visible primary-capable Agent. */
  readonly resolve: Effect.Effect<Agent.Info>
  /** Create one persisted Agent unless its ID is already effective. */
  readonly create: (agent: Agent.Info) => Effect.Effect<Agent.Info, ConflictError | ModelUnavailableError>
  /**
   * Fully replace the mutable fields of one persisted Agent. Saving a built-in
   * Agent writes the record that replaces its shipped definition.
   */
  readonly update: (
    id: Agent.ID,
    input: Agent.Update,
  ) => Effect.Effect<Agent.Info, NotFoundError | ModelUnavailableError>
  /**
   * Remove one persisted Agent record. Removing a built-in Agent's record
   * restores its shipped definition; an effective Agent with no record is
   * already at that definition and is removed idempotently.
   */
  readonly delete: (id: Agent.ID) => Effect.Effect<void, NotFoundError>
}

/** Workspace-bound effective Agent catalog and resolution authority. */
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Agent") {}

type CreateOutcome = { readonly status: "created"; readonly agent: Agent.Info } | { readonly status: "conflict" }
type UpdateOutcome = { readonly status: "updated"; readonly agent: Agent.Info } | { readonly status: "not-found" }
type DeleteOutcome = { readonly status: "deleted" } | { readonly status: "not-found" }

class FollowerEndedError extends Schema.TaggedError<FollowerEndedError>()("Agent.FollowerEndedError", {}) {}

const followerRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(5)))),
  Schedule.while(({ input }: { readonly input: Cause.Cause<unknown> }) => !Cause.hasInterrupts(input)),
)

/** Build the plugin-aware PostgreSQL Agent capability for one Workspace. */
export const layer = (workspaceID: Workspace.ID, coordinator = State.makeCoordinator()) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const models = yield* Catalog.Service
      const configured = yield* Config.option(Config.schema(Agent.ID, "BYMORNING_DEFAULT_AGENT"))
      const routing = yield* Effect.serviceOption(Routing.Service)
      const requireModel = Effect.fn("Agent.requireModel")(function* (model: NonNullable<Agent.Info["model"]>) {
        // An Auto name is a valid preference only while a routing rule resolves it.
        if (Routing.isAuto(model)) {
          const names = Option.isSome(routing) ? yield* routing.value.names : []
          if (!names.some((name) => name.id === model.id)) return yield* new ModelUnavailableError({ model })
          return
        }
        const info = yield* models.model.get(model.provider, model.id)
        if (!info || (model.variant !== undefined && model.variant !== "default" && !info.execution?.variants?.[model.variant]))
          return yield* new ModelUnavailableError({ model })
      })
      const loadBase = database
        .use("Agent.load", (db) =>
          db
            .select({
              id: AgentTable.id,
              name: AgentTable.name,
              instructions: AgentTable.instructions,
              model: AgentTable.model,
              description: AgentTable.description,
              mode: AgentTable.mode,
              hidden: AgentTable.hidden,
              color: AgentTable.color,
              steps: AgentTable.steps,
              permissions: AgentTable.permissions,
            })
            .from(AgentTable)
            .where(eq(AgentTable.workspaceId, workspaceID))
            .orderBy(asc(AgentTable.list_position))
            .pipe(Effect.orDie),
        )
        .pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              Schema.decodeUnknownEffect(Agent.Info)({
                id: row.id,
                name: row.name,
                instructions: row.instructions,
                ...(row.model === null ? {} : { model: row.model }),
                ...(row.description === null ? {} : { description: row.description }),
                mode: row.mode,
                hidden: row.hidden,
                ...(row.color === null ? {} : { color: row.color }),
                steps: row.steps,
                permissions: row.permissions,
              }),
            ),
          ),
          Effect.map((agents) => Object.freeze(agents.map(freezeInfo))),
          Effect.withSpan("Agent.loadBase"),
        )
      const catalog = yield* SynchronizedRef.make<ReadonlyArray<Agent.Info>>(Object.freeze([]))
      // Subscribe before loading so a catalog change cannot be missed between
      // the initial read and attaching the live invalidation follower.
      const updates = yield* bus.subscribe(AgentEvent.Definitions)
      let base = yield* loadBase
      const selectable = <A extends Pick<Agent.Info, "mode" | "hidden">>(agent: A | undefined): A | undefined =>
        agent !== undefined && agent.mode !== "subagent" && !agent.hidden ? agent : undefined
      const ordered = (data: Data) => {
        const agents = Array.from(data.agents.values())
        const preferred = data.default ?? (configured._tag === "Some" ? configured.value : undefined)
        const selected =
          (preferred === undefined ? undefined : selectable(data.agents.get(preferred))) ??
          selectable(data.agents.get(Agent.DefaultID)) ??
          agents.find((agent) => selectable(agent) !== undefined)
        return selected === undefined ? agents : [selected, ...agents.filter((agent) => agent.id !== selected.id)]
      }
      // A built-in identity is overridden once its Workspace record exists in
      // `base`; every other identity has no built-in definition to override.
      const overridden = (id: Agent.ID) => (Agent.BuiltIn.has(id) ? base.some((row) => row.id === id) : undefined)
      const withOverridden = (info: Agent.Info, flag: boolean | undefined): Agent.Info =>
        flag === undefined ? info : Object.freeze({ ...info, overridden: flag })
      const effective = (data: Data) =>
        Object.freeze(ordered(data).map((agent) => withOverridden(freezeInfo(agent), overridden(agent.id))))
      const state = State.create<Data, Editor>({
        name: "agent",
        coordinator,
        initial: () => ({
          agents: new Map(base.map((agent) => [agent.id, structuredClone(agent) as Types.DeepMutable<Agent.Info>])),
        }),
        editor: (data) => ({
          list: () => ordered(data),
          get: (id) => data.agents.get(Agent.ID.make(id)),
          default: (id) => {
            data.default = id === undefined ? undefined : Agent.ID.make(id)
          },
          update: (value, update) => {
            const id = Agent.ID.make(value)
            const current =
              data.agents.get(id) ??
              ({
                id,
                name: Agent.Name.make(id),
                instructions: "",
                mode: "primary",
                hidden: false,
                steps: null,
                permissions: [],
              } satisfies Types.DeepMutable<Agent.Info>)
            if (!data.agents.has(id)) data.agents.set(id, current)
            update(current)
            current.id = id
          },
          remove: (id) => {
            data.agents.delete(Agent.ID.make(id))
          },
        }),
      })
      const load = state
        .rebase(loadBase, (next) => {
          if (JSON.stringify(base) === JSON.stringify(next)) return false
          base = next
          return true
        })
        .pipe(Effect.andThen(Effect.sync(() => effective(state.get()))))
      const refresh = SynchronizedRef.updateEffect(catalog, () => load.pipe(Effect.orDie))
      yield* updates.pipe(
        Stream.mapEffect(() => refresh),
        Stream.runDrain,
        Effect.orDie,
        Effect.forkScoped,
      )
      // An identity modification waits for any persisted transition holding the
      // SynchronizedRef, then reads the state installed by that transition.
      const read = SynchronizedRef.modify(catalog, (agents) => [effective(state.get()), agents] as const)
      const list = read.pipe(Effect.withSpan("Agent.list"))
      const get = Effect.fn("Agent.get")(function* (id: Agent.ID) {
        return (yield* read).find((agent) => agent.id === id)
      })
      const resolve = Effect.gen(function* () {
        const agents = yield* read
        const resolved = agents.find((agent) => selectable(agent) !== undefined)
        if (resolved === undefined) return yield* Effect.die(new Error("Agent resolution requires a selectable Agent"))
        return resolved
      }).pipe(Effect.withSpan("Agent.resolve"))
      const create = Effect.fn("Agent.create")(function* (agent: Agent.Info) {
        if (agent.model !== undefined) yield* requireModel(agent.model)
        const outcome = yield* SynchronizedRef.modifyEffect(
          catalog,
          (agents): Effect.Effect<readonly [CreateOutcome, ReadonlyArray<Agent.Info>]> => {
            if (effective(state.get()).some((candidate) => candidate.id === agent.id))
              return Effect.succeed([{ status: "conflict" as const }, agents] as const)
            return database
              .transact(
                Effect.gen(function* () {
                  yield* database.use("Agent.create", (db) =>
                    db
                      .insert(AgentTable)
                      .values({ workspaceId: workspaceID, ...agent })
                      .onConflictDoNothing()
                      .returning({ id: AgentTable.id })
                      .pipe(
                        Effect.orDie,
                        Effect.flatMap((created) =>
                          created[0] === undefined ? Effect.fail(new ConflictError({ id: agent.id })) : Effect.void,
                        ),
                      ),
                  )
                  yield* database.afterCommit(bus.publish(AgentEvent.Created, { workspaceID, id: agent.id }))
                }),
              )
              .pipe(
                Effect.matchEffect({
                  onFailure: () =>
                    load.pipe(
                      Effect.orDie,
                      Effect.map((reloaded) => [{ status: "conflict" as const }, reloaded] as const),
                    ),
                  onSuccess: () =>
                    load.pipe(
                      Effect.orDie,
                      Effect.map(
                        (reloaded) => [{ status: "created" as const, agent: freezeInfo(agent) }, reloaded] as const,
                      ),
                    ),
                }),
              )
          },
        )
        if (outcome.status === "conflict") return yield* new ConflictError({ id: agent.id })
        return outcome.agent
      })
      /**
       * A built-in Agent has no record until an administrator saves one, so its
       * first save inserts the record that replaces its shipped definition.
       */
      const persist = (id: Agent.ID, input: Agent.Update) => {
        const values = {
          ...input,
          model: input.model ?? null,
          description: input.description ?? null,
          color: input.color ?? null,
        }
        if (Agent.BuiltIn.has(id))
          return database.use("Agent.upsert", (db) =>
            db
              .insert(AgentTable)
              .values({ workspaceId: workspaceID, id, ...values })
              .onConflictDoUpdate({ target: [AgentTable.workspaceId, AgentTable.id], set: values })
              .pipe(Effect.orDie, Effect.asVoid),
          )
        return database.use("Agent.update", (db) =>
          db
            .update(AgentTable)
            .set(values)
            .where(and(eq(AgentTable.workspaceId, workspaceID), eq(AgentTable.id, id)))
            .returning({ id: AgentTable.id })
            .pipe(
              Effect.orDie,
              Effect.flatMap((rows) => (rows[0] === undefined ? Effect.fail(new NotFoundError({ id })) : Effect.void)),
            ),
        )
      }
      const update = Effect.fn("Agent.update")(function* (id: Agent.ID, input: Agent.Update) {
        if (input.model !== undefined) yield* requireModel(input.model)
        const updated = withOverridden(freezeInfo({ id, ...input }), Agent.BuiltIn.has(id) ? true : undefined)
        const outcome = yield* SynchronizedRef.modifyEffect(
          catalog,
          (): Effect.Effect<readonly [UpdateOutcome, ReadonlyArray<Agent.Info>]> =>
            database
              .transact(
                Effect.gen(function* () {
                  yield* persist(id, input)
                  yield* database.afterCommit(bus.publish(AgentEvent.Updated, { workspaceID, id }))
                }),
              )
              .pipe(
                Effect.matchEffect({
                  onFailure: () =>
                    load.pipe(
                      Effect.orDie,
                      Effect.map((reloaded) => [{ status: "not-found" as const }, reloaded] as const),
                    ),
                  onSuccess: () =>
                    load.pipe(
                      Effect.orDie,
                      Effect.map((reloaded) => [{ status: "updated" as const, agent: updated }, reloaded] as const),
                    ),
                }),
              ),
        )
        if (outcome.status === "not-found") return yield* new NotFoundError({ id })
        return outcome.agent
      })
      const remove = Effect.fn("Agent.delete")(function* (id: Agent.ID) {
        const outcome = yield* SynchronizedRef.modifyEffect(
          catalog,
          (agents): Effect.Effect<readonly [DeleteOutcome, ReadonlyArray<Agent.Info>]> => {
            if (!effective(state.get()).some((candidate) => candidate.id === id))
              return Effect.succeed([{ status: "not-found" as const }, agents] as const)
            return database
              .transact(
                Effect.gen(function* () {
                  const deleted = yield* database.use("Agent.delete", (db) =>
                    db
                      .delete(AgentTable)
                      .where(and(eq(AgentTable.workspaceId, workspaceID), eq(AgentTable.id, id)))
                      .returning({ id: AgentTable.id })
                      .pipe(Effect.orDie),
                  )
                  // No record means the effective Agent is already its built-in
                  // or contributed definition; removal has nothing to undo.
                  if (deleted[0] === undefined) return
                  yield* database.afterCommit(bus.publish(AgentEvent.Deleted, { workspaceID, id }))
                }),
              )
              .pipe(
                Effect.orDie,
                Effect.flatMap(() =>
                  load.pipe(
                    Effect.orDie,
                    Effect.map((reloaded) => [{ status: "deleted" as const }, reloaded] as const),
                  ),
                ),
              )
          },
        )
        if (outcome.status === "not-found") return yield* new NotFoundError({ id })
      })
      return Service.of({
        transform: state.transform,
        reload: state.reload,
        list,
        get,
        resolve,
        create,
        update,
        delete: remove,
      })
    }),
  )

export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  bus: WorkspaceNode<Bus.Service, E>,
  coordinator = State.makeCoordinator(),
  _config: WorkspaceNode<WorkspaceConfig.Service, E>,
  database?: GlobalNode<Database.Service, E>,
) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(workspaceID, coordinator),
    deps: [database ?? Database.node, bus, Catalog.node],
  })

/**
 * Canonical member Agent capability. The owner and mutable coordinator are
 * acquired with each member graph, never while this recipe is declared.
 */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const { workspaceID } = yield* Actor.Binding.Service
      const coordinator = yield* State.Service
      return layer(workspaceID, coordinator)
    }),
  ),
  deps: [Actor.binding, Database.node, Bus.node, Catalog.node, Routing.node, State.node],
})

const freezeInfo = (agent: Agent.Info): Agent.Info =>
  Object.freeze({
    id: agent.id,
    name: agent.name,
    instructions: agent.instructions,
    ...(agent.model === undefined
      ? {}
      : {
          model: Object.freeze({
            id: agent.model.id,
            provider: agent.model.provider,
            ...(agent.model.variant === undefined ? {} : { variant: agent.model.variant }),
          }),
        }),
    ...(agent.description === undefined ? {} : { description: agent.description }),
    mode: agent.mode,
    hidden: agent.hidden,
    ...(agent.color === undefined ? {} : { color: agent.color }),
    steps: agent.steps,
    permissions: Object.freeze(
      agent.permissions.map((rule) =>
        Object.freeze({ action: rule.action, resource: rule.resource, effect: rule.effect }),
      ),
    ),
  })
