import { Agent } from "@bymorning/core/agent"
import { Bus } from "@bymorning/core/bus"
import { Config } from "@bymorning/core/config"
import { Database } from "@bymorning/core/database"
import { Model } from "@bymorning/core/model"
import { Catalog } from "@bymorning/core/catalog"
import { offlineIntegration } from "../fixtures/offline-integration.js"
import { Provider as ProviderService } from "@bymorning/core/provider"
import { State } from "@bymorning/core/state"
import * as AgentSchema from "@bymorning/schema/agent"
import { AgentEvent } from "@bymorning/schema/agent-event"
import * as ConfigSchema from "@bymorning/schema/config"
import * as Provider from "@bymorning/schema/provider"
import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { and, eq, sql } from "drizzle-orm"
import { database } from "./graph.js"
import {
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Result,
  Schema,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { AgentTable } from "../../src/database/schema/agent.sql.js"
import { ConfigAgentPlugin } from "../../src/config/plugin/agent.js"
import { DefaultAgentPlugin } from "../../src/plugin/internal/agent/default.js"
import { ExploreAgentPlugin } from "../../src/plugin/internal/agent/explore.js"
import { GeneralAgentPlugin } from "../../src/plugin/internal/agent/general.js"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { configFixture, configService } from "../service-fixtures.js"
import { workspaceFixture } from "./workspace-fixture.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const { workspaceID } = workspaceFixture()
const isAgentEvent = Schema.is(Schema.Union(AgentEvent.Definitions))
const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
const configured = (id?: AgentSchema.ID) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      ...(id === undefined ? {} : { BYMORNING_DEFAULT_AGENT: id }),
      DATABASE_URL: process.env.DATABASE_URL,
    }),
  )
/** Workspace Config row fake; the env fallback above is exercised separately. */
const workspaceConfig = (id?: AgentSchema.ID) =>
  Layer.succeed(
    Config.Service,
    configService(
      ConfigSchema.Info.make({
        permissions: [],
        compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
        model_policy: { disabled: [], seen: [], initialized: [] },
        ...(id === undefined ? {} : { default_agent: id }),
      }),
    ),
  )
const catalog = Catalog.layer.pipe(Layer.provide(Layer.mergeAll(
  offlineIntegration,
  workspaceConfig(),
)))
const services = (id?: AgentSchema.ID, events: Layer.Layer<Bus.Service> = bus) =>
  Agent.layer(workspaceID).pipe(
    Layer.provide(catalog),
    Layer.provide(Layer.mergeAll(database, events, Model.layer, ProviderService.layer, workspaceConfig())),
    Layer.provide(configured(id)),
  )
/** A plugin-contributed Agent identity with no platform meaning. */
const contributed = AgentSchema.ID.make("contributed")
const makeAgent = (id: AgentSchema.ID, instructions = "") =>
  AgentSchema.Info.make({
    id,
    name: AgentSchema.Name.make(id),
    instructions,
    model: { provider: Provider.OpenAI, id: "gpt-5.6" },
    mode: "primary",
    hidden: false,
    steps: null,
    permissions: [],
  })
const awaitAgent = Effect.fn("AgentTest.await")(function* (agents: Agent.Interface, id: AgentSchema.ID) {
  while (true) {
    const agent = yield* agents.get(id)
    if (agent !== undefined) return agent
    yield* Effect.yieldNow
  }
})

it.effect("Agent lists a plugin-contributed profile and creates Workspace-local profiles", () => {
  const name = AgentSchema.ID.make(`created-${crypto.randomUUID()}`)
  return Effect.scoped(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.update(contributed, (agent) =>
          Object.assign(agent, { ...makeAgent(contributed), name: AgentSchema.Name.make("Contributed"), steps: 5 }),
        )
      })
      expect(yield* agents.get(contributed)).toEqual({
        id: contributed,
        name: AgentSchema.Name.make("Contributed"),
        instructions: "",
        model: { provider: Provider.OpenAI, id: "gpt-5.6" },
        mode: "primary",
        hidden: false,
        steps: 5,
        permissions: [],
      })
      expect(yield* agents.get(AgentSchema.ID.make("missing"))).toBeUndefined()

      const created = yield* agents.create(makeAgent(name, "created"))
      expect(yield* agents.get(name)).toEqual(created)
      expect((yield* agents.list).find((agent) => agent.id === name)).toEqual(created)
      expect(Object.isFrozen(yield* agents.list)).toBe(true)
      expect(Object.isFrozen(created)).toBe(true)
      expect(yield* agents.create(created).pipe(Effect.flip)).toEqual(new Agent.ConflictError({ id: name }))
    }),
  ).pipe(Effect.provide(services()))
})

