import { LayerNode } from "@bymorning/util/effect/layer-node"
import { offlineAccount } from "../fixtures/offline-account.js"
import { PgClient } from "@effect/sql-pg"
import { NodeCrypto } from "@effect/platform-node"
import { Credential as CredentialSchema } from "@bymorning/schema/credential"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { WebSearch as WebSearchSchema } from "@bymorning/schema/websearch"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import * as Event from "@bymorning/schema/event"
import { Workspace } from "@bymorning/schema/workspace"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { and, eq, sql } from "drizzle-orm"
import {
  Context,
  Crypto,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  PubSub,
  Redacted,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import { agentService, configService, minimalConfig } from "../service-fixtures.js"
import { Agent } from "../../src/agent.js"
import { Actor } from "../../src/actor.js"
import { CodeModeCatalog } from "../../src/codemode/catalog.js"
import { PluginHooks } from "../../src/plugin/hooks.js"
import * as Binding from "../../src/plugin/internal/tool/binding.js"
import { layer as storageLayer } from "../fixture/storage.js"
import { Bus } from "../../src/bus.js"
import { Config } from "../../src/config.js"
import { Credential } from "../../src/credential.js"
import { Cipher } from "../../src/cipher.js"
import { Database } from "../../src/database.js"
import { layer as cipherLayer } from "../fixtures/cipher.js"
import { Integration } from "../../src/integration.js"
import { IntegrationOAuthCallback } from "../../src/integration-oauth-callback.js"
import type { Implementation, MethodSelector } from "../../src/integration/definition.js"
import { Mcp } from "../../src/mcp.js"
import { Plugin } from "../../src/plugin.js"
import { PluginHost } from "../../src/plugin/host.js"
import { PluginInternal } from "../../src/plugin/internal.js"
import { PluginRuntime } from "../../src/plugin/runtime.js"
import { Policy } from "../../src/policy.js"
import { Tool } from "../../src/tool.js"
import { McpTool } from "../../src/tool/mcp.js"
import { ToolOutput } from "../../src/tool-output.js"
import { Project } from "../../src/project.js"
import { InstructionDiscovery } from "../../src/instruction-discovery.js"
import { Storage } from "../../src/storage.js"
import { ManagedPolicy } from "../../src/managed-policy.js"
import { WebSearchExa } from "../../src/plugin/internal/websearch/exa.js"
import { AppProcess } from "../../src/util/process.js"
import { WebSearch } from "../../src/websearch.js"
import { Skill } from "../../src/skill.js"
import { Form } from "../../src/form.js"
import { CodeInterpreter } from "../../src/code-interpreter.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const url = Redacted.make(process.env.DATABASE_URL)
const workspaceID = Workspace.ID.make("wrk_integration_test")
const otherWorkspaceID = Workspace.ID.make("wrk_integration_test_other")
const payload = (text: string) => JSON.stringify({ result: { content: [{ type: "text", text }] } })
const projects = Project.Service.of({
  create: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  list: () => Effect.succeed([]),
  update: () => Effect.die("unused"),
  delete: () => Effect.die("unused"),
})
const instructions = InstructionDiscovery.Service.of({
  project: true,
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
  list: () => Effect.succeed([]),
  load: () => Effect.succeed([]),
})
let layer: Layer.Layer<Integration.Service | WebSearch.Service>
let mcpIntegrationLayer: Layer.Layer<
  | Integration.Service
  | Credential.Service
  | Bus.Service
  | Tool.Service
  | Policy.Service
  | Storage.Service
  | Database.Service
  | Crypto.Crypto
  | Binding.Service
  | Skill.Service
  | Form.Service
  | CodeInterpreter.Service
  | WebSearch.Service
  | PluginHooks.Service
>
let databaseLayer: Layer.Layer<Database.Service, SqlError>
let persistenceLayer: Layer.Layer<Database.Service | Cipher.Service, SqlError>
let authorization: string | undefined
const managedPolicy = ManagedPolicy.Service.of({
  list: Effect.succeed([]),
  create: () => Effect.die("unused"),
  update: () => Effect.die("unused"),
  delete: () => Effect.die("unused"),
  setEnabled: () => Effect.die("unused"),
})

const busLayer = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<Event.Payload>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(events))
    const publish = ((definition: Event.Definition, data: unknown) =>
      Effect.gen(function* () {
        const event = {
          id: Event.ID.make(crypto.randomUUID()),
          created: Date.now(),
          type: definition.type,
          data,
        } as Event.Payload<typeof definition>
        yield* PubSub.publish(events, event)
        return event
      })) as Bus.Interface["publish"]
    return Bus.Service.of({
      publish,
      subscribe: ((input?: Event.Definition | readonly Event.Definition[]) => {
        const types =
          input === undefined
            ? undefined
            : new Set((Array.isArray(input) ? input : [input]).map((definition) => definition.type))
        return PubSub.subscribe(events).pipe(
          Effect.map((subscription) =>
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((event) => types === undefined || types.has(event.type)),
            ),
          ),
        )
      }) as Bus.Subscribe,
    })
  }),
)

