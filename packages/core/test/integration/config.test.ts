import { Config } from "@bymorning/core/config"
import { Bus } from "@bymorning/core/bus"
import { ConfigTable, Database, WorkspaceTable } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Model as ModelService } from "@bymorning/core/model"
import * as ConfigSchema from "@bymorning/schema/config"
import { SystemActor } from "@bymorning/schema/actor"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Plugin } from "@bymorning/schema/plugin"
import * as Workspace from "@bymorning/schema/workspace"
import { Event } from "@bymorning/schema/event"
import { eq, inArray, sql } from "drizzle-orm"
import { Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Schema, Stream } from "effect"
import { expect, test } from "vitest"
import { database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const resolved = (input: ConfigSchema.Stored) => Schema.decodeUnknownSync(ConfigSchema.Info)(input)
const fast = Model.Ref.make({ provider: Provider.Bymorning, id: "fast" })
const careful = Model.Ref.make({ provider: Provider.Bymorning, id: "careful" })
const secondModel = Model.Ref.make({ provider: Provider.Bymorning, id: "second" })
const permissions = [
  { action: "read", resource: "*", effect: "deny" as const },
  { action: "linear_*", resource: "*", effect: "allow" as const },
]

/** These focused Config tests act as a trusted internal caller: the system Actor. */
const system = (workspaceID: Workspace.ID) => new SystemActor({ type: "system", properties: { workspaceID } })

test("Config isolates Workspaces, replaces values, and refreshes active state", async () => {
  const firstID = Workspace.ID.create()
  const secondID = Workspace.ID.create()
  const bus = Layer.effect(
    Bus.Service,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<Event.Payload>()
      return Bus.Service.of({
        publish: ((definition: Event.Definition, data: unknown) =>
          Effect.gen(function* () {
            const event = {
              id: Event.ID.make(crypto.randomUUID()),
              created: Date.now(),
              type: definition.type,
              data,
            } as Event.Payload<typeof definition>
            yield* PubSub.publish(events, event)
            return event
          })) as Bus.Interface["publish"],
        subscribe: (() => PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription))) as Bus.Subscribe,
      })
    }),
  )
  const installation = Installation.layer.pipe(Layer.provide(database))
  const first = Config.layer(firstID).pipe(Layer.provide(Layer.mergeAll(database, bus, installation)))
  const second = Config.layer(secondID).pipe(Layer.provide(Layer.mergeAll(database, bus, installation)))

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("ConfigTest.setup", (db) =>
        Effect.gen(function* () {
          yield* db.insert(WorkspaceTable).values([
            { id: firstID, name: "Config first", status: "active" },
            { id: secondID, name: "Config second", status: "active" },
          ])
          yield* db.insert(ConfigTable).values([{ workspaceId: firstID }, { workspaceId: secondID }])
        }),
      )

      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(yield* config.entries()).toEqual([{ type: "document", info: resolved({}) }])
        const changes = yield* config.changes().pipe(Stream.take(3), Stream.runCollect, Effect.forkChild)
        expect(yield* config.update({ default_agent: "build", default_model: fast }, system(firstID))).toEqual(
          resolved({ default_agent: "build" }),
        )
        yield* config.modelPolicy.setDefault(careful, system(firstID))
        const selected = resolved({
          default_model: careful,
          model_policy: { disabled: [], seen: [careful], initialized: [] },
        })
        expect(yield* config.update({ default_model: fast }, system(firstID))).toEqual(selected)
        yield* database.use("ConfigTest.replace", (db) =>
          db
            .update(ConfigTable)
            .set({ value: { default_agent: "review" } })
            .where(eq(ConfigTable.workspaceId, firstID)),
        )
        expect(yield* config.get).toEqual(selected)
        // The direct database replacement also clears the persisted model policy.
        expect(yield* config.refresh).toEqual(resolved({ default_agent: "review" }))
        expect((yield* Fiber.join(changes)).length).toBe(3)

        const unchanged = yield* config.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* config.refresh
        yield* Effect.sleep("10 millis")
        expect(unchanged.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(unchanged)

        yield* Effect.all([config.update({ default_agent: "first" }, system(firstID)), config.update({ default_model: secondModel }, system(firstID))], {
          concurrency: "unbounded",
        })
        const active = yield* config.get
        const persisted = (yield* database.use("ConfigTest.read", (db) =>
          db.select({ value: ConfigTable.value }).from(ConfigTable).where(eq(ConfigTable.workspaceId, firstID)),
        ))[0]?.value
        if (persisted === undefined) throw new Error("Expected persisted Config")
        expect(active).toEqual(resolved(persisted))

        yield* config.update({ default_agent: "build" }, system(firstID))
        yield* Effect.all(
          [config.update({ default_agent: "review" }, system(firstID)), config.modelPolicy.toggle({ ...fast, enabled: false }, system(firstID))],
          { concurrency: "unbounded" },
        )
        expect(yield* config.get).toEqual(
          resolved({
            default_agent: "review",
            model_policy: { disabled: [fast], seen: [fast], initialized: [] },
          }),
        )

        yield* Effect.all(
          [
            config.modelPolicy.toggle({ ...careful, enabled: false }, system(firstID)),
            config.modelPolicy.toggle({ ...secondModel, enabled: false }, system(firstID)),
          ],
          { concurrency: "unbounded" },
        )
        expect((yield* config.get).model_policy).toEqual({
          disabled: [fast, careful, secondModel],
          seen: [fast, careful, secondModel],
          initialized: [],
        })

        yield* config.update(
          {
            default_agent: "review",
            permissions,
            mcp: {
              servers: {
                removed: { type: "remote", url: "https://removed.example/mcp" },
                retained: { type: "remote", url: "https://retained.example/mcp" },
              },
            },
          },
          system(firstID),
        )
        yield* Effect.all(
          [
            config.mcp.remove("removed", system(firstID)),
            config.mcp.put("first", { type: "remote", url: "https://first.example/mcp" }, system(firstID)),
            config.mcp.put("second", { type: "remote", url: "https://second.example/mcp" }, system(firstID)),
          ],
          { concurrency: "unbounded" },
        )
        expect(yield* config.get).toMatchObject({
          default_agent: "review",
          permissions,
          mcp: {
            servers: {
              retained: { url: "https://retained.example/mcp" },
              first: { url: "https://first.example/mcp" },
              second: { url: "https://second.example/mcp" },
            },
          },
        })
        expect((yield* config.get).mcp?.servers).not.toHaveProperty("removed")
        const persistedAfterMcpWrites = (yield* database.use("ConfigTest.readPermissions", (db) =>
          db.select({ value: ConfigTable.value }).from(ConfigTable).where(eq(ConfigTable.workspaceId, firstID)),
        ))[0]?.value
        if (persistedAfterMcpWrites === undefined) throw new Error("Expected persisted Config")
        expect(resolved(persistedAfterMcpWrites).permissions).toEqual(permissions)

        yield* config.update(
          {
            plugins: ["unrelated", { package: "configured-package", options: { mode: "old" } }],
          },
          system(firstID),
        )
        const pluginUpdate = yield* config.plugin.configure(
          { type: "package", package: "configured-package" },
          Plugin.ID.make("package.plugin"),
          { mode: "strict" },
        )
        expect((yield* config.get).plugins).toEqual([
          "unrelated",
          { package: "configured-package", options: { mode: "strict" } },
        ])
        yield* pluginUpdate.rollback
        expect((yield* config.get).plugins).toEqual([
          "unrelated",
          { package: "configured-package", options: { mode: "old" } },
        ])

        const conditional = yield* config.plugin.configure({ type: "builtin" }, Plugin.ID.make("builtin.configured"), {
          enabled: true,
        })
        const configured = yield* config.get
        yield* config.update({ plugins: [...(configured.plugins ?? []), "later-write"] }, system(firstID))
        yield* conditional.rollback
        expect((yield* config.get).plugins).toEqual([...(configured.plugins ?? []), "later-write"])

        const beforeInvalidRefresh = yield* config.get
        yield* database.use("ConfigTest.invalidate", (db) =>
          db
            .update(ConfigTable)
            .set({ value: sql`'{"default_agent": 1}'::jsonb` })
            .where(eq(ConfigTable.workspaceId, firstID)),
        )
        expect(Exit.isFailure(yield* Effect.exit(config.refresh))).toBe(true)
        expect(yield* config.get).toEqual(beforeInvalidRefresh)
      }).pipe(Effect.provide(first))

      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(yield* config.get).toEqual(resolved({}))
      }).pipe(Effect.provide(second))
    }).pipe(
      Effect.ensuring(
        Database.Service.use((database) =>
          database.use("ConfigTest.cleanup", (db) =>
            db
              .delete(WorkspaceTable)
              .where(inArray(WorkspaceTable.id, [firstID, secondID]))
              .pipe(Effect.orDie),
          ),
        ),
      ),
      Effect.provide(database),
    ),
  )
})