it.effect("Agent transform-created profiles have no Step limit by default", () => {
  const id = AgentSchema.ID.make(`unlimited-${crypto.randomUUID()}`)
  return Effect.scoped(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => editor.update(id, () => undefined))

      expect(yield* agents.get(id)).toMatchObject({ id, steps: null })
    }),
  ).pipe(Effect.provide(services()))
})

it.effect("Agent updates persisted profiles and publishes only successful lifecycle mutations", () => {
  const name = AgentSchema.ID.make(`updated-${crypto.randomUUID()}`)
  const missing = AgentSchema.ID.make(`missing-${crypto.randomUUID()}`)

  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const events = yield* Bus.Service
    const received = yield* (yield* events
      .subscribe(AgentEvent.Definitions))
      .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
    yield* Effect.yieldNow

    const created = yield* agents.create(
      AgentSchema.Info.make({ ...makeAgent(name, "created"), description: "temporary", color: "#123456" }),
    )
    const input = AgentSchema.Update.make({
      name: created.name,
      instructions: "updated",
      mode: created.mode,
      hidden: created.hidden,
      steps: created.steps,
      permissions: created.permissions,
    })
    expect(yield* agents.update(missing, input).pipe(Effect.flip)).toEqual(new Agent.NotFoundError({ id: missing }))
    const updated = yield* agents.update(name, input)

    expect(updated).toEqual({
      id: created.id,
      name: created.name,
      instructions: "updated",
      mode: created.mode,
      hidden: created.hidden,
      steps: created.steps,
      permissions: created.permissions,
    })
    expect(yield* agents.get(name)).toEqual(updated)
    const persisted = yield* Database.Service.use((database) =>
      database.use("AgentTest.updated.nulls", (db) =>
        db
          .select({ model: AgentTable.model, description: AgentTable.description, color: AgentTable.color })
          .from(AgentTable)
          .where(and(eq(AgentTable.workspaceId, workspaceID), eq(AgentTable.id, name))),
      ),
    )
    expect(persisted).toEqual([{ model: null, description: null, color: null }])
    const reloaded = Context.get(yield* Layer.build(services()), Agent.Service)
    expect(yield* reloaded.get(name)).toEqual(updated)
    expect(Object.isFrozen(updated)).toBe(true)
    expect((yield* Fiber.join(received)).map((event) => ({ type: event.type, id: event.data.id }))).toEqual([
      { type: "agent.created", id: name },
      { type: "agent.updated", id: name },
    ])
  }).pipe(Effect.provide(Layer.merge(Layer.provideMerge(services(), bus), database)), Effect.scoped)
})

it.effect("Agent rejects unavailable models before create or update persistence", () => {
  const name = AgentSchema.ID.make(`model-${crypto.randomUUID()}`)
  const unavailable = { provider: Provider.Bymorning, id: "missing-model" }
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const created = yield* agents.create(makeAgent(name))

    const createName = AgentSchema.ID.make(`invalid-${crypto.randomUUID()}`)
    const createInput = AgentSchema.Info.make({ ...makeAgent(createName), model: unavailable })
    expect(yield* agents.create(createInput).pipe(Effect.flip)).toEqual(
      new Agent.ModelUnavailableError({ model: unavailable }),
    )
    expect(yield* agents.get(createName)).toBeUndefined()

    const updateInput = AgentSchema.Update.make({ ...created, model: unavailable })
    expect(yield* agents.update(name, updateInput).pipe(Effect.flip)).toEqual(
      new Agent.ModelUnavailableError({ model: unavailable }),
    )
    expect(yield* agents.get(name)).toEqual(created)
  }).pipe(Effect.provide(services()))
})