beforeAll(async () => {
  await Effect.runPromise(
    PgClient.PgClient.use((sql) =>
      sql.unsafe(
        `INSERT INTO workspace (id, name, status) VALUES ('${workspaceID}', 'Integration', 'active'), ('${otherWorkspaceID}', 'Other integration', 'active');
       INSERT INTO account (id, status) VALUES ('acc_oauth_test', 'active');
       INSERT INTO "user" (id, workspace_id, account_id, role) VALUES ('usr_oauth_test', '${workspaceID}', 'acc_oauth_test', 'admin');
       `,
      ),
    ).pipe(Effect.provide(PgClient.layer({ url, maxConnections: 1 })), Effect.scoped),
  )
  databaseLayer = Database.layer.pipe(Layer.provide(PgClient.layer({ url })))
  persistenceLayer = Layer.mergeAll(databaseLayer, cipherLayer)
  const integration = Integration.layer.pipe(
    Layer.provide(Layer.mergeAll(Credential.layer(workspaceID), busLayer, LayerNode.compile(AppProcess.node))),
  )
  mcpIntegrationLayer = Layer.mergeAll(
    Integration.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Credential.layer({ workspaceID, userID: User.ID.make("usr_oauth_test") }),
          busLayer,
          LayerNode.compile(AppProcess.node),
        ),
      ),
    ),
    // Plugin activation drains admission through the same hook registry Tool uses.
    Tool.layer.pipe(Layer.provideMerge(PluginHooks.layer)),
    Policy.layer,
    storageLayer,
    NodeCrypto.layer,
    Layer.mock(Skill.Service, {}),
    Layer.mock(Form.Service, {}),
    Layer.mock(WebSearch.Service, {}),
    CodeInterpreter.unavailable,
    Layer.succeed(Binding.Service, {
      workspaceID,
      provide: () => Effect.die("Session builtins are not executed by the MCP integration fixture"),
    }),
  ).pipe(Layer.provideMerge(persistenceLayer), Layer.orDie)
  const http = HttpClient.make((request) => {
    authorization = new URL(request.url).searchParams.get("exaApiKey") ?? undefined
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(payload("Title: Result\nURL: https://example.com\nHighlights:\ndatabase-backed result")),
      ),
    )
  })
  const services = Layer.merge(
    integration,
    WebSearch.layer.pipe(
      Layer.provide(Layer.mergeAll(busLayer, Layer.succeed(Config.Service, configService(minimalConfig)))),
    ),
  )
  const integrationWithBuiltin = Layer.merge(
    services,
    Layer.effectDiscard(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const websearch = yield* WebSearch.Service
        yield* WebSearchExa.Plugin.effect({
          app: { name: "ByMorning", version: "test", channel: "test" },
          integration: {
            transform: (callback: Parameters<PluginContext["integration"]["transform"]>[0]) =>
              integrations.transform((editor) =>
                callback({
                  list: editor.list,
                  get: (id) => editor.get(Integration.ID.make(id)),
                  update: (id, update) => editor.update(Integration.ID.make(id), update),
                  remove: (id) => editor.remove(Integration.ID.make(id)),
                  method: {
                    list: (id) =>
                      editor.method.list(Integration.ID.make(id)).filter((method) => method.type !== "values").map((method) =>
                        method.type === "env-group"
                          ? {
                              id: method.id,
                              type: method.type,
                              authKind: method.authKind,
                              available: false,
                            }
                          : method,
                      ),
                    update: (input) =>
                      editor.method.update({
                        ...input,
                        integrationID: Integration.ID.make(input.integrationID),
                      } as unknown as Implementation),
                    remove: (id, method) =>
                      editor.method.remove(Integration.ID.make(id), method as unknown as MethodSelector),
                  },
                }),
              ),
            connection: {
              active: (id: string) => integrations.connection.active(Integration.ID.make(id)),
              resolve: integrations.connection.resolve,
            },
          },
          websearch: { transform: websearch.transform },
        } as unknown as PluginContext)
      }),
    ).pipe(Layer.provide(services), Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
  )
  layer = integrationWithBuiltin.pipe(Layer.provide(persistenceLayer), Layer.orDie)
}, 30_000)

