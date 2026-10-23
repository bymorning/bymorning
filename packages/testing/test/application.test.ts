import { ByMorning } from "@bymorning/client"
import { Database } from "@bymorning/core/database"
import { Session } from "@bymorning/core/session"
import { Storage } from "@bymorning/core/storage"
import { Bus } from "@bymorning/core/bus"
import { Plugin } from "@bymorning/core/plugin"
import { Tool } from "@bymorning/core/tool"
import { AccountActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { PgClient } from "@effect/sql-pg"
import { Deferred, Effect, Exit, Redacted, Scope } from "effect"
import { stat } from "node:fs/promises"
import { expect, test } from "vitest"
import { WorkspaceMap } from "../../../packages/server/src/workspace-map.js"
import { TestApp } from "../src/application.js"
import { TestDatabase } from "../src/database.js"
import { Chat } from "../src/scenario/chat.js"

test("real callback logins keep member cookie jars isolated", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const owner = yield* app.login()
        const repeatedOwner = yield* app.login()
        expect(repeatedOwner.properties.accountID).toBe(owner.properties.accountID)
        yield* Effect.tryPromise(() =>
          app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }),
        )
        const memberClient = app.clientFor()
        const member = yield* app.login(memberClient, {
          subject: Auth.Sub.make("test-member"),
          email: Auth.Email.make("member@bymorning.ai"),
        })
        expect(member.properties.accountID).not.toBe(owner.properties.accountID)
        expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(2)
        expect((yield* Effect.tryPromise(() => memberClient.user.list())).members).toHaveLength(2)
        yield* Effect.tryPromise(() => app.client.auth.logout())
        expect((yield* Effect.tryPromise(() => memberClient.user.list())).members).toHaveLength(2)
        const ownerDenied = yield* Effect.tryPromise(() => app.client.user.list()).pipe(Effect.flip)
        expect(ownerDenied).toBeDefined()
      }),
    ),
    { signal },
  )
})

test("one Application shares selected globals while retaining fresh member state and ready built-in Tools", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const owner = yield* app.login()
        yield* Effect.tryPromise(() =>
          app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }),
        )
        const memberClient = app.clientFor()
        const member = yield* app.login(memberClient, {
          subject: Auth.Sub.make("test-member"),
          email: Auth.Email.make("member@bymorning.ai"),
        })
        const memberServices = (accountID: typeof owner.properties.accountID) =>
          app.workspace(
            { account: new AccountActor({ type: "account", properties: { accountID } }) },
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              return {
                bus: yield* Bus.Service,
                tool: yield* Tool.Service,
                plugins: yield* plugin.list(),
                tools: yield* (yield* Tool.Service).snapshot(),
              }
            }),
          )
        const first = yield* memberServices(owner.properties.accountID)
        const second = yield* memberServices(member.properties.accountID)
        expect(first.bus).not.toBe(second.bus)
        expect(first.tool).not.toBe(second.tool)
        expect(first.plugins.some((plugin) => plugin.status === "active")).toBe(true)
        expect(first.tools.definitions.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["execute", "subagent"]),
        )
      }),
    ),
    { signal },
  )
})