it.effect("Agent reads wait for create and update catalog installation", () => {
  const name = AgentSchema.ID.make(`serialized-${crypto.randomUUID()}`)
  const contributed = AgentSchema.ID.make(`activation-${crypto.randomUUID()}`)
  return Effect.gen(function* () {
    const store = yield* Database.Service
    const blockNextLoad = yield* Ref.make(false)
    const loadBlocked = yield* Queue.unbounded<true>()
    const releaseLoad = yield* Queue.unbounded<true>()
    const use: Database.Interface["use"] = (label, operation) =>
      store
        .use(label, operation)
        .pipe(
          Effect.tap(() =>
            label !== "Agent.load"
              ? Effect.void
              : Ref.getAndSet(blockNextLoad, false).pipe(
                  Effect.flatMap((block) =>
                    block
                      ? Queue.offer(loadBlocked, true).pipe(Effect.andThen(Queue.take(releaseLoad)), Effect.asVoid)
                      : Effect.void,
                  ),
                ),
          ),
        )
    const coordinator = State.makeCoordinator()
    const context = yield* Layer.build(
      Agent.layer(workspaceID, coordinator).pipe(
        Layer.provide(catalog),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Database.Service, Database.Service.of({ ...store, use })),
            bus,
            Model.layer,
            ProviderService.layer,
            workspaceConfig(),
          ),
        ),
        Layer.provide(configured()),
      ),
    )
    const agents = Context.get(context, Agent.Service)

    yield* Ref.set(blockNextLoad, true)
    const create = yield* agents.create(makeAgent(name, "created")).pipe(Effect.forkScoped)
    yield* Queue.take(loadBlocked)
    const getStarted = yield* Deferred.make<void>()
    const get = yield* Deferred.succeed(getStarted, undefined).pipe(Effect.andThen(agents.get(name)), Effect.forkScoped)
    const activation = yield* State.batch(
      coordinator,
      agents.transform((editor) => editor.update(contributed, (agent) => Object.assign(agent, makeAgent(contributed)))),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(getStarted)
    yield* Effect.yieldNow
    expect(get.pollUnsafe()).toBeUndefined()
    expect(activation.pollUnsafe()).toBeUndefined()
    yield* Queue.offer(releaseLoad, true)
    expect(yield* Fiber.join(get)).toEqual(yield* Fiber.join(create))
    yield* Fiber.join(activation)
    expect(yield* agents.get(contributed)).toEqual(makeAgent(contributed))

    const input = AgentSchema.Update.make({ ...makeAgent(name), instructions: "updated" })
    yield* Ref.set(blockNextLoad, true)
    const update = yield* agents.update(name, input).pipe(Effect.forkScoped)
    yield* Queue.take(loadBlocked)
    const listStarted = yield* Deferred.make<void>()
    const list = yield* Deferred.succeed(listStarted, undefined).pipe(Effect.andThen(agents.list), Effect.forkScoped)
    yield* Deferred.await(listStarted)
    yield* Effect.yieldNow
    expect(list.pollUnsafe()).toBeUndefined()
    yield* Queue.offer(releaseLoad, true)
    const updated = yield* Fiber.join(update)
    expect((yield* Fiber.join(list)).find((agent) => agent.id === name)).toEqual(updated)
  }).pipe(Effect.provide(database), Effect.scoped)
})

it.effect("Agent default resolution uses BYMORNING_DEFAULT_AGENT and otherwise stable order", () => {
  const selected = makeAgent(AgentSchema.ID.make(`selected-${crypto.randomUUID()}`))
  return Effect.scoped(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.update(contributed, (agent) => Object.assign(agent, makeAgent(contributed)))
        editor.update(selected.id, (agent) => Object.assign(agent, selected))
      })
      expect(yield* agents.resolve).toEqual(selected)
      expect(yield* agents.create(selected).pipe(Effect.flip)).toEqual(new Agent.ConflictError({ id: selected.id }))
      const preferred = yield* agents.transform((editor) => editor.default(contributed))
      expect(yield* agents.resolve).toEqual(makeAgent(contributed))
      yield* preferred.dispose
      expect(yield* agents.resolve).toEqual(selected)
    }),
  ).pipe(Effect.provide(services(selected.id)))
})