test("Config serializes whole and focused policy writes across service instances", async () => {
  const workspaceID = Workspace.ID.create()

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("ConfigLaneTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Config lanes", status: "active" })
            yield* db.insert(ConfigTable).values({ workspaceId: workspaceID })
          }),
        )

        const bus = yield* Bus.Service.pipe(Effect.provide(makeBusLayer()))
        const databaseService = Layer.succeed(Database.Service, database)
        const dependencies = Layer.mergeAll(
          databaseService,
          Layer.succeed(Bus.Service, bus),
          Installation.layer.pipe(Layer.provide(databaseService)),
        )
        const first = Context.get(
          yield* Layer.build(Config.layer(workspaceID).pipe(Layer.provide(dependencies))),
          Config.Service,
        )
        const second = Context.get(
          yield* Layer.build(Config.layer(workspaceID).pipe(Layer.provide(dependencies))),
          Config.Service,
        )
        const runWithFirstLock = <A, B>(firstWrite: Effect.Effect<A, unknown>, secondWrite: Effect.Effect<B, unknown>) =>
          Effect.gen(function* () {
            const locked = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const firstFiber = yield* database
              .transact(
                firstWrite.pipe(
                  Effect.tap(() => Deferred.succeed(locked, undefined)),
                  Effect.andThen(Deferred.await(release)),
                ),
              )
              .pipe(Effect.forkChild)
            yield* Deferred.await(locked)
            const secondFiber = yield* secondWrite.pipe(Effect.forkChild)
            yield* Effect.yieldNow
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(firstFiber)
            yield* Fiber.join(secondFiber)
          })

        yield* first.modelPolicy.setDefault(careful, system(workspaceID))
        yield* runWithFirstLock(
          first.update(
            {
              default_agent: "build",
              default_model: fast,
              model_policy: { disabled: [], seen: [], initialized: [] },
            },
            system(workspaceID),
          ),
          second.modelPolicy.toggle({ ...secondModel, enabled: false }, system(workspaceID)),
        )
        expect(yield* first.refresh).toMatchObject({
          default_agent: "build",
          default_model: careful,
          model_policy: { disabled: [secondModel], seen: [careful, secondModel] },
        })

        yield* runWithFirstLock(
          second.modelPolicy.toggle({ ...fast, enabled: false }, system(workspaceID)),
          first.update(
            {
              default_agent: "review",
              default_model: secondModel,
              model_policy: { disabled: [], seen: [], initialized: [] },
            },
            system(workspaceID),
          ),
        )
        expect(yield* second.refresh).toMatchObject({
          default_agent: "review",
          default_model: careful,
          model_policy: { disabled: [secondModel, fast], seen: [careful, secondModel, fast] },
        })

        yield* runWithFirstLock(
          first.modelPolicy.toggle({ ...careful, enabled: false }, system(workspaceID)),
          second.modelPolicy.setDefault(fast, system(workspaceID)),
        )
        expect(yield* first.refresh).toMatchObject({
          default_model: fast,
          model_policy: { disabled: [secondModel, fast, careful], seen: [careful, secondModel, fast] },
        })
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("ConfigLaneTest.cleanup", (db) =>
              db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).pipe(Effect.orDie),
            ),
          ),
        ),
      ),
    ).pipe(Effect.provide(database)),
  )
})

