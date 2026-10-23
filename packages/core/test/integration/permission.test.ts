import * as Agent from "@bymorning/core/agent"
import { Bus } from "@bymorning/core/bus"
import * as Config from "@bymorning/core/config"
import * as Database from "@bymorning/core/database"
import * as Permission from "@bymorning/core/permission"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Model as ModelService } from "@bymorning/core/model"
import { Catalog } from "@bymorning/core/catalog"
import { offlineIntegration } from "../fixtures/offline-integration.js"
import { Provider as ProviderService } from "@bymorning/core/provider"
import * as AgentSchema from "@bymorning/schema/agent"
import * as ConfigSchema from "@bymorning/schema/config"
import * as Model from "@bymorning/schema/model"
import * as PermissionSchema from "@bymorning/schema/permission"
import * as Provider from "@bymorning/schema/provider"
import * as Project from "@bymorning/schema/project"
import * as Session from "@bymorning/schema/session"
import { NodeCrypto } from "@effect/platform-node"
import { sql } from "drizzle-orm"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref, Schema, Scope, Stream } from "effect"
import { describe, expect, test } from "vitest"
import { workspaceFixture } from "./workspace-fixture.js"
import { configService, minimalConfig } from "../service-fixtures.js"
import { layer as sessionPermissionLayer } from "../../src/session/permission.js"
import { database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const { workspaceID, userID } = workspaceFixture()
const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
const agent = Agent.layer(workspaceID).pipe(
  Layer.provide(Catalog.layer.pipe(Layer.provide(offlineIntegration))),
  Layer.provide(
    Layer.mergeAll(
      database,
      bus,
      ModelService.layer,
      ProviderService.layer,
      Layer.succeed(Config.Service, configService(minimalConfig)),
    ),
  ),
)
const model = Model.Ref.make({ provider: Provider.OpenAI, id: "gpt-5.6" })

const setup = Effect.fn("PermissionTest.setup")(function* (rules: PermissionSchema.Ruleset) {
  const database = yield* Database.Service
  const agents = yield* Agent.Service
  const suffix = crypto.randomUUID()
  const agent = AgentSchema.ID.make(`permission-${suffix}`)
  const sessionID = Session.ID.make(crypto.randomUUID())
  yield* agents.create(
    AgentSchema.Info.make({
      id: agent,
      name: AgentSchema.Name.make(agent),
      instructions: "",
      model,
      mode: "primary",
      hidden: false,
      steps: null,
      permissions: rules,
    }),
  )
  yield* database.use("PermissionTest.setup", (db) =>
    db.execute(
      sql`insert into session (id, workspace_id, user_id, project_id, agent, model)
        select ${sessionID}, ${workspaceID}, ${userID}, id, ${agent}, ${JSON.stringify(model)}::jsonb
        from project where workspace_id = ${workspaceID} order by id limit 1`,
    ),
  )
  return { sessionID, agent }
})

type TestOptions = Omit<Permission.LayerOptions, "configured"> & {
  readonly configure?: (configured: Permission.LayerOptions["configured"]) => Permission.LayerOptions["configured"]
}
const permissionWith = (options: TestOptions = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const agents = yield* Agent.Service
      const configured: Permission.LayerOptions["configured"] = Effect.fn("PermissionTest.configured")(
        function* (sessionID, agent) {
          const result = yield* database
            .use("PermissionTest.configured", (db) =>
              db.execute(sql`select agent from session where id = ${sessionID}`),
            )
            .pipe(Effect.orDie)
          const session = (yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ agent: AgentSchema.ID })))(
            "rows" in result ? result.rows : result,
          ).pipe(Effect.orDie))[0]
          if (session === undefined) return yield* new Session.NotFoundError({ sessionID })
          const selected = yield* agents.get(agent ?? session.agent)
          return selected?.permissions ?? ([{ action: "*", resource: "*", effect: "deny" }] as const)
        },
      )
      const { configure, ...layerOptions } = options
      return Permission.layerWith(workspaceID, {
        ...layerOptions,
        configured: configure?.(configured) ?? configured,
      })
    }),
  )
const layer = (options: TestOptions = {}) =>
  permissionWith(options).pipe(Layer.provideMerge(Layer.mergeAll(database, agent)))
const providePermission = (options: TestOptions = {}) => Effect.provide(layer(options))

const workspaceConfig = (rules: PermissionSchema.Ruleset) => {
  const value = Schema.decodeUnknownSync(ConfigSchema.Info)({ permissions: rules })
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.succeed(value),
      update: () => Effect.die("unused"),
      refresh: Effect.succeed(value),
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        initialize: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.succeed([{ type: "document", info: value }]),
      changes: () => Stream.never,
    }),
  )
}

const asking = [{ action: "read", resource: "*", effect: "ask" }] as const