it.effect("updates the configured default agent and falls back to the plugin default when removed", () => {
  const configuredID = AgentSchema.ID.make(`configured-${crypto.randomUUID()}`)
  const changedID = AgentSchema.ID.make(`changed-${crypto.randomUUID()}`)
  const contributed = AgentSchema.ID.make(`contributed-${crypto.randomUUID()}`)
  const configInfo = (id?: AgentSchema.ID) =>
    ConfigSchema.Info.make({
      permissions: [],
      compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
      model_policy: { disabled: [], seen: [], initialized: [] },
      ...(id === undefined ? {} : { default_agent: id }),
    })
  return Effect.scoped(
    Effect.gen(function* () {
      const config = yield* configFixture(configInfo(configuredID))
      return yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        yield* agents.create(makeAgent(contributed))
        yield* agents.create(makeAgent(configuredID))
        yield* agents.create(makeAgent(changedID))
        yield* agents.transform((editor) => editor.default(contributed))
        yield* ConfigAgentPlugin.Plugin.effect({ agent: agents } as unknown as PluginContext)
        expect(yield* agents.resolve).toEqual(makeAgent(configuredID))

        yield* config.publish(configInfo(changedID))
        yield* TestClock.adjust("1 second")
        expect(yield* agents.resolve).toEqual(makeAgent(changedID))

        yield* config.publish(configInfo())
        yield* TestClock.adjust("1 second")
        expect(yield* agents.resolve).toEqual(makeAgent(contributed))
      }).pipe(
        Effect.provide(
          Layer.merge(
            Agent.layer(workspaceID).pipe(
              Layer.provide(catalog),
              Layer.provide(Layer.mergeAll(database, bus, Model.layer, ProviderService.layer)),
              Layer.provide(configured()),
            ),
            config.layer,
          ),
        ),
      )
    }),
  )
})

it.effect("Agent default selection skips hidden and subagent-only profiles while direct lookup resolves them", () => {
  const hidden = { ...makeAgent(AgentSchema.ID.make(`hidden-${crypto.randomUUID()}`)), hidden: true }
  const subagent = { ...makeAgent(AgentSchema.ID.make(`subagent-${crypto.randomUUID()}`)), mode: "subagent" as const }
  const primary = makeAgent(AgentSchema.ID.make(`primary-${crypto.randomUUID()}`))
  return Effect.scoped(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        for (const agent of editor.list()) editor.remove(agent.id)
        editor.update(hidden.id, (agent) => Object.assign(agent, hidden))
        editor.update(subagent.id, (agent) => Object.assign(agent, subagent))
        editor.update(primary.id, (agent) => Object.assign(agent, primary))
        editor.default(subagent.id)
      })

      expect(yield* agents.resolve).toEqual(primary)
      expect(yield* agents.get(hidden.id)).toEqual(hidden)
      expect(yield* agents.get(subagent.id)).toEqual(subagent)
      expect((yield* agents.list).map((agent) => agent.id)).toEqual([primary.id, hidden.id, subagent.id])
    }),
  ).pipe(Effect.provide(services()))
})

it.effect("Agent plugin profiles shadow persisted profiles by ID", () => {
  const name = AgentSchema.ID.make(`shadow-${crypto.randomUUID()}`)
  return Effect.gen(function* () {
    const persisted = yield* Agent.Service.use((agents) => agents.create(makeAgent(name, "persisted"))).pipe(
      Effect.provide(services()),
    )
    const shadow = makeAgent(name, "plugin")
    const effective = yield* Effect.scoped(
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const registration = yield* agents.transform((editor) =>
          editor.update(name, (agent) => Object.assign(agent, shadow)),
        )
        const transformed = yield* Effect.all({ listed: agents.list, found: agents.get(name) })
        yield* registration.dispose
        return { transformed, restored: yield* agents.get(name) }
      }),
    ).pipe(Effect.provide(services()))

    expect(persisted.instructions).toBe("persisted")
    expect(effective.transformed.found).toEqual(shadow)
    expect(effective.transformed.listed.filter((agent) => agent.id === name)).toEqual([shadow])
    expect(effective.restored).toEqual(persisted)
  })
})

it.effect("Agent rejects invalid persisted rows during layer acquisition", () => {
  const name = `invalid-${crypto.randomUUID()}`
  return Effect.gen(function* () {
    const store = yield* Database.Service
    yield* store.use("AgentTest.invalid.insert", (db) =>
      db.execute(sql`insert into agent (workspace_id, id, name, instructions, model, mode, hidden, steps, permissions)
          values (${workspaceID}, ${name}, ${name}, '', '{"provider":"prv_invalid","id":"invalid"}'::jsonb,
            'primary', false, null, '[]'::jsonb)`),
    )
    const acquired = yield* Layer.build(services()).pipe(Effect.exit)
    expect(Exit.isFailure(acquired)).toBe(true)
  }).pipe(
    Effect.ensuring(
      Database.Service.use((store) =>
        store.use("AgentTest.invalid.delete", (db) =>
          db.execute(sql`delete from agent where workspace_id = ${workspaceID} and name = ${name}`),
        ),
      ).pipe(Effect.orDie),
    ),
    Effect.provide(database),
    Effect.scoped,
  )
})

