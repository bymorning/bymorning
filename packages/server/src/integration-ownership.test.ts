import { Bus } from "@bymorning/core/bus"
import { Actor } from "@bymorning/core/actor"
import { Cipher } from "@bymorning/core/cipher"
import { Database, UserTable, WorkspaceTable } from "@bymorning/core/database"
import { Integration } from "@bymorning/core/integration"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { makeGlobalNode, makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Effect, Layer, Redacted, Stream } from "effect"
import { expect, it } from "vitest"
import { postgres } from "../test/postgres.js"
import { WorkspaceEventBroadcaster } from "./workspace-event-broadcaster.js"
import { WorkspaceMap } from "./workspace-map.js"

it("keeps personal connection events local while broadcasting shared changes", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const broadcaster = yield* WorkspaceEventBroadcaster.Service
        const workspaceID = Workspace.ID.make("wrk_member_events")
        const aliceID = User.ID.create()
        const bobID = User.ID.create()
        yield* database.use("MemberEvents.seed", (db) =>
          Effect.gen(function* () {
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Members", status: "active" })
            yield* db.insert(UserTable).values([
              { id: aliceID, workspaceId: workspaceID, role: "member" },
              { id: bobID, workspaceId: workspaceID, role: "member" },
            ])
          }),
        )
        const build = (userID: User.ID) =>
          Effect.gen(function* () {
            const bus = Bus.node
            const integration = WorkspaceEventBroadcaster.integrationPublisherNode({
              bus,
              broadcaster: makeGlobalNode({
                service: WorkspaceEventBroadcaster.Service,
                layer: Layer.succeed(WorkspaceEventBroadcaster.Service, broadcaster),
                deps: [],
              }),
            })
            const context = yield* Layer.build(
              LayerNode.compile(LayerNode.group([bus, integration]), {
                replacements: [
                  Database.node.replace(Layer.succeed(Database.Service, database)),
                  Cipher.node.replace(
                    Cipher.configured(
                      Effect.runSync(
                        Cipher.localBackend(Redacted.make(Buffer.alloc(32, 37).toString("base64url"))).pipe(
                          Effect.provide(NodeCrypto.layer),
                        ),
                      ),
                    ),
                  ),
                  Actor.binding.replace(
                    makeWorkspaceNode({
                      service: Actor.Binding.Service,
                      layer: Layer.succeed(Actor.Binding.Service, { workspaceID, userID, accountID: Account.ID.create(), role: "admin" }),
                      deps: [],
                    }),
                  ),
                ],
              }),
            )
            const events = Context.get(context, Bus.Service)
            yield* broadcaster.register(
              workspaceID,
              new WorkspaceMap.RuntimeKey({ workspaceID, accountID: Account.ID.create() }),
              events,
            )
            return {
              integration: Context.get(context, Integration.Service),
              events: yield* events.subscribe([Integration.Event.ConnectionUpdated]),
            }
          })
        const alice = yield* build(aliceID)
        const bob = yield* build(bobID)
        const personal = Integration.ID.make("personal")
        const shared = Integration.ID.make("shared")
        const marker = Integration.ID.make("marker")
        yield* alice.integration.transform((draft) => {
          for (const id of [personal, shared, marker]) {
            draft.update(id, (integration) => {
              integration.name = id
            })
            draft.method.update({ integrationID: id, method: { type: "key" } })
          }
        })
        yield* alice.integration.connection.key({ integrationID: personal, key: "personal-value", scope: "member" })
        yield* alice.integration.connection.key({ integrationID: shared, key: "shared-value" })
        yield* alice.integration.connection.key({ integrationID: personal, key: "replacement-value", scope: "member" })
        yield* alice.integration.connection.key({ integrationID: marker, key: "marker-value" })
        expect(
          (yield* Stream.runCollect(alice.events.pipe(Stream.take(4)))).map((event) => event.data.integrationID),
        ).toEqual([personal, shared, personal, marker])
        expect(
          (yield* Stream.runCollect(bob.events.pipe(Stream.take(2)))).map((event) => event.data.integrationID),
        ).toEqual([shared, marker])
      }).pipe(
        Effect.provide(Layer.merge(WorkspaceEventBroadcaster.layer, postgres())),
        Effect.timeout("45 seconds"),
      ),
    ),
  )
}, 60_000)
