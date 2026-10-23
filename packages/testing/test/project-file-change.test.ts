import { Session } from "@bymorning/core/session"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Fiber, Option, Stream } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { ProjectFile } from "../src/scenario/project-file.js"

const workspaceEvents = (app: TestApp.Interface, workspace: Workspace.ID) =>
  Stream.fromAsyncIterable(
    app.client.event.subscribe({ workspace }),
    (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
  )

test("a Tool write publishes project.file.changed on the live Workspace Event stream", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const write = { path: "reports/summary.md", content: "# Summary\n\nWritten by the model." }
        const script = yield* ProjectFile.script(app, data, [write])
        const workspace = data.owner.properties.workspaceID

        // Subscribe before prompting: the live feed has no replay.
        const changed = yield* workspaceEvents(app, workspace).pipe(
          Stream.filter((event) => event.type === "project.file.changed"),
          Stream.take(1),
          Stream.runHead,
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
        yield* app.llm.waitGate(script.gate)

        const event = Option.getOrThrow(yield* Fiber.join(changed))
        expect(event).toMatchObject({
          type: "project.file.changed",
          data: { projectID: data.project.id, path: write.path },
        })
        const persisted = yield* Effect.tryPromise(() =>
          app.client.project.directory.read({ workspace, projectID: data.project.id, path: write.path }),
        )
        expect(new TextDecoder().decode(persisted)).toBe(write.content)

        yield* app.llm.release(script.gate)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
}, 60_000)

/** The SDK call's typed failure, as the generated client surfaces it. */
const refusal = (operation: () => Promise<unknown>) =>
  Effect.tryPromise(operation).pipe(
    Effect.flip,
    Effect.map((error) => error.cause ?? error),
  )

test("SDK move and delete change Project files, publish every affected path, and record attributed Audit Entries", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        const projectID = data.project.id
        const directory = app.client.project.directory
        yield* ProjectFile.seed(app, data, [
          { path: "docs/a.md", content: "alpha" },
          { path: "docs/nested/b.md", content: "beta" },
          { path: "keep.md", content: "keep" },
        ])
        const paths = () =>
          Effect.tryPromise(() => directory.list({ workspace, projectID })).pipe(Effect.map((list) => list.paths))

        // Subscribe before acting: the live feed has no replay. A folder rename is one move per file
        // (two paths each) and a delete is one path; refusals publish nothing.
        const changed = yield* workspaceEvents(app, workspace).pipe(
          Stream.filter((event) => event.type === "project.file.changed"),
          Stream.take(5),
          Stream.runCollect,
          Effect.forkScoped({ startImmediately: true }),
        )

        expect(
          yield* refusal(() => directory.move({ workspace, projectID, from: "docs/a.md", to: "keep.md" })),
        ).toMatchObject({ _tag: "ProjectFile.ConflictError", path: "keep.md" })
        expect(yield* refusal(() => directory.delete({ workspace, projectID, path: "missing.md" }))).toMatchObject({
          _tag: "ProjectFile.NotFoundError",
          path: "missing.md",
        })

        for (const from of ["docs/a.md", "docs/nested/b.md"])
          yield* Effect.tryPromise(() =>
            directory.move({ workspace, projectID, from, to: from.replace(/^docs\//, "guides/") }),
          )
        yield* Effect.tryPromise(() => directory.delete({ workspace, projectID, path: "keep.md" }))

        const events = yield* Fiber.join(changed)
        expect(events.map((event) => event.type === "project.file.changed" && event.data)).toEqual([
          { projectID, path: "guides/a.md" },
          { projectID, path: "docs/a.md" },
          { projectID, path: "guides/nested/b.md" },
          { projectID, path: "docs/nested/b.md" },
          { projectID, path: "keep.md" },
        ])
        expect(yield* paths()).toEqual(["guides/a.md", "guides/nested/b.md", data.path])
        const moved = yield* Effect.tryPromise(() =>
          directory.read({ workspace, projectID, path: "guides/nested/b.md" }),
        )
        expect(new TextDecoder().decode(moved)).toBe("beta")

        const moves = yield* Effect.tryPromise(() => app.client["api.audit"].list({ action: "file.move", limit: 10 }))
        expect(moves.data.map((entry) => entry.detail).toReversed()).toEqual([
          { from: "docs/a.md", to: "guides/a.md" },
          { from: "docs/nested/b.md", to: "guides/nested/b.md" },
        ])
        const deletes = yield* Effect.tryPromise(() =>
          app.client["api.audit"].list({ action: "file.delete", limit: 10 }),
        )
        expect(deletes.data).toEqual([
          expect.objectContaining({
            actor: expect.objectContaining({ type: "user", userID: data.owner.properties.userID }),
            workspaceID: workspace,
            target: `${projectID}:keep.md`,
            detail: { path: "keep.md" },
            outcome: "success",
          }),
        ])
      }),
    ),
    { signal },
  )
}, 60_000)