it.effect("Agent layers sharing a Workspace Bus observe each other's committed creates", () => {
  const name = AgentSchema.ID.make(`observed-${crypto.randomUUID()}`)
  return Effect.gen(function* () {
    const shared = Layer.succeed(Bus.Service, yield* Bus.Service)
    const contextA = yield* Layer.build(services(undefined, shared))
    const contextB = yield* Layer.build(services(undefined, shared))
    const agentsA = Context.get(contextA, Agent.Service)
    const agentsB = Context.get(contextB, Agent.Service)

    const created = yield* agentsA.create(makeAgent(name, "shared-bus"))
    yield* TestClock.adjust("1 second")
    expect(yield* awaitAgent(agentsB, name)).toEqual(created)
  }).pipe(Effect.provide(Layer.merge(bus, TestClock.layer())), Effect.scoped)
})

it.effect("simultaneous different-name creates converge without lost visibility", () => {
  const first = AgentSchema.ID.make(`parallel-a-${crypto.randomUUID()}`)
  const second = AgentSchema.ID.make(`parallel-b-${crypto.randomUUID()}`)
  return Effect.gen(function* () {
    const shared = Layer.succeed(Bus.Service, yield* Bus.Service)
    const contextA = yield* Layer.build(services(undefined, shared))
    const contextB = yield* Layer.build(services(undefined, shared))
    const agentsA = Context.get(contextA, Agent.Service)
    const agentsB = Context.get(contextB, Agent.Service)

    yield* Effect.all([agentsA.create(makeAgent(first)), agentsB.create(makeAgent(second))], {
      concurrency: "unbounded",
    })
    yield* TestClock.adjust("1 second")
    yield* Effect.all([
      awaitAgent(agentsA, first),
      awaitAgent(agentsA, second),
      awaitAgent(agentsB, first),
      awaitAgent(agentsB, second),
    ])
    expect((yield* agentsA.list).filter((agent) => agent.id === first || agent.id === second)).toHaveLength(2)
    expect((yield* agentsB.list).filter((agent) => agent.id === first || agent.id === second)).toHaveLength(2)
  }).pipe(Effect.provide(Layer.merge(bus, TestClock.layer())), Effect.scoped)
})

it.effect("a uniqueness-conflict loser refreshes before returning", () => {
  const name = AgentSchema.ID.make(`conflict-${crypto.randomUUID()}`)
  return Effect.gen(function* () {
    const contextA = yield* Layer.build(services())
    const contextB = yield* Layer.build(services())
    const agentsA = Context.get(contextA, Agent.Service)
    const agentsB = Context.get(contextB, Agent.Service)
    const outcomes = yield* Effect.all(
      [
        agentsA.create(makeAgent(name, "first")).pipe(Effect.result),
        agentsB.create(makeAgent(name, "second")).pipe(Effect.result),
      ],
      { concurrency: "unbounded" },
    )
    const winner = outcomes.find(Result.isSuccess)
    const loser = Result.isFailure(outcomes[0]) ? agentsA : agentsB

    expect(winner === undefined ? undefined : winner.success.id).toBe(name)
    expect(outcomes.filter(Result.isFailure).map((result) => result.failure)).toEqual([
      new Agent.ConflictError({ id: name }),
    ])
    expect(yield* loser.get(name)).toEqual(winner === undefined ? undefined : winner.success)
  }).pipe(Effect.scoped)
})

/** Mirrors the guard every shipped built-in Agent plugin applies. */
const seed = (id: AgentSchema.ID, instructions: string) => (editor: Agent.Editor) => {
  if (editor.get(id) !== undefined) return
  editor.update(id, (agent) => Object.assign(agent, makeAgent(id, instructions)))
}