describe("PostgreSQL Integration to OAuth-protected outbound MCP", () => {
  it("completes hosted DCR and PKCE OAuth before reconnecting an authenticated MCP client", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* oauthMcpServer()
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const bus = yield* Bus.Service
          const tools = yield* Tool.Service
          const changes = yield* PubSub.unbounded<void>()
          const config = Config.Service.of({
            provider: { update: () => Effect.die("unused") },
            model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
            get: Effect.succeed(
              yield* Schema.decodeUnknownEffect(ConfigSchema.Info)({
                mcp: { servers: { linear: { type: "remote", url: `${fixture.url}mcp` } } },
              }),
            ),
            update: () => Effect.die("unused"),
            refresh: Effect.die("unused"),
            mcp: {
              update: () => Effect.die("unused"),
              put: () => Effect.die("unused"),
              remove: () => Effect.die("unused"),
            },
            modelPolicy: {
              reconcile: () => Effect.die("unused"),
              initialize: () => Effect.die("unused"),
              toggle: () => Effect.die("unused"),
              setDefault: () => Effect.die("unused"),
            },
            plugin: Config.pluginUnavailable,
            entries: () => Effect.succeed([]),
            changes: () => Stream.fromPubSub(changes),
          })
          const callbackScope = yield* Scope.fork(yield* Scope.Scope)
          const callbacks = Context.get(
            yield* Layer.buildWithScope(IntegrationOAuthCallback.layer(new URL(fixture.url)), callbackScope),
            IntegrationOAuthCallback.Service,
          )
          const coordinator = yield* Mcp.make({ account: offlineAccount(),
            integration: integrations,
            credential: credentials,
            oauthCallback: callbacks,
            owner: { accountID: Account.ID.make("acc_oauth_test"), workspaceID, pluginID: "bymorning.config.mcp" },
            bus,
          })
          const services = {
            ...mcpHostServices(
              bus,
              integrations,
              tools,
              coordinator,
              yield* Storage.Service,
              yield* PluginHooks.Service,
            ),
            accountID: Account.ID.make("acc_oauth_test"),
            integrationOAuthCallback: callbacks,
          }
          const internal = yield* PluginInternal.list(Effect.succeed({ all: [], available: [] })).pipe(
            Effect.provideService(McpTool.Service, McpTool.Service.of({ flush: Effect.void, refresh: Effect.void })),
            Effect.provideService(Actor.Binding.Service, {
              workspaceID,
              accountID: Account.ID.make("acc_oauth_test"),
              userID: User.ID.make("usr_oauth_test"),
              role: "admin",
            }),
            Effect.provideService(Agent.Service, services.agent),
            Effect.provideService(ManagedPolicy.Service, managedPolicy),
            Effect.provideService(Config.Service, config),
            Effect.provideService(ToolOutput.Service, {
              truncate: (_sessionID, result) => Effect.succeed(result),
              read: () => Effect.fail(new ToolOutput.UnavailableError({})),
              readForTool: () => Effect.fail(new ToolOutput.UnavailableError({})),
            }),
            Effect.provideService(PluginRuntime.Service, services.runtime),
            Effect.provideService(Mcp.Service, coordinator),
            Effect.provideService(HttpClient.HttpClient, internalHttp),
            Effect.provideService(Bus.Service, bus),
            Effect.provideService(Project.Service, projects),
            Effect.provideService(InstructionDiscovery.Service, instructions),
            Effect.provideService(Storage.Service, services.storage),
          )
          const definition = internal.post.find((plugin) => plugin.id === "bymorning.config.mcp")
          if (definition === undefined) throw new Error("Outbound MCP config plugin is unavailable")
          const plugins = Context.get(
            yield* Layer.buildWithScope(
              Plugin.layer(services).pipe(Layer.provide(Layer.succeed(Bus.Service, bus))),
              yield* Scope.Scope,
            ),
            Plugin.Service,
          )
          yield* plugins.activate([{ ...definition, revision: "oauth-test" }])

          const needsAuth = (yield* coordinator.servers())[0]
          expect(needsAuth).toMatchObject({ name: "linear", status: "needs_auth" })
          if (needsAuth?.status !== "needs_auth") throw new Error("Linear fixture did not require OAuth")
          const integrationID = Integration.ID.make(needsAuth.integrationID)
          const attempt = yield* integrations.oauth.connect({
            integrationID,
            methodID: Integration.MethodID.make("oauth"),
          })
          const authorization = new URL(attempt.url)
          expect(authorization.searchParams.get("state")).toHaveLength(43)
          expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
          fixture.challenge = authorization.searchParams.get("code_challenge") ?? ""
          expect(yield* callbacks.deliver({ state: authorization.searchParams.get("state") ?? "", code: "code" })).toBe(
            true,
          )
          yield* waitUntil(
            integrations.oauth
              .status({ integrationID, attemptID: attempt.attemptID })
              .pipe(Effect.map((status) => status.status === "complete")),
          )
          yield* waitUntil(coordinator.servers().pipe(Effect.map((servers) => servers[0]?.status === "connected")))

          expect(fixture.registrations).toBe(1)
          expect(fixture.pkceVerified).toBe(true)
          expect(fixture.initializations).toBe(1)
          expect((yield* credentials.list(integrationID))[0]?.value).toMatchObject({
            type: "oauth",
            access: "access-2",
            refresh: "refresh-2",
          })

          const active = (yield* credentials.list(integrationID))[0]
          if (active?.value.type !== "oauth") throw new Error("OAuth credential was not stored")
          const alternate = yield* credentials.create({
            integrationID,
            label: "Alternate",
            scope: "member",
            value: active.value,
          })
          const beforeActivation = fixture.initializations
          const beforeActivationClose = fixture.terminations
          yield* integrations.connection.activate(active.id)
          yield* waitUntil(Effect.sync(() => fixture.initializations > beforeActivation))
          yield* waitUntil(Effect.sync(() => fixture.terminations > beforeActivationClose))
          const beforeRemoval = fixture.initializations
          const beforeRemovalClose = fixture.terminations
          yield* integrations.connection.remove(alternate.id)
          yield* waitUntil(Effect.sync(() => fixture.initializations > beforeRemoval))
          yield* waitUntil(Effect.sync(() => fixture.terminations > beforeRemovalClose))
          expect((yield* credentials.list(integrationID))[0]?.id).toBe(active.id)

          fixture.rejectRefresh = true
          yield* credentials.update(active.id, {
            value: CredentialSchema.OAuth.make({
              ...active.value,
              access: "expired-access",
              refresh: "invalid-refresh",
              expires: Date.now() - 1,
            }),
          })
          yield* coordinator.connect("linear")
          yield* waitUntil(coordinator.servers().pipe(Effect.map((servers) => servers[0]?.status === "needs_auth")))
          expect(yield* credentials.get(active.id)).toBeUndefined()
        }).pipe(Effect.provide(mcpIntegrationLayer)),
      ),
    )
  })
})

