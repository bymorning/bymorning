import { Database, SkillTable, WorkspaceTable } from "@bymorning/core/database"
import { Bus } from "@bymorning/core/bus"
import { Skill } from "@bymorning/core/skill"
import * as SkillSchema from "@bymorning/schema/skill"
import * as Workspace from "@bymorning/schema/workspace"
import { inArray } from "drizzle-orm"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Effect, Layer } from "effect"
import { expect, test } from "vitest"
import { database as databaseLayer } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const clean = (workspaceIDs: readonly Workspace.ID[]) =>
  Database.Service.use((database) =>
    database.use("SkillTest.cleanup", (db) =>
      db.delete(WorkspaceTable).where(inArray(WorkspaceTable.id, workspaceIDs)).pipe(Effect.orDie),
    ),
  )

const awaitSkill = Effect.fn("SkillTest.await")(function* (skills: Skill.Interface, id: SkillSchema.ID) {
  while (true) {
    const skill = yield* skills.get(id).pipe(Effect.option)
    if (skill._tag === "Some") return skill.value
    yield* Effect.yieldNow
  }
})

test("Skill provides Workspace-isolated full-replacement CRUD in stable order", async () => {
  const firstWorkspaceID = Workspace.ID.create()
  const secondWorkspaceID = Workspace.ID.create()
  const firstLayer = Skill.layer(firstWorkspaceID).pipe(
    Layer.provide(
      Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie),
    ),
    Layer.provide(databaseLayer),
  )
  const secondLayer = Skill.layer(secondWorkspaceID).pipe(
    Layer.provide(
      Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie),
    ),
    Layer.provide(databaseLayer),
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("SkillTest.setup", (db) =>
        db.insert(WorkspaceTable).values([
          { id: firstWorkspaceID, name: "Skill first", status: "active" },
          { id: secondWorkspaceID, name: "Skill second", status: "active" },
        ]),
      )

      const first = yield* Effect.gen(function* () {
        const skills = yield* Skill.Service
        const list = skills.list
        const created = yield* skills.create({
          name: "Review",
          description: "Reviews changes",
          instructions: "Inspect carefully",
        })
        const duplicate = yield* skills.create({
          name: "Review",
          description: "Reviews another way",
          instructions: "Inspect independently",
        })

        expect(created.id).not.toBe(duplicate.id)
        expect(yield* list).toEqual([created, duplicate])
        expect(yield* skills.get(created.id)).toEqual(created)

        const updated = yield* skills.update({
          id: created.id,
          name: "Audit",
          description: "Audits changes",
          instructions: "Replace every field",
        })
        expect(updated).toEqual({
          id: created.id,
          name: "Audit",
          description: "Audits changes",
          instructions: "Replace every field",
        })
        expect(yield* list).toEqual([updated, duplicate])
        return { updated, duplicate }
      }).pipe(Effect.provide(firstLayer))

      yield* Effect.gen(function* () {
        const skills = yield* Skill.Service
        expect(yield* skills.list).toEqual([])

        expect(yield* Effect.flip(skills.get(first.updated.id))).toBeInstanceOf(Skill.NotFoundError)

        expect(yield* Effect.flip(skills.update(first.updated))).toBeInstanceOf(Skill.NotFoundError)

        expect(yield* Effect.flip(skills.delete(first.updated.id))).toBeInstanceOf(Skill.NotFoundError)
      }).pipe(Effect.provide(secondLayer))

      yield* Effect.gen(function* () {
        const skills = yield* Skill.Service
        yield* skills.delete(first.updated.id)
        expect(yield* skills.list).toEqual([first.duplicate])

        const missingID = SkillSchema.ID.create()
        expect(yield* Effect.flip(skills.delete(missingID))).toEqual(new Skill.NotFoundError({ skillID: missingID }))
      }).pipe(Effect.provide(firstLayer))
    }).pipe(Effect.ensuring(clean([firstWorkspaceID, secondWorkspaceID])), Effect.provide(databaseLayer)),
  )
})