it.effect("saving a built-in Agent writes the record that replaces its shipped definition", () => {
  const id = AgentSchema.DefaultID
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const events = yield* Bus.Service
    const received = yield* (yield* events.subscribe(AgentEvent.Definitions)).pipe(
      Stream.filter((event) => event.data.id === id),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    yield* agents.transform(seed(id, "shipped"))

    expect(yield* agents.get(id)).toMatchObject({ id, instructions: "shipped" })

    const override = AgentSchema.Update.make({
      name: AgentSchema.Name.make("Overridden"),
      instructions: "workspace override",
      mode: "primary",
      hidden: false,
      steps: null,
      permissions: [],
    })
    // No record exists yet, so the first save inserts rather than failing.
    const saved = yield* agents.update(id, override)

    expect(saved).toEqual({ id, ...override, overridden: true })
    expect(yield* agents.get(id)).toEqual(saved)
    const reloaded = Context.get(yield* Layer.build(services()), Agent.Service)
    expect(yield* reloaded.get(id)).toEqual(saved)

    // Removing the record restores the shipped definition.
    yield* agents.delete(id)

    expect(yield* agents.get(id)).toMatchObject({ id, instructions: "shipped" })
    expect((yield* Fiber.join(received)).map((event) => event.type)).toEqual(["agent.updated", "agent.deleted"])
  }).pipe(Effect.provide(Layer.merge(Layer.provideMerge(services(), bus), database)), Effect.scoped)
})

it.effect("a built-in Agent override survives a second save and reload", () => {
  const id = AgentSchema.GeneralID
  const draft = (instructions: string) =>
    AgentSchema.Update.make({
      name: AgentSchema.Name.make("General"),
      instructions,
      mode: "subagent",
      hidden: false,
      steps: null,
      permissions: [],
    })
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform(seed(id, "shipped"))
    yield* agents.update(id, draft("first override"))
    const saved = yield* agents.update(id, draft("second override"))

    expect(yield* agents.get(id)).toEqual(saved)
    const reloaded = Context.get(yield* Layer.build(services()), Agent.Service)
    expect(yield* reloaded.get(id)).toMatchObject({ instructions: "second override" })

    yield* agents.delete(id)
  }).pipe(Effect.provide(Layer.merge(Layer.provideMerge(services(), bus), database)), Effect.scoped)
})

it.effect("the real built-in Agent plugins yield to a saved Workspace record", () => {
  const override = (name: string) =>
    AgentSchema.Update.make({
      name: AgentSchema.Name.make(name),
      instructions: "workspace override",
      mode: "primary",
      hidden: false,
      steps: null,
      permissions: [],
    })
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.update(AgentSchema.DefaultID, override("Overridden default"))
    yield* agents.update(AgentSchema.GeneralID, override("Overridden general"))
    yield* agents.update(AgentSchema.ExploreID, override("Overridden explore"))

    const context = { agent: agents } as unknown as PluginContext
    yield* DefaultAgentPlugin.effect(context)
    yield* GeneralAgentPlugin.effect(context)
    yield* ExploreAgentPlugin.effect(context)

    for (const id of [AgentSchema.DefaultID, AgentSchema.GeneralID, AgentSchema.ExploreID])
      expect(yield* agents.get(id)).toMatchObject({ instructions: "workspace override", overridden: true })
  }).pipe(Effect.provide(services()))
})

it.effect("deleting an Agent is idempotent for an effective Agent and refuses an unknown one", () => {
  const contributed = AgentSchema.ID.make(`contributed-${crypto.randomUUID()}`)
  const missing = AgentSchema.ID.make(`absent-${crypto.randomUUID()}`)
  const persisted = AgentSchema.ID.make(`removable-${crypto.randomUUID()}`)
  return Effect.scoped(
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(contributed, (agent) => Object.assign(agent, makeAgent(contributed, "contributed"))),
      )
      const created = yield* agents.create(makeAgent(persisted, "persisted"))

      // An effective Agent with no record is already at its contributed definition.
      yield* agents.delete(contributed)
      expect(yield* agents.get(contributed)).toMatchObject({ id: contributed, instructions: "contributed" })

      expect(yield* agents.delete(missing).pipe(Effect.flip)).toEqual(new Agent.NotFoundError({ id: missing }))

      expect(created.id).toBe(persisted)
      yield* agents.delete(persisted)
      expect(yield* agents.get(persisted)).toBeUndefined()
    }),
  ).pipe(Effect.provide(services()))
})