describe("PostgreSQL Integration to WebSearch", () => {
  it("guards durable OAuth writeback and invalidation with the exact token generation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const integrationID = Integration.ID.make("oauth-cas")
        const original = CredentialSchema.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "access-1",
          refresh: "refresh-1",
          expires: 0,
        })
        const created = yield* credentials.create({ integrationID, value: original })
        const rotated = CredentialSchema.OAuth.make({ ...original, access: "access-2", refresh: "refresh-2" })
        expect(yield* credentials.updateOAuth(created.id, original, rotated)).toBe(true)
        expect(yield* credentials.updateOAuth(created.id, original, { ...rotated, access: "stale" })).toBe(false)
        expect(yield* credentials.removeOAuth(created.id, original)).toBe(false)
        expect(yield* credentials.removeOAuth(created.id, rotated)).toBe(true)
        expect(yield* credentials.get(created.id)).toBeUndefined()
      }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
    )
  })

  it("does not recreate a credential removed during an in-flight refresh", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const original = CredentialSchema.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "access-1",
          refresh: "refresh-1",
          expires: 1,
        })
        const created = yield* credentials.create({
          integrationID: Integration.ID.make("oauth-removed-during-refresh"),
          value: original,
        })
        const entered = yield* Latch.make()
        const release = yield* Latch.make()
        const refresh = yield* credentials
          .refreshOAuth(created.id, Date.now(), () =>
            entered.open.pipe(
              Effect.andThen(release.await),
              Effect.as(CredentialSchema.OAuth.make({ ...original, access: "stale-access" })),
            ),
          )
          .pipe(Effect.forkChild)
        yield* entered.await
        yield* credentials.remove(created.id)
        yield* release.open
        expect(yield* Fiber.join(refresh)).toBeUndefined()
        expect(yield* credentials.get(created.id)).toBeUndefined()
      }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
    )
  })

  it("returns a competing OAuth rotation instead of an unstored refresh result", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const original = CredentialSchema.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "access-original",
          refresh: "refresh-original",
          expires: 1,
        })
        const created = yield* credentials.create({
          integrationID: Integration.ID.make("oauth-competing-rotation"),
          value: original,
        })
        const entered = yield* Latch.make()
        const release = yield* Latch.make()
        const stale = CredentialSchema.OAuth.make({ ...original, access: "access-stale", refresh: "refresh-stale" })
        const winner = CredentialSchema.OAuth.make({ ...original, access: "access-winner", refresh: "refresh-winner" })
        const refresh = yield* credentials
          .refreshOAuth(created.id, Date.now(), () =>
            entered.open.pipe(Effect.andThen(release.await), Effect.as(stale)),
          )
          .pipe(Effect.forkChild)
        yield* entered.await
        expect(yield* credentials.updateOAuth(created.id, original, winner)).toBe(true)
        yield* release.open
        expect(yield* Fiber.join(refresh)).toEqual(winner)
        expect((yield* credentials.get(created.id))?.value).toEqual(winner)
        yield* credentials.remove(created.id)
      }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
    )
  })

  describe("on an OAuth row whose digests an earlier boot cleared", () => {
    const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")
    const original = CredentialSchema.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make("oauth"),
      access: "damaged-access",
      refresh: "damaged-refresh",
      expires: 1,
    })
    const next = CredentialSchema.OAuth.make({ ...original, access: "repaired-access", refresh: "repaired-refresh" })
    // Create through the service, then apply the pre-1.2.1 migrator's damage: envelope value_json, null digests.
    const damagedRow = (integrationID: string) =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const database = yield* Database.Service
        const created = yield* credentials.create({
          integrationID: Integration.ID.make(integrationID),
          value: original,
        })
        yield* database.use("Credential.damage", (db) =>
          db
            .update(Database.CredentialTable)
            .set({ oauth_access_hash: null, oauth_refresh_hash: null })
            .where(eq(Database.CredentialTable.id, created.id)),
        )
        return created.id
      })
    const stored = (id: Credential.ID) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const rows = yield* database.use("Credential.damagedRow", (db) =>
          db
            .select({
              valueJson: Database.CredentialTable.valueJson,
              access: Database.CredentialTable.oauth_access_hash,
              refresh: Database.CredentialTable.oauth_refresh_hash,
            })
            .from(Database.CredentialTable)
            .where(eq(Database.CredentialTable.id, id)),
        )
        return rows[0]
      })
    const repaired = (id: Credential.ID) =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        expect((yield* credentials.get(id))?.value).toEqual(next)
        expect(yield* stored(id)).toMatchObject({ access: sha(next.access), refresh: sha(next.refresh) })
      })

    it("updateOAuth saves the next generation and its digests, and still refuses a mismatch", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const id = yield* damagedRow("oauth-damaged-update")
          const before = yield* stored(id)
          expect(yield* credentials.updateOAuth(id, { ...original, refresh: "other-refresh" }, next)).toBe(false)
          expect(yield* credentials.updateOAuth(id, { ...original, access: "other-access" }, next)).toBe(false)
          expect(yield* stored(id)).toEqual(before)
          expect((yield* credentials.get(id))?.value).toEqual(original)

          expect(yield* credentials.updateOAuth(id, original, next)).toBe(true)
          yield* repaired(id)
          yield* credentials.remove(id)
        }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
      )
    })

    it("refreshOAuth saves the refreshed token", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const id = yield* damagedRow("oauth-damaged-refresh")
          expect(yield* credentials.refreshOAuth(id, Date.now(), () => Effect.succeed(next))).toEqual(next)
          yield* repaired(id)
          yield* credentials.remove(id)
        }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
      )
    })

    it("removeOAuth deletes the matching generation and refuses a mismatch", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const id = yield* damagedRow("oauth-damaged-remove")
          const before = yield* stored(id)
          expect(yield* credentials.removeOAuth(id, { ...original, refresh: "other-refresh" })).toBe(false)
          expect(yield* stored(id)).toEqual(before)
          expect(yield* credentials.removeOAuth(id, original)).toBe(true)
          expect(yield* credentials.get(id)).toBeUndefined()
        }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
      )
    })
  })

  it("treats OAuth expiry zero as unknown or non-expiring", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const credentials = yield* Credential.Service
        const integrationID = Integration.ID.make("oauth-non-expiring")
        const refreshes = yield* Ref.make(0)
        yield* integrations.transform((editor) =>
          editor.method.update({
            integrationID,
            method: { id: Integration.MethodID.make("oauth"), type: "oauth", label: "OAuth" },
            authorize: () => Effect.die("unused"),
            refresh: (credential) => Ref.update(refreshes, (count) => count + 1).pipe(Effect.as(credential)),
          }),
        )
        const value = CredentialSchema.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "stable",
          refresh: "refresh",
          expires: 0,
        })
        const created = yield* credentials.create({ integrationID, value })
        expect(
          yield* integrations.connection.resolve({ type: "credential", id: created.id, label: created.label }),
        ).toEqual(value)
        expect(yield* Ref.get(refreshes)).toBe(0)
      }).pipe(Effect.provide(mcpIntegrationLayer), Effect.scoped),
    )
  })

  it("persists, activates, falls back, and applies a key to the provider request", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const webSearch = yield* WebSearch.Service
        const integrationID = Integration.ID.make("exa")

        yield* integrations.connection.key({ integrationID, key: "first secret", label: "Workspace key" })
        const first = yield* integrations.get(integrationID)
        const firstConnection = first?.connections[0]
        const staleID = firstConnection?.type === "credential" ? firstConnection.id : undefined

        yield* Effect.all(
          Array.from({ length: 12 }, (_, index) =>
            integrations.connection.key({ integrationID, key: `secret ${index}`, label: `key ${index}` }),
          ),
          { concurrency: "unbounded" },
        )
        if (staleID !== undefined) yield* integrations.connection.remove(staleID)

        const current = yield* integrations.get(integrationID)
        const database = yield* Database.Service
        const rows = yield* database.use("Credential.concurrentActive", (db) =>
          db
            .select({ id: Database.CredentialTable.id, active: Database.CredentialTable.active })
            .from(Database.CredentialTable)
            .where(
              and(
                eq(Database.CredentialTable.workspaceId, workspaceID),
                eq(Database.CredentialTable.integration_id, integrationID),
              ),
            ),
        )
        const active = yield* integrations.connection.active(integrationID)
        const resolved = active === undefined ? undefined : yield* integrations.connection.resolve(active)
        const searched = yield* webSearch.query({
          query: "effect",
          providerID: WebSearchSchema.ID.make("exa"),
        })
        const listed = yield* integrations.list()
        const currentConnection = current?.connections[0]
        if (currentConnection?.type === "credential") yield* integrations.connection.remove(currentConnection.id)
        const promoted = yield* integrations.connection.active(integrationID)
        const remaining = (yield* integrations.get(integrationID))?.connections.filter(
          (connection) => connection.type === "credential",
        )
        yield* Effect.forEach(remaining ?? [], (connection) => integrations.connection.remove(connection.id), {
          discard: true,
        })

        return {
          first,
          current,
          rows,
          resolved,
          searched,
          listed,
          promoted,
          removed: yield* integrations.connection.active(integrationID),
        }
      }).pipe(Effect.provide(Layer.merge(layer, databaseLayer))),
    )

    expect(result.first).toMatchObject({
      id: "exa",
      name: "Exa",
      methods: [{ type: "key" }, { type: "env", names: ["EXA_API_KEY"] }],
      connections: [{ label: "Workspace key" }],
    })
    expect(result.current?.connections).toHaveLength(12)
    expect(result.rows).toHaveLength(12)
    expect(result.rows.filter((row) => row.active)).toEqual([
      expect.objectContaining({
        id: result.current?.connections[0]?.type === "credential" ? result.current.connections[0].id : "",
      }),
    ])
    expect(result.resolved).toEqual(expect.objectContaining({ type: "key", key: expect.stringMatching(/^secret /) }))
    expect(result.searched.results).toEqual([
      {
        url: "https://example.com",
        title: "Result",
        content: "database-backed result",
        time: {},
      },
    ])
    expect(authorization).toMatch(/^secret /)
    expect(result.listed.map((info) => info.id)).toEqual(["exa"])
    expect(JSON.stringify(result.listed)).not.toContain('API_KEY":"')
    expect(result.promoted).toMatchObject({ type: "credential" })
    expect(result.removed).toBeUndefined()
  })

  it("reads the canonical value instead of the retained legacy key", async () => {
    const integrationID = Integration.ID.make("parallel")
    const id = CredentialSchema.ID.create()
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("Credential.legacyFixture", (db) =>
          db.insert(Database.CredentialTable).values({
            id,
            workspaceId: workspaceID,
            integration_id: integrationID,
            label: "Canonical",
            value: "stale legacy secret",
            valueJson: Credential.Key.make({ type: "key", key: "canonical secret" }),
          }),
        )
      }).pipe(Effect.provide(databaseLayer)),
    )
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        return yield* integrations.connection.resolve({ type: "credential", id, label: "Canonical" })
      }).pipe(Effect.provide(layer)),
    )
    expect(resolved).toEqual({ type: "key", key: "canonical secret" })
  })

  it("round-trips SigV4 JSONB and leaves its legacy value null", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const database = yield* Database.Service
        const created = yield* credentials.create({
          integrationID: Integration.ID.make("bedrock-jsonb"),
          label: "Temporary AWS credentials",
          value: Credential.AwsSigV4.make({
            type: "aws-sigv4",
            region: AwsRegion.make("us-east-1"),
            accessKeyId: "access-key-id",
            secretAccessKey: "secret-access-key",
            sessionToken: "session-token",
          }),
        })
        const row = yield* database.use("Credential.sigV4Jsonb", (db) =>
          db
            .select({ value: Database.CredentialTable.value, valueJson: Database.CredentialTable.valueJson })
            .from(Database.CredentialTable)
            .where(eq(Database.CredentialTable.id, created.id))
            .limit(1),
        )
        return { loaded: yield* credentials.get(created.id), row: row[0] }
      }).pipe(
        Effect.provide(Layer.merge(Credential.layer(workspaceID).pipe(Layer.provide(persistenceLayer)), databaseLayer)),
      ),
    )

    if (result.loaded === undefined) throw new Error("SigV4 credential did not round-trip")
    const loaded = result.loaded
    expect(loaded.value).toEqual({
      type: "aws-sigv4",
      region: "us-east-1",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      sessionToken: "session-token",
    })
    // At rest the secret material is a Cipher envelope, never the JSONB value.
    const stored = result.row
    expect(stored?.value).toBeNull()
    expect(typeof stored?.valueJson).toBe("string")
    expect(stored?.valueJson as string).not.toContain("secret-access-key")
    expect((stored?.valueJson as string).startsWith("v1.")).toBe(true)
    expect(
      await Effect.runPromise(
        Credential.Service.use((credentials) => credentials.get(loaded.id)).pipe(
          Effect.provide(Credential.layer(otherWorkspaceID).pipe(Layer.provide(persistenceLayer))),
        ),
      ),
    ).toBeUndefined()
  })

  it("dual-writes keys and leaves the legacy value null for OAuth", async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const database = yield* Database.Service
        const cipher = yield* Cipher.Service
        const key = yield* credentials.create({
          integrationID: Integration.ID.make("dual-write-key"),
          value: Credential.Key.make({ type: "key", key: "key secret" }),
        })
        const oauth = yield* credentials.create({
          integrationID: Integration.ID.make("dual-write-oauth"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("oauth"),
            refresh: "refresh",
            access: "access",
            expires: 1,
          }),
        })
        const stored = yield* database.use("Credential.dualWriteFixture", (db) =>
          db
            .select({
              id: Database.CredentialTable.id,
              value: Database.CredentialTable.value,
              valueJson: Database.CredentialTable.valueJson,
            })
            .from(Database.CredentialTable)
            .where(sql`${Database.CredentialTable.id} in (${key.id}, ${oauth.id})`),
        )
        // Decrypt at-rest envelopes back to the stored shape for the assertion.
        return yield* Effect.forEach(stored, (row) =>
          Effect.gen(function* () {
            const value = row.value === null ? null : Redacted.value(yield* cipher.decrypt(row.value))
            const valueJson = JSON.parse(Redacted.value(yield* cipher.decrypt(row.valueJson as string)))
            return { id: row.id, value, valueJson }
          }),
        )
      }).pipe(
        Effect.provide(
          Layer.merge(
            Credential.layer(workspaceID).pipe(Layer.provide(persistenceLayer)),
            Layer.merge(databaseLayer, cipherLayer),
          ),
        ),
      ),
    )

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "key secret", valueJson: { type: "key", key: "key secret" } }),
        expect.objectContaining({
          value: null,
          valueJson: { type: "oauth", methodID: "oauth", refresh: "refresh", access: "access", expires: 1 },
        }),
      ]),
    )
  })

  it("serializes rotating OAuth refreshes across Workspace graphs", async () => {
    let refreshes = 0
    const credential = await Effect.runPromise(
      Credential.Service.use((credentials) =>
        credentials.create({
          integrationID: Integration.ID.make("cross-workspace-refresh"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("oauth"),
            refresh: "initial-refresh-token",
            access: "expired-access-token",
            expires: 1,
          }),
        }),
      ).pipe(Effect.provide(Credential.layer(workspaceID).pipe(Layer.provide(persistenceLayer)))),
    )
    const refresh = (current: Credential.OAuth) =>
      Effect.gen(function* () {
        refreshes++
        yield* Effect.sleep(100)
        return Credential.OAuth.make({
          ...current,
          refresh: `rotated-${refreshes}`,
          access: `access-${refreshes}`,
          expires: Date.now() + 60 * 60 * 1_000,
        })
      })
    const expiresBefore = Date.now() + 5 * 60 * 1_000
    const values = await Effect.runPromise(
      Effect.all(
        [
          Credential.Service.use((credentials) => credentials.refreshOAuth(credential.id, expiresBefore, refresh)).pipe(
            Effect.provide(Credential.layer(workspaceID)),
          ),
          Credential.Service.use((credentials) => credentials.refreshOAuth(credential.id, expiresBefore, refresh)).pipe(
            Effect.provide(Credential.layer(workspaceID)),
          ),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(persistenceLayer)),
    )

    expect(refreshes).toBe(1)
    expect(values[0]).toEqual(values[1])
    expect(values[0]?.refresh).toBe("rotated-1")
  })

  it("keeps multiple credentials, isolates activation by integration, and promotes the newest remaining credential", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const integrationID = Integration.ID.make("credential-accounts")
        const otherIntegrationID = Integration.ID.make("credential-accounts-other")
        const first = yield* credentials.create({
          integrationID,
          label: "Personal",
          value: Credential.Key.make({ type: "key", key: "personal" }),
        })
        const second = yield* credentials.create({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "work" }),
        })
        const other = yield* credentials.create({
          integrationID: otherIntegrationID,
          value: Credential.Key.make({ type: "key", key: "other" }),
        })

        yield* credentials.activate(first.id)
        const activated = yield* credentials.list(integrationID)
        const isolated = yield* credentials.list(otherIntegrationID)
        yield* credentials.remove(second.id)
        const afterInactiveRemoval = yield* credentials.list(integrationID)
        const replacement = yield* credentials.create({
          integrationID,
          label: "Latest",
          value: Credential.Key.make({ type: "key", key: "latest" }),
        })
        yield* credentials.remove(replacement.id)
        const afterActiveRemoval = yield* credentials.list(integrationID)
        yield* Effect.forEach([...afterActiveRemoval, other], (credential) => credentials.remove(credential.id), {
          discard: true,
        })
        return { first, second, other, activated, isolated, afterInactiveRemoval, afterActiveRemoval }
      }).pipe(
        Effect.provide(Layer.merge(Credential.layer(workspaceID).pipe(Layer.provide(persistenceLayer)), databaseLayer)),
      ),
    )

    expect(result.activated.map((credential) => credential.id)).toEqual([result.second.id, result.first.id])
    expect(result.isolated.map((credential) => credential.id)).toEqual([result.other.id])
    expect(result.afterInactiveRemoval.map((credential) => credential.id)).toEqual([result.first.id])
    expect(result.afterActiveRemoval.map((credential) => credential.id)).toEqual([result.first.id])
  })

  it("rejects malformed canonical credential JSON", async () => {
    const id = CredentialSchema.ID.create()
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("Credential.malformedFixture", (db) =>
          db.execute(sql`INSERT INTO credential
            (id, workspace_id, integration_id, label, value, value_json, time_created, time_updated)
            VALUES (${id}, ${workspaceID}, 'malformed', 'Malformed', NULL, '{"type":"key","key":42}'::jsonb, now(), now())`),
        )
        return yield* Credential.Service.use((credentials) => credentials.get(id)).pipe(
          Effect.provide(Credential.layer(workspaceID)),
          Effect.exit,
        )
      }).pipe(Effect.provide(persistenceLayer)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("publishes secret-free connection inventory events", async () => {
    const secret = "event-feed-secret-canary"
    const event = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const integrations = yield* Integration.Service
          const next = yield* (yield* bus.subscribe(Integration.Event.ConnectionUpdated)).pipe(
            Stream.runHead,
            Effect.forkChild,
          )
          yield* Effect.yieldNow
          yield* integrations.connection.key({ integrationID: Integration.ID.make("exa"), key: secret })
          const publication = yield* Fiber.join(next)
          return publication._tag === "Some" ? publication.value : undefined
        }).pipe(Effect.provide(Layer.merge(layer, busLayer))),
      ),
    )

    expect(event).toMatchObject({
      type: "integration.connection.updated",
      data: { integrationID: "exa" },
    })
    expect(JSON.stringify(event)).not.toContain(secret)
  })

  it("isolates credential repository operations between Workspaces", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* Credential.Service.use((credentials) =>
          credentials.create({
            integrationID: Integration.ID.make("firecrawl"),
            value: Credential.Key.make({ type: "key", key: "workspace-only-secret" }),
          }),
        ).pipe(Effect.provide(Credential.layer(workspaceID)))
        const foreign = yield* Credential.Service.use((credentials) =>
          Effect.gen(function* () {
            const before = yield* credentials.get(created.id)
            yield* credentials.activate(created.id)
            yield* credentials.update(created.id, { label: "foreign update" })
            yield* credentials.remove(created.id)
            return before
          }),
        ).pipe(Effect.provide(Credential.layer(otherWorkspaceID)))
        const original = yield* Credential.Service.use((credentials) => credentials.get(created.id)).pipe(
          Effect.provide(Credential.layer(workspaceID)),
        )
        yield* Credential.Service.use((credentials) => credentials.remove(created.id)).pipe(
          Effect.provide(Credential.layer(workspaceID)),
        )
        return { foreign, original }
      }).pipe(Effect.provide(persistenceLayer)),
    )

    expect(result.foreign).toBeUndefined()
    expect(result.original).toMatchObject({ label: "default", value: { key: "workspace-only-secret" } })
  })
})

