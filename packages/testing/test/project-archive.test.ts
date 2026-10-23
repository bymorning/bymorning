import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { ProjectArchive } from "../src/scenario/project-archive.js"
import { ScheduledTaskScenario } from "../src/scenario/scheduled-task.js"

test("an archived Project is hidden and read-only over the SDK until it is restored", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const sessionIDs = (archived?: boolean) =>
          Effect.tryPromise(() =>
            app.client.session.list({ parentID: null, limit: 100, ...(archived === undefined ? {} : { archived }) }),
          ).pipe(Effect.map((page) => page.data.map((session) => session.id)))
        const projectIDs = (archived?: boolean) =>
          Effect.tryPromise(() => app.client.project.list(archived === undefined ? {} : { archived })).pipe(
            Effect.map((projects) => projects.map((project) => project.id)),
          )
        expect(yield* sessionIDs(false)).toContain(data.session.id)

        const archived = yield* ProjectArchive.archive(app, data.project.id)
        expect(archived.id).toBe(data.project.id)
        expect(archived.archivedAt).toBeInstanceOf(Date)

        // Hidden from the default lists, listed as archived, and still addressable.
        expect(yield* projectIDs()).not.toContain(data.project.id)
        expect(yield* projectIDs(true)).toEqual([data.project.id])
        expect(
          (yield* Effect.tryPromise(() => app.client.project.get({ projectID: data.project.id }))).archivedAt,
        ).toEqual(archived.archivedAt)
        expect(yield* sessionIDs(false)).not.toContain(data.session.id)
        expect(yield* sessionIDs()).not.toContain(data.session.id)
        expect((yield* Effect.tryPromise(() => app.client.session.get({ sessionID: data.session.id }))).id).toBe(
          data.session.id,
        )

        // Read-only: Session creation, prompts, and new Scheduled Tasks are refused with the archived error.
        const refused = { _tag: "Project.ArchivedError", projectID: data.project.id }
        const created = yield* Effect.tryPromise(() => app.client.session.create({ projectID: data.project.id })).pipe(
          Effect.flip,
        )
        expect(created.cause).toMatchObject(refused)
        const prompted = yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Anything new?", resume: false }),
        ).pipe(Effect.flip)
        expect(prompted.cause).toMatchObject(refused)
        const scheduled = yield* ScheduledTaskScenario.create(app, data).pipe(Effect.flip)
        expect(scheduled.cause).toMatchObject(refused)
        expect(yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))).toMatchObject({
          data: [],
        })

        // The Default Project cannot be archived.
        const fallback = yield* ProjectArchive.defaultProject(app)
        const refusedDefault = yield* ProjectArchive.archive(app, fallback.id).pipe(Effect.flip)
        expect(refusedDefault.cause).toMatchObject({ _tag: "Project.DefaultError", projectID: fallback.id })
        expect(yield* projectIDs()).toContain(fallback.id)

        // Restoring returns the Project and its Sessions to how they were.
        const restored = yield* ProjectArchive.restore(app, data.project.id)
        expect(restored.archivedAt).toBeUndefined()
        expect(restored.name).toBe(data.project.name)
        expect(yield* projectIDs()).toContain(data.project.id)
        expect(yield* projectIDs(true)).toEqual([])
        expect(yield* sessionIDs(false)).toContain(data.session.id)
        const admitted = yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Anything new?", resume: false }),
        )
        expect(admitted.text).toBe("Anything new?")
        expect((yield* ScheduledTaskScenario.create(app, data)).projectID).toBe(data.project.id)
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
}, 120_000)