test("two live Applications isolate the same local identity, files, Sessions and cookies across disposal", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* TestDatabase.shared
        const firstScope = yield* Scope.fork(yield* Effect.scope)
        const first = yield* TestApp.make({ database }).pipe(Scope.provide(firstScope))
        const second = yield* TestApp.make({ database })
        const left = yield* Chat.make(first, { path: "shared.txt", content: "First Application" })
        const right = yield* Chat.make(second, { path: "shared.txt", content: "Second Application" })
        expect(left.owner.properties.accountID).not.toBe(right.owner.properties.accountID)
        expect(left.owner.properties.workspaceID).not.toBe(right.owner.properties.workspaceID)
        expect(first.directory).not.toBe(second.directory)
        expect(first.origin.href).not.toBe(second.origin.href)
        expect(yield* first.process(Database.Service)).not.toBe(yield* second.process(Database.Service))
        expect(yield* first.process(Storage.Service)).not.toBe(yield* second.process(Storage.Service))
        expect(yield* first.process(WorkspaceMap.Service)).not.toBe(yield* second.process(WorkspaceMap.Service))
        const leftSession = yield* first.workspace({ account: left.account }, Session.Service)
        expect(leftSession).toBe(yield* first.workspace({ account: left.account }, Session.Service))
        expect(leftSession).not.toBe(yield* second.workspace({ account: right.account }, Session.Service))
        const leftProjects = yield* Effect.tryPromise(() => first.client.project.list())
        const rightProjects = yield* Effect.tryPromise(() => second.client.project.list())
        expect(leftProjects.map((project) => project.id)).toContain(left.project.id)
        expect(rightProjects.map((project) => project.id)).toContain(right.project.id)
        expect(leftProjects.some((project) => rightProjects.some((other) => other.id === project.id))).toBe(false)
        expect(
          new TextDecoder().decode(
            yield* Effect.tryPromise(() =>
              first.client.project.directory.read({ projectID: left.project.id, path: left.path }),
            ),
          ),
        ).toBe(left.content)
        expect(
          new TextDecoder().decode(
            yield* Effect.tryPromise(() =>
              second.client.project.directory.read({ projectID: right.project.id, path: right.path }),
            ),
          ),
        ).toBe(right.content)
        const missing = yield* Effect.tryPromise(() => second.client.session.get({ sessionID: left.session.id })).pipe(
          Effect.flip,
        )
        expect(missing.cause).toMatchObject({ _tag: "Session.NotFoundError" })

        // Copy a real callback cookie to prove credentials cannot transfer between
        // fixtures; logging out below also checks independent SDK cookie jars.
        const cookie = yield* Effect.tryPromise(async () => {
          const start = await fetch(new URL("/auth/login", first.origin), { redirect: "manual" })
          const location = start.headers.get("location")
          const attempt = start.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith("bm_local_attempt="))
            ?.split(";")[0]
          if (location === null || attempt === undefined) throw new Error("Missing first Application login attempt")
          const callback = new URL(location)
          const response = await fetch(new URL(callback.pathname + callback.search, first.origin), {
            redirect: "manual",
            headers: { cookie: attempt },
          })
          const cookie = response.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith("bm_local_auth="))
            ?.split(";")[0]
          if (cookie === undefined) throw new Error("Missing first Application auth cookie")
          return cookie
        })
        const foreign = ByMorning.make({ baseUrl: second.origin.href, headers: { cookie } })
        const denied = yield* Effect.tryPromise(() => foreign.workspace.list()).pipe(Effect.flip)
        expect(denied.cause).toMatchObject({ _tag: "UnauthorizedError" })
        yield* Effect.tryPromise(() => first.client.auth.logout())
        expect(
          yield* Effect.tryPromise(() => second.client.session.get({ sessionID: right.session.id })),
        ).toMatchObject({ id: right.session.id })

        yield* Scope.close(firstScope, Exit.void)
        const removed = yield* Effect.tryPromise(() => stat(first.directory)).pipe(Effect.flip)
        expect(removed.cause).toMatchObject({ code: "ENOENT" })
        expect((yield* Effect.tryPromise(() => fetch(first.origin)).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* Effect.tryPromise(() => fetch(first.llm.url)).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* Effect.tryPromise(() => stat(second.directory))).isDirectory()).toBe(true)
        const updated = yield* Effect.tryPromise(() =>
          second.client.project.update({ projectID: right.project.id, name: "Still running" }),
        )
        expect(updated.name).toBe("Still running")
        expect(
          new TextDecoder().decode(
            yield* Effect.tryPromise(() =>
              second.client.project.directory.read({ projectID: right.project.id, path: right.path }),
            ),
          ),
        ).toBe(right.content)
      }),
    ),
    { signal },
  )
})

test("a failing test body releases its Application resources while the worker remains usable", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* TestDatabase.shared
        const acquired = yield* Deferred.make<TestApp.Interface>()
        const failure = yield* Effect.scoped(
          Effect.gen(function* () {
            const app = yield* TestApp.make({ database })
            yield* Deferred.succeed(acquired, app)
            yield* Chat.make(app)
            return yield* Effect.fail("intentional test failure")
          }),
        ).pipe(Effect.flip)
        expect(failure).toBe("intentional test failure")
        const disposed = yield* Deferred.await(acquired)
        const removed = yield* Effect.tryPromise(() => stat(disposed.directory)).pipe(Effect.flip)
        expect(removed.cause).toMatchObject({ code: "ENOENT" })
        expect((yield* Effect.tryPromise(() => fetch(disposed.origin)).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* Effect.tryPromise(() => fetch(disposed.llm.url)).pipe(Effect.result))._tag).toBe("Failure")
        const next = yield* TestApp.make({ database })
        const data = yield* Chat.make(next)
        expect(yield* Effect.tryPromise(() => next.client.session.get({ sessionID: data.session.id }))).toMatchObject({
          id: data.session.id,
        })
      }),
    ),
    { signal },
  )
})

test("failed real Application startup drops its database immediately without ending the worker scope", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* TestDatabase.shared
        const inspection = yield* database.create()
        const broken = yield* Deferred.make<Redacted.Redacted<string>>()
        const invalid: TestDatabase.Interface = {
          create: () =>
            Effect.gen(function* () {
              const url = yield* database.create()
              yield* Deferred.succeed(broken, url)
              // Corrupt a real migrated database so production recovery fails after
              // TestApp has acquired its files, model listener and Application runtime.
              yield* PgClient.PgClient.use((sql) =>
                sql.unsafe("ALTER TABLE session_inbox RENAME TO unavailable_inbox"),
              ).pipe(
                Effect.provide(PgClient.layer({ url, maxConnections: 1 })),
                Effect.mapError((cause) => new TestDatabase.SetupError({ stage: "database", cause })),
              )
              return url
            }),
        }
        const result = yield* TestApp.make({ database: invalid }).pipe(Effect.flip)
        expect(result).toBeInstanceOf(TestApp.SetupError)
        expect(result).toMatchObject({ stage: "application" })
        const url = yield* Deferred.await(broken)
        const names = yield* PgClient.PgClient.use((sql) =>
          sql.unsafe<{ datname: string }>("SELECT datname FROM pg_database"),
        ).pipe(Effect.provide(PgClient.layer({ url: inspection, maxConnections: 1 })))
        expect(names).not.toContainEqual({ datname: new URL(Redacted.value(url)).pathname.slice(1) })
        const recovered = yield* TestApp.make({ database })
        const data = yield* Chat.make(recovered)
        expect(yield* Effect.tryPromise(() => recovered.client.project.get({ projectID: data.project.id }))).toEqual(
          data.project,
        )
      }),
    ),
    { signal },
  )
})
