import { Storage } from "@bymorning/core/storage"
import { Session } from "@bymorning/core/session"
import { Effect, Exit, Scope } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestDatabase } from "../src/database.js"
import { Chat } from "../src/scenario/chat.js"
import { StorageScenario } from "../src/scenario/storage.js"

/** Filesystem storage at `directory`, optionally selected over a never-opened default. */
const filesystem = (directory: string, options: { readonly selected?: boolean } = {}): Storage.Options => {
  const provider = Storage.filesystem({ directory })
  const other = Storage.memory()
  return {
    configure: (editor) => {
      editor.add(provider)
      if (options.selected) editor.add(other)
      editor.default.set(options.selected ? other.id : provider.id)
    },
    ...(options.selected ? { selection: provider.id } : {}),
  }
}

test("selected filesystem stores Project files and ToolOutput through the real Application", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "bymorning-storage-test-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      // The explicit selection wins over the registered default, which never opens.
      const storage = filesystem(directory, { selected: true })
      const appScope = yield* Scope.fork(yield* Effect.scope)
      const app = yield* TestApp.make({ storage }).pipe(Scope.provide(appScope))
      const content = "selected filesystem\n".repeat(10_000)
      const data = yield* Chat.make(app, { content })
      const read = yield* Effect.tryPromise(() =>
        app.client.project.directory.read({
          projectID: data.project.id,
          path: data.path,
        }),
      )
      expect(new TextDecoder().decode(read)).toBe(data.content)
      const prompt = `Read ${data.path}`
      let outputID: string | undefined
      yield* app.llm.expect(data.session.id, "title", [
        {
          expect: (request) => expect(JSON.stringify(request.messages)).toContain(prompt),
          response: { type: "success", events: [{ text: "Stored Project file" }] },
        },
      ])
      yield* app.llm.expect(data.session.id, "assistant", [
        {
          expect: (request) => expect(request.tools?.some((tool) => tool.function.name === "read")).toBe(true),
          response: {
            type: "success",
            events: [{ tool: { id: "read-storage", name: "read", input: { path: data.path } } }],
          },
        },
        {
          expect: (request) => {
            const result = request.messages.find(
              (message) => message.role === "tool" && message.tool_call_id === "read-storage",
            )
            const text = JSON.stringify(result?.content)
            expect(text).toContain("selected filesystem")
            expect(text).toContain("full content saved as")
            outputID = text.match(/out_[A-Za-z0-9_-]+/)?.[0]
            expect(outputID).toBeDefined()
          },
          response: { type: "success", events: [{ text: "Read the persisted output." }] },
        },
      ])
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: prompt }))
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
      )
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
      const objects = yield* app.process(
        Storage.Service.use((storage) => storage.object.list(Storage.path("tool-output"))),
      )
      expect(objects.some((item) => outputID !== undefined && item.key.includes(outputID))).toBe(true)
      yield* Scope.close(appScope, Exit.void)
      const persisted = yield* Storage.Service.use((storage) => storage.object.list(Storage.path("tool-output"))).pipe(
        Effect.provide(Storage.layer(storage)),
      )
      expect(persisted.some((item) => outputID !== undefined && item.key.includes(outputID))).toBe(true)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("selected filesystem persists plugin writes through SDK configuration reload and Application disposal", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "bymorning-plugin-storage-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const storage = filesystem(directory)
      const appScope = yield* Scope.fork(yield* Effect.scope)
      const app = yield* TestApp.make({ storage, plugins: [StorageScenario.plugin] }).pipe(Scope.provide(appScope))
      const owner = yield* StorageScenario.reload(app)
      yield* Scope.close(appScope, Exit.void)
      const persisted = yield* Storage.Service.use((storage) =>
        storage
          .scope({
            workspaceID: owner.properties.workspaceID,
            pluginID: "test.storage",
          })
          .get("activation"),
      ).pipe(Effect.provide(Storage.layer(storage)))
      expect(persisted).toBe(2)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("selected filesystem initialization failure prevents Application acquisition and leaves its worker usable", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "bymorning-storage-failure-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const file = path.join(directory, "not-a-directory")
      yield* Effect.tryPromise(() => writeFile(file, "blocked"))
      const storage = filesystem(file)
      const database = yield* TestDatabase.shared
      const failure = yield* TestApp.make({ database, storage }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TestApp.SetupError)
      expect(failure).toMatchObject({
        stage: "application",
        cause: { _tag: "Storage.OperationError", providerID: "filesystem", operation: "init" },
      })
      const next = yield* TestApp.make({ database })
      yield* next.login()
      expect((yield* next.process(Storage.Service.use((storage) => storage.default()))).id).toBe("filesystem")
    }).pipe(Effect.scoped),
    { signal },
  )
})