describe("Permission deterministic state machine", () => {
  test("Session policy applies Workspace rules after Agent rules and the missing-Agent fallback", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const permissions = yield* Permission.Service
        const { sessionID } = yield* setup([{ action: "read", resource: "*", effect: "deny" }])
        const missingAgent = AgentSchema.ID.make(`missing-${crypto.randomUUID()}`)

        yield* permissions.assert({ sessionID, action: "read", resources: ["README.md"] })
        yield* permissions.assert({
          sessionID,
          agent: missingAgent,
          action: "read",
          resources: ["README.md"],
        })
        expect(
          (yield* permissions.ask({ sessionID, agent: missingAgent, action: "write", resources: ["README.md"] }))
            .effect,
        ).toBe("deny")
      }).pipe(
        Effect.provide(
          sessionPermissionLayer(workspaceID).pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                database,
                agent,
                bus,
                workspaceConfig([{ action: "read", resource: "*", effect: "allow" }]),
              ),
            ),
          ),
        ),
        Effect.scoped,
      ),
    )
  })

  test("applies General sensitive Project File asks with attribution and the ordered example exception", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* Queue.unbounded<PermissionSchema.Request>()
        const configuredAgents = yield* Ref.make<ReadonlyArray<AgentSchema.ID | undefined>>([])
        yield* Effect.gen(function* () {
          const permissions = yield* Permission.Service
          const { sessionID, agent } = yield* setup([
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          ])
          const projectID = Project.ID.make("prj_00000000000000sessiontools")
          const assertRead = (path: ProjectDirectory.Path) =>
            permissions.assert({
              sessionID,
              agent,
              action: "read",
              resources: [ProjectDirectory.resource(projectID, path)],
            })
          const allowed = yield* assertRead(ProjectDirectory.Path.make(".env")).pipe(Effect.forkChild)
          const allowRequest = yield* Queue.take(opened)
          expect(allowRequest).toMatchObject({
            sessionID,
            action: "read",
            resources: [ProjectDirectory.resource(projectID, ProjectDirectory.Path.make(".env"))],
          })
          expect(yield* Ref.get(configuredAgents)).toContain(agent)
          yield* permissions.reply({ sessionID, requestID: allowRequest.id, reply: "once" })
          yield* Fiber.join(allowed)

          const rejected = yield* assertRead(ProjectDirectory.Path.make("config/.env.local")).pipe(Effect.forkChild)
          const rejectRequest = yield* Queue.take(opened)
          yield* permissions.reply({ sessionID, requestID: rejectRequest.id, reply: "reject" })
          expect(yield* Fiber.join(rejected).pipe(Effect.flip)).toBeInstanceOf(Permission.RejectedError)

          yield* assertRead(ProjectDirectory.Path.make(".env.example"))
          expect(yield* Queue.size(opened)).toBe(0)
        }).pipe(
          providePermission({
            opened: (request) => Queue.offer(opened, request),
            configure: (configured) => (sessionID, agent) =>
              Ref.update(configuredAgents, (agents) => [...agents, agent]).pipe(
                Effect.andThen(configured(sessionID, agent)),
              ),
          }),
        )
      }).pipe(Effect.scoped),
    )
  })

  test("assert allows configured access and exposes configured blocks", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const permissions = yield* Permission.Service
        const allowed = yield* setup([{ action: "shell", resource: "*", effect: "allow" }])
        yield* permissions.assert({ sessionID: allowed.sessionID, action: "shell", resources: ["pwd"] })

        const conditional = yield* setup([
          { action: "shell", resource: "*", effect: "allow" },
          { action: "shell", resource: "rm *", effect: "deny" },
        ])
        const blocked = yield* permissions
          .assert({ sessionID: conditional.sessionID, action: "shell", resources: ["rm -rf build"] })
          .pipe(Effect.flip)
        expect(blocked).toBeInstanceOf(Permission.BlockedError)
        expect(blocked).toMatchObject({
          permission: "shell",
          resources: ["rm -rf build"],
          rules: [
            { action: "shell", resource: "*", effect: "allow" },
            { action: "shell", resource: "rm *", effect: "deny" },
          ],
        })
      }).pipe(providePermission(), Effect.scoped),
    )
  })

  test("assert surfaces user rejections with optional feedback", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* Queue.unbounded<PermissionSchema.Request>()
        yield* Effect.gen(function* () {
          const permissions = yield* Permission.Service
          const correctedSession = (yield* setup(asking)).sessionID
          const corrected = yield* permissions
            .assert({ sessionID: correctedSession, action: "read", resources: ["first"] })
            .pipe(Effect.forkChild)
          const correctedRequest = yield* Queue.take(opened)
          yield* permissions.reply({
            sessionID: correctedSession,
            requestID: correctedRequest.id,
            reply: "reject",
            message: "Use the cached result",
          })
          expect(yield* Fiber.join(corrected).pipe(Effect.flip)).toEqual(
            new Permission.RejectedError({ feedback: "Use the cached result" }),
          )

          const declinedSession = (yield* setup(asking)).sessionID
          const declined = yield* permissions
            .assert({ sessionID: declinedSession, action: "read", resources: ["second"] })
            .pipe(Effect.forkChild)
          const declinedRequest = yield* Queue.take(opened)
          yield* permissions.reply({ sessionID: declinedSession, requestID: declinedRequest.id, reply: "reject" })
          expect(yield* Fiber.join(declined).pipe(Effect.flip)).toEqual(new Permission.RejectedError({}))
        }).pipe(providePermission({ opened: (request) => Queue.offer(opened, request) }))
      }).pipe(Effect.scoped),
    )
  })

  test("opening is hidden, waits for publication, and publishes exactly once", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const published = yield* Deferred.make<void>()
        const count = yield* Ref.make(0)
        const options: TestOptions = {
          asked: () =>
            Ref.update(count, (n) => n + 1).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
          opened: () => Deferred.succeed(published, undefined),
        }
        yield* Effect.gen(function* () {
          const permissions = yield* Permission.Service
          const { sessionID } = yield* setup(asking)
          const id = PermissionSchema.ID.create()
          const fiber = yield* permissions
            .assert({
              id,
              sessionID,
              action: "read",
              resources: ["a"],
            })
            .pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          expect(yield* permissions.list).toEqual([])
          yield* Deferred.succeed(release, undefined)
          yield* Deferred.await(published)
          expect((yield* permissions.get({ sessionID, requestID: id })).id).toBe(id)
          expect(yield* Ref.get(count)).toBe(1)
          yield* permissions.reply({ sessionID, requestID: id, reply: "once" })
          yield* Fiber.join(fiber)
        }).pipe(providePermission(options))
      }).pipe(Effect.scoped),
    )
  })

  test("reply published immediately after asked waits for opened and settles exactly once", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>()
        const opening = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const events = yield* Ref.make<ReadonlyArray<string>>([])
        const options: TestOptions = {
          asked: () =>
            Ref.update(events, (current) => [...current, "asked"]).pipe(
              Effect.andThen(Deferred.succeed(asked, undefined)),
            ),
          opened: () => Deferred.succeed(opening, undefined).pipe(Effect.andThen(Deferred.await(release))),
          replied: () => Ref.update(events, (current) => [...current, "replied"]),
        }
        yield* Effect.gen(function* () {
          const permissions = yield* Permission.Service
          const { sessionID } = yield* setup(asking)
          const id = PermissionSchema.ID.create()
          const waiting = yield* permissions
            .assert({ id, sessionID, action: "read", resources: ["a"] })
            .pipe(Effect.forkChild)
          yield* Deferred.await(asked)
          yield* Deferred.await(opening)

          const replying = yield* permissions.reply({ sessionID, requestID: id, reply: "once" }).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          expect(replying.pollUnsafe()).toBeUndefined()
          expect(yield* permissions.list).toEqual([])
          expect(yield* Ref.get(events)).toEqual(["asked"])

          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(replying)
          expect(yield* Fiber.join(waiting)).toBeUndefined()
          expect(yield* Ref.get(events)).toEqual(["asked", "replied"])
          expect(yield* permissions.list).toEqual([])
          const missing = yield* permissions.reply({ sessionID, requestID: id, reply: "once" }).pipe(Effect.flip)
          expect(missing).toMatchObject({ _tag: "Permission.NotFoundError", requestID: id })
        }).pipe(providePermission(options))
      }).pipe(Effect.scoped),
    )
  })

  test("rejects a permanent reply without settling the once-only request", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* Deferred.make<PermissionSchema.Request>()
        yield* Effect.gen(function* () {
          const permissions = yield* Permission.Service
          const { sessionID } = yield* setup(asking)
          const waiting = yield* permissions
            .assert({ sessionID, action: "read", resources: ["once"] })
            .pipe(Effect.forkChild)
          const request = yield* Deferred.await(opened)
          const error = yield* permissions
            .reply({ sessionID, requestID: request.id, reply: "always" })
            .pipe(Effect.flip)
          expect(error).toBeInstanceOf(Permission.PermanentError)
          // `opened` runs while the entry is still hidden; `get` waits for publication.
          expect(yield* permissions.get({ sessionID, requestID: request.id })).toEqual(request)
          expect((yield* permissions.list).map(({ id }) => id)).toEqual([request.id])
          yield* permissions.reply({ sessionID, requestID: request.id, reply: "once" })
          expect(yield* Fiber.join(waiting)).toBeUndefined()
        }).pipe(providePermission({ opened: (request) => Deferred.succeed(opened, request) }))
      }).pipe(Effect.scoped),
    )
  })

})