test("Config migrates legacy seen state and reconciles each identity once", async () => {
  const workspaceID = Workspace.ID.create()
  const stale = Model.Ref.make({ provider: Provider.Fireworks, id: "removed" })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("ConfigSeenTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Config seen", status: "active" })
            yield* db.insert(ConfigTable).values({
              workspaceId: workspaceID,
              value: {
                model_policy: { disabled: [stale], seen: [stale], initialized: [Provider.Anthropic] },
              },
            })
          }),
        )
        const bus = yield* Bus.Service.pipe(Effect.provide(makeBusLayer()))
        const config = yield* Config.Service.pipe(
          Effect.provide(
            Config.layer(workspaceID).pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Database.Service, database),
                  Layer.succeed(Bus.Service, bus),
                  Installation.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database))),
                ),
              ),
            ),
          ),
        )
        const modelService = yield* ModelService.Service.pipe(Effect.provide(ModelService.layer))
        const reconcile = config.modelPolicy.reconcile
        if (reconcile === undefined) throw new Error("Expected Config model policy reconciliation")
        const anthropic = (yield* modelService.list).filter((model) => model.provider === Provider.Anthropic)
        const active = anthropic.find((model) => model.status === "active")
        if (active === undefined) throw new Error("Expected an active Anthropic model")
        // The bundled registry omits deprecated Models, so the deprecation arrives
        // with the reconciled catalog rather than from the bundled list.
        const newActive = { ...active, id: "new-active", apiID: "new-active" }
        const newDeprecated = { ...active, id: "new-deprecated", apiID: "new-deprecated", status: "deprecated" as const }

        yield* reconcile(Provider.Anthropic, [...anthropic, newActive, newDeprecated])
        const reconciled = (yield* config.get).model_policy
        const baseline = new Set(
          (Config.legacySeenBaseline.get(Provider.Anthropic) ?? []).map((model) => `${model.provider}/${model.id}`),
        )
        const newlyDeprecated = [...anthropic, newDeprecated]
          .filter((model) => model.status === "deprecated" && !baseline.has(`${model.provider}/${model.id}`))
          .map(({ provider, id }) => ({ provider, id }))
        expect(reconciled.seen[0]).toEqual(stale)
        expect(reconciled.seen).toEqual(
          expect.arrayContaining(
            [...anthropic, newActive, newDeprecated].map(({ provider, id }) => ({ provider, id })),
          ),
        )
        expect(reconciled.disabled).toEqual([stale, ...newlyDeprecated])

        yield* config.modelPolicy.toggle({ provider: Provider.Anthropic, id: "new-deprecated", enabled: true }, system(workspaceID))
        const unchanged = yield* (yield* bus
          .subscribe(ConfigSchema.Event.Updated))
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* reconcile(Provider.Anthropic, [...anthropic, newActive, newDeprecated])
        expect((yield* config.get).model_policy.disabled).toEqual(
          [stale, ...newlyDeprecated].filter((model) => model.id !== "new-deprecated"),
        )
        expect(unchanged.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(unchanged)
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("ConfigSeenTest.cleanup", (db) =>
              db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).pipe(Effect.orDie),
            ),
          ),
        ),
      ),
    ).pipe(Effect.provide(database)),
  )
})