function mcpHostServices(
  bus: Bus.Interface,
  integration: Integration.Interface,
  tool: Tool.Interface,
  mcp: Mcp.Interface,
  storage: Storage.Interface,
  shellHooks: PluginHooks.Interface,
): PluginHost.HostServices {
  return {
    workspaceID,
    http: internalHttp,
    app: { name: "ByMorning", version: "test", channel: "test" },
    agent: agentService({
      list: Effect.succeed([]),
      get: () => Effect.die("unused"),
      resolve: Effect.die("unused"),
      create: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
    }),
    aisdk: {} as PluginHost.HostServices["aisdk"],
    catalog: {} as PluginHost.HostServices["catalog"],
    command: {} as PluginHost.HostServices["command"],
    bus,
    integration,
    instruction: {} as PluginHost.HostServices["instruction"],
    mcp,
    plugin: { activate: () => Effect.void, list: () => Effect.succeed([]) },
    reference: {} as PluginHost.HostServices["reference"],
    runtime: { session: {}, job: {} } as PluginHost.HostServices["runtime"],
    shellHooks,
    skill: {} as PluginHost.HostServices["skill"],
    storage,
    tool,
    websearch: {} as PluginHost.HostServices["websearch"],
  }
}

const toolCount = (tools: Tool.Interface) =>
  tools
    .snapshot()
    .pipe(
      Effect.map(
        (snapshot) =>
          snapshot.definitions.filter((definition) => definition.name !== "execute").length +
          (snapshot.codeModeCatalog === undefined ? 0 : CodeModeCatalog.summarize(snapshot.codeModeCatalog).total),
      ),
    )