test("Skill merges immutable plugin Skills with persisted records while mutations remain persisted", async () => {
  const workspaceID = Workspace.ID.create()
  const shadowedID = SkillSchema.ID.make("skl_00000000000000000000000001")
  const pluginOnlyID = SkillSchema.ID.make("skl_00000000000000000000000002")
  const persistedOnlyID = SkillSchema.ID.make("skl_00000000000000000000000003")
  const pluginShadow = { id: shadowedID, name: "Plugin shadow", description: "plugin", instructions: "plugin" }
  const pluginOnly = { id: pluginOnlyID, name: "Plugin only", description: "plugin", instructions: "plugin" }

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("SkillPluginTest.setup", (db) =>
        db.insert(WorkspaceTable).values({ id: workspaceID, name: "Plugin Skills", status: "active" }),
      )
      yield* database.use("SkillPluginTest.persist", (db) =>
        db.insert(SkillTable).values([
          {
            workspaceID,
            id: shadowedID,
            name: "Persisted shadow",
            description: "persisted",
            instructions: "persisted",
          },
          {
            workspaceID,
            id: persistedOnlyID,
            name: "Persisted only",
            description: "persisted",
            instructions: "persisted",
          },
        ]),
      )

      const skillLayer = Skill.layer(workspaceID).pipe(
        Layer.provide(
          Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie),
        ),
        Layer.provide(Layer.succeed(Database.Service, database)),
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const skills = yield* Skill.Service
          const registration = yield* skills.transform((editor) => {
            editor.add(pluginOnly)
            editor.add(pluginShadow)
          })
          expect((yield* skills.list).map((skill) => skill.id)).toEqual([shadowedID, persistedOnlyID, pluginOnlyID])
          expect(yield* skills.get(shadowedID)).toEqual(pluginShadow)
          expect(yield* Effect.flip(skills.delete(pluginOnlyID))).toEqual(
            new Skill.NotFoundError({ skillID: pluginOnlyID }),
          )

          const persistedUpdate = {
            id: shadowedID,
            name: "Updated persisted shadow",
            description: "updated",
            instructions: "updated",
          }
          expect(yield* skills.update(persistedUpdate)).toEqual(persistedUpdate)
          expect(yield* skills.get(shadowedID)).toEqual(pluginShadow)

          expect((yield* skills.list).map((skill) => skill.id)).toEqual([shadowedID, persistedOnlyID, pluginOnlyID])
          yield* registration.dispose
          expect((yield* skills.list).map((skill) => skill.id)).toEqual([shadowedID, persistedOnlyID])
          expect(yield* skills.get(shadowedID)).toEqual(persistedUpdate)
        }),
      ).pipe(Effect.provide(skillLayer))
    }).pipe(Effect.ensuring(clean([workspaceID])), Effect.provide(databaseLayer)),
  )
})

test("Skill layers sharing a Bus refresh through live notifications and preserve active transforms", async () => {
  const workspaceID = Workspace.ID.create()

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("SkillFollowerTest.setup", (db) =>
        db.insert(WorkspaceTable).values({ id: workspaceID, name: "Skill follower", status: "active" }),
      )
      const sharedBus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
      const busContext = yield* Layer.build(sharedBus)
      const bus = Layer.succeed(Bus.Service, Context.get(busContext, Bus.Service))
      const skillLayer = Skill.layer(workspaceID).pipe(Layer.provide(bus), Layer.provide(databaseLayer))
      const contextA = yield* Layer.build(skillLayer)
      const contextB = yield* Layer.build(skillLayer)
      const skillsA = Context.get(contextA, Skill.Service)
      const skillsB = Context.get(contextB, Skill.Service)
      const pluginID = SkillSchema.ID.create()
      const plugin = SkillSchema.Info.make({
        id: pluginID,
        name: "Plugin",
        description: "Plugin skill",
        instructions: "Remain transformed",
      })
      yield* skillsB.transform((editor) => editor.add(plugin))

      const created = yield* skillsA.create({
        name: "Persisted",
        description: "Durable skill",
        instructions: "Refresh followers",
      })
      expect(yield* awaitSkill(skillsB, created.id)).toEqual(created)
      expect(yield* skillsB.get(pluginID)).toEqual(plugin)

      const [fromA, fromB] = yield* Effect.all(
        [
          skillsA.create({ name: "From A", description: "Concurrent", instructions: "First" }),
          skillsB.create({ name: "From B", description: "Concurrent", instructions: "Second" }),
        ],
        { concurrency: "unbounded" },
      )
      yield* Effect.all([
        awaitSkill(skillsA, fromA.id),
        awaitSkill(skillsA, fromB.id),
        awaitSkill(skillsB, fromA.id),
        awaitSkill(skillsB, fromB.id),
      ])
      expect(yield* skillsB.get(pluginID)).toEqual(plugin)
    }).pipe(Effect.ensuring(clean([workspaceID])), Effect.provide(databaseLayer), Effect.scoped),
  )
})
