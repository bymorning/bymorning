import { Database, ProjectPurgeTable } from "@bymorning/core/database"
import { Project } from "@bymorning/core/project"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Storage } from "@bymorning/core/storage"
import { AccountActor } from "@bymorning/schema/actor"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Project as ProjectSchema } from "@bymorning/schema/project"
import { Effect, Layer, Stream } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

/** A Project with one real file and no Session (session rows restrict project deletion). */
const seed = Effect.fn("PurgeTest.seed")(function* (app: TestApp.Interface, content: string) {
  const owner = yield* app.login()
  const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
  const project = yield* app.workspace(
    { account },
    Effect.gen(function* () {
      const projects = yield* Project.Service
      return yield* projects.create({ name: "Purge fixture" })
    }),
  )
  const storage = yield* app.process(Storage.Service)
  const file = yield* ProjectDirectory.parse("notes.txt")
  yield* app.workspace(
    { account },
    ProjectDirectory.Service.use((directory) =>
      directory.write(file, {
        content: Stream.succeed(new TextEncoder().encode(content)),
        contentType: "text/plain",
      }),
    ).pipe(
      Effect.provide(
        ProjectDirectory.layer(owner.properties.workspaceID, project.id).pipe(
          Layer.provide(Layer.succeed(Storage.Service, storage)),
        ),
      ),
    ),
  )
  return { owner, account, project }
})

const objects = (app: TestApp.Interface, workspaceID: Workspace.ID, projectID: ProjectSchema.ID) =>
  app.process(Storage.Service.use(({ object }) => object.list([{ workspaces: workspaceID }, { projects: projectID }])))

const intents = (app: TestApp.Interface) =>
  app.process(
    Database.Service.use((database) =>
      database.use("ProjectPurge.intents", (db) => db.select().from(ProjectPurgeTable)),
    ),
  )

test("[SEC-PURGE-01] deleting a Project removes its storage objects through the purge outbox", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* seed(app, "purge me")
        const workspaceID = data.owner.properties.workspaceID

        const before = yield* objects(app, workspaceID, data.project.id)
        expect(before.length).toBeGreaterThan(0)

        yield* app.workspace(
          { account: data.account },
          Project.Service.use((projects) => projects.delete(data.project.id)),
        )

        // The delete commits the intent; the objects remain until a drain runs.
        const pending = yield* intents(app)
        expect(pending).toHaveLength(1)
        expect(pending[0]).toMatchObject({ workspaceID, projectID: data.project.id })
        expect(pending[0]?.prefix).toContain(`workspaces/${workspaceID}/projects/${data.project.id}/`)
        expect((yield* objects(app, workspaceID, data.project.id)).length).toBe(before.length)

        // The drain (run at boot and on the host interval) purges the prefix.
        yield* app.process(Project.drainPurge)
        expect(yield* objects(app, workspaceID, data.project.id)).toEqual([])
        expect(yield* intents(app)).toEqual([])

        // A second drain is a no-op.
        yield* app.process(Project.drainPurge)
        expect(yield* intents(app)).toEqual([])
      }),
    ),
    { signal },
  )
})

test("[SEC-PURGE-02] an intent written before a crash is drained on boot", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* seed(app, "survives the crash")
        const workspaceID = data.owner.properties.workspaceID

        // Simulate a delete whose process died before any drain: the intent row
        // is durable while the objects are untouched.
        yield* app.process(
          Database.Service.use((database) =>
            database.use("ProjectPurge.crash", (db) =>
              db.insert(ProjectPurgeTable).values({
                id: "purge_test_crash",
                workspaceID,
                projectID: data.project.id,
                prefix: `workspaces/${workspaceID}/projects/${data.project.id}/`,
              }),
            ),
          ),
        )
        expect((yield* objects(app, workspaceID, data.project.id)).length).toBeGreaterThan(0)

        // The next boot's drain (the same effect the boot node runs) completes it.
        yield* app.process(Project.drainPurge)
        expect(yield* objects(app, workspaceID, data.project.id)).toEqual([])
        expect(yield* intents(app)).toEqual([])
      }),
    ),
    { signal },
  )
})

test("[SEC-PURGE-03] a failed purge keeps the intent and the objects for the next pass", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(join(tmpdir(), "bymorning-purge-storage-"))),
          (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
        )
        let failRemoves = true
        const filesystem = Storage.filesystem({ directory })
        const flaky: Storage.Provider = {
          id: Storage.ID.make("flaky"),
          name: "Flaky",
          open: Effect.map(filesystem.open, (driver) => ({
            ...driver,
            remove: (path: Storage.Path) =>
              failRemoves
                ? new Storage.OperationError({
                    message: "injected purge failure",
                    providerID: flaky.id,
                    operation: "remove",
                    cause: "fixture",
                  })
                : driver.remove(path),
          })),
        }
        const app = yield* TestApp.make({
          storage: {
            configure: (draft) => {
              draft.add(flaky)
              draft.default.set(flaky.id)
            },
          },
        })
        const data = yield* seed(app, "retry me")
        const workspaceID = data.owner.properties.workspaceID
        yield* app.workspace(
          { account: data.account },
          Project.Service.use((projects) => projects.delete(data.project.id)),
        )

        // The failing pass logs and retains the intent with its objects.
        yield* app.process(Project.drainPurge)
        expect(yield* intents(app)).toHaveLength(1)
        expect((yield* objects(app, workspaceID, data.project.id)).length).toBeGreaterThan(0)

        // The next pass completes the purge.
        failRemoves = false
        yield* app.process(Project.drainPurge)
        expect(yield* objects(app, workspaceID, data.project.id)).toEqual([])
        expect(yield* intents(app)).toEqual([])
      }),
    ),
    { signal },
  )
})