const waitUntil = (condition: Effect.Effect<boolean>): Effect.Effect<void> => {
  const timeout = new Error("Integration condition did not become ready")
  const poll: Effect.Effect<void> = Effect.suspend(() =>
    condition.pipe(Effect.flatMap((done) => (done ? Effect.void : Effect.yieldNow.pipe(Effect.andThen(poll))))),
  )
  return poll.pipe(
    Effect.timeout("2 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.die(timeout)),
  )
}

const oauthMcpServer = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const fixture = {
        challenge: "",
        rejectRefresh: false,
        registrations: 0,
        pkceVerified: false,
        initializations: 0,
        terminations: 0,
      }
      const sessions = new Map<string, { server: Server; transport: WebStandardStreamableHTTPServerTransport }>()
      const http = createServer(async (incoming, outgoing) => {
        const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`
        const chunks: Buffer[] = []
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)
        const url = new URL(incoming.url ?? "/", origin)
        const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => {
          outgoing.writeHead(status, { "content-type": "application/json", ...headers })
          outgoing.end(JSON.stringify(value))
        }
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
          json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
          return
        }
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          })
          return
        }
        if (url.pathname === "/register") {
          fixture.registrations++
          const metadata = JSON.parse(body.toString("utf8")) as { redirect_uris?: unknown }
          if (!Array.isArray(metadata.redirect_uris)) {
            json({ error: "invalid_client_metadata" }, 400)
            return
          }
          json({ client_id: "fixture-client", ...metadata }, 201)
          return
        }
        if (url.pathname === "/token") {
          const form = new URLSearchParams(body.toString("utf8"))
          if (form.get("grant_type") === "refresh_token") {
            if (fixture.rejectRefresh) {
              json({ error: "invalid_grant" }, 400)
              return
            }
            json({
              access_token: "access-2",
              refresh_token: "refresh-2",
              token_type: "Bearer",
              expires_in: 3600,
            })
            return
          }
          fixture.pkceVerified =
            createHash("sha256")
              .update(form.get("code_verifier") ?? "")
              .digest("base64url") === fixture.challenge
          if (!fixture.pkceVerified || form.get("code") !== "code") {
            json({ error: "invalid_grant" }, 400)
            return
          }
          json({
            access_token: "access-1",
            refresh_token: "refresh-1",
            token_type: "Bearer",
            expires_in: 1,
          })
          return
        }
        if (url.pathname !== "/mcp") {
          outgoing.writeHead(404)
          outgoing.end()
          return
        }
        if (incoming.headers.authorization !== "Bearer access-2") {
          json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authentication required" } }, 401, {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          })
          return
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
          else if (value !== undefined) headers.set(name, value)
        }
        const request = new Request(`${origin}${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(body.length === 0 ? {} : { body }),
        })
        const sessionID = request.headers.get("mcp-session-id")
        const session = sessionID === null ? undefined : sessions.get(sessionID)
        const active =
          session ??
          (await (async () => {
            fixture.initializations++
            const server = new Server({ name: "oauth-fixture", version: "1" }, { capabilities: { tools: {} } })
            server.setRequestHandler("tools/list", () => ({
              tools: [{ name: "fixture", inputSchema: { type: "object", properties: {} } }],
            }))
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              enableJsonResponse: true,
            })
            await server.connect(transport)
            return { server, transport }
          })())
        const response = await active.transport.handleRequest(request)
        const initializedID = response.headers.get("mcp-session-id")
        if (initializedID !== null) sessions.set(initializedID, active)
        if (incoming.method === "DELETE" && sessionID !== null) {
          fixture.terminations++
          sessions.delete(sessionID)
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      })
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
      const address = http.address()
      if (address === null || typeof address === "string") throw new Error("OAuth MCP fixture did not bind")
      return {
        get challenge() {
          return fixture.challenge
        },
        set challenge(value: string) {
          fixture.challenge = value
        },
        get rejectRefresh() {
          return fixture.rejectRefresh
        },
        set rejectRefresh(value: boolean) {
          fixture.rejectRefresh = value
        },
        get registrations() {
          return fixture.registrations
        },
        get pkceVerified() {
          return fixture.pkceVerified
        },
        get initializations() {
          return fixture.initializations
        },
        get terminations() {
          return fixture.terminations
        },
        url: `http://127.0.0.1:${address.port}/`,
        close: async () => {
          await Promise.all([...sessions.values()].map(({ server }) => server.close().catch(() => undefined)))
          await new Promise<void>((resolve, reject) =>
            http.close((error) => (error === undefined ? resolve() : reject(error))),
          )
        },
      }
    }),
    (fixture) => Effect.promise(fixture.close),
  )
const internalHttp = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("unused", { status: 500 }))),
)