test("Config persists custom Models as server-owned state and removes their enablement with them", async () => {
  const workspaceID = Workspace.ID.create()

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("ConfigCustomTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Config custom", status: "active" })
            yield* db.insert(ConfigTable).values({ workspaceId: workspaceID })
          }),
        )
        const bus = yield* Bus.Service.pipe(Effect.provide(makeBusLayer()))
        const databaseService = Layer.succeed(Database.Service, database)
        const config = Context.get(
          yield* Layer.build(
            Config.layer(workspaceID).pipe(
              Layer.provide(
                Layer.mergeAll(
                  databaseService,
                  Layer.succeed(Bus.Service, bus),
                  Installation.layer.pipe(Layer.provide(databaseService)),
                ),
              ),
            ),
          ),
          Config.Service,
        )
        const actor = system(workspaceID)
        const custom = Model.Custom.make({
          provider: Provider.Bymorning,
          id: "custom",
          name: "Custom",
          apiID: "upstream-v1",
          cost: { input: 2 },
          limit: { context: 1000 },
        })
        const identity = { provider: custom.provider, id: custom.id }
        expect((yield* config.model.put(custom, actor)).models).toEqual([custom])
        // Put replaces by identity rather than appending.
        const renamed = { ...custom, name: "Renamed", apiID: "upstream-v2" }
        expect((yield* config.model.put(renamed, actor)).models).toEqual([renamed])
        yield* config.modelPolicy.toggle({ ...identity, enabled: false }, actor)
        yield* config.modelPolicy.setDefault(identity, actor)
        // A whole-document update cannot drop or rewrite server-owned custom Models.
        expect((yield* config.update({ default_agent: "build", models: [] }, actor)).models).toEqual([renamed])
        const removed = yield* config.model.remove(identity, actor)
        expect(removed.models).toEqual([])
        expect(removed.default_model).toBeUndefined()
        expect(removed.model_policy.disabled).toEqual([])
        expect(removed.model_policy.seen).toEqual([])
        expect((yield* config.refresh).models).toEqual([])
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("ConfigCustomTest.cleanup", (db) =>
              db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).pipe(Effect.orDie),
            ),
          ),
        ),
      ),
    ).pipe(Effect.provide(database)),
  )
})

function makeBusLayer() {
  return Layer.effect(
    Bus.Service,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<Event.Payload>()
      return Bus.Service.of({
        publish: ((definition: Event.Definition, data: unknown) =>
          Effect.gen(function* () {
            const event = {
              id: Event.ID.make(crypto.randomUUID()),
              created: Date.now(),
              type: definition.type,
              data,
            } as Event.Payload<typeof definition>
            yield* PubSub.publish(events, event)
            return event
          })) as Bus.Interface["publish"],
        subscribe: (() => PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription))) as Bus.Subscribe,
      })
    }),
  )
}
