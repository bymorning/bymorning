import { Database } from "@bymorning/core/database"
import { User } from "@bymorning/core/user"
import { Integration } from "@bymorning/schema/integration"
import * as UserSchema from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Credential } from "../../src/credential.js"
import { CredentialTable } from "../../src/database/schema/credential.sql.js"
import { UserTable } from "../../src/database/schema/user.sql.js"
import { WorkspaceTable } from "../../src/database/schema/workspace.sql.js"
import { OutboundMCPSettings } from "../../src/outbound-mcp-settings.js"
import { Mcp } from "../../src/mcp.js"
import { layer as cipherLayer } from "../fixtures/cipher.js"
import { compile, database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const users = compile(LayerNode.group([User.node, Database.node]))

const seed = async () => {
  const workspaceID = Workspace.ID.create()
  const admin = UserSchema.ID.create()
  const jane = UserSchema.ID.create()
  const bob = UserSchema.ID.create()
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.use("MemberValues.seed", (tx) =>
        Effect.gen(function* () {
          yield* tx.insert(WorkspaceTable).values({ id: workspaceID, name: "Member values", status: "active" })
          yield* tx.insert(UserTable).values([
            { id: admin, workspaceId: workspaceID, role: "admin" },
            { id: jane, workspaceId: workspaceID, role: "member" },
            { id: bob, workspaceId: workspaceID, role: "member" },
          ])
        }),
      )
    }).pipe(Effect.provide(database)),
  )
  return { workspaceID, admin, jane, bob }
}

const as = <A>(workspaceID: Workspace.ID, userID: UserSchema.ID, effect: Effect.Effect<A, never, Credential.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Credential.layer({ workspaceID, userID }).pipe(Layer.provide(Layer.mergeAll(database, cipherLayer)))),
    ),
  )

const rows = (workspaceID: Workspace.ID) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      return yield* db.use("MemberValues.rows", (tx) =>
        tx.select().from(CredentialTable).where(eq(CredentialTable.workspaceId, workspaceID)).pipe(Effect.orDie),
      )
    }).pipe(Effect.provide(database)),
  )

const river = Integration.ID.make(Mcp.identity("river", "https://river.example/mcp"))
const other = Integration.ID.make("other-integration")
const values = (token: string) => Credential.Values.make({ type: "values", values: { JIRA_TOKEN: token } })

describe("Member Values persistence", () => {
  it("stores each member's values encrypted and visible only to that member", async () => {
    const { workspaceID, jane, bob } = await seed()
    await as(workspaceID, jane, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: river, scope: "member", value: values("jane-secret") })))

    const stored = await rows(workspaceID)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.userID).toBe(jane)
    expect(String(stored[0]?.valueJson).startsWith("v1.")).toBe(true)
    expect(JSON.stringify(stored)).not.toContain("jane-secret")

    const janeSees = await as(workspaceID, jane, Effect.flatMap(Credential.Service, (c) => c.list(river)))
    expect(janeSees.map((item) => item.value)).toEqual([values("jane-secret")])
    const bobSees = await as(workspaceID, bob, Effect.flatMap(Credential.Service, (c) => c.list(river)))
    expect(bobSees).toEqual([])
  })

  it("discards every member's Credentials for a server that was removed or moved, and nothing else", async () => {
    const { workspaceID, jane, bob } = await seed()
    for (const [userID, token] of [[jane, "jane"], [bob, "bob"]] as const)
      await as(workspaceID, userID, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: river, scope: "member", value: values(token) })))
    await as(workspaceID, bob, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: other, scope: "member", value: values("bob") })))
    const before = { servers: { river: { type: "remote", url: "https://river.example/mcp", oauth: false } } } as const

    // Unchanged address keeps everything.
    await as(workspaceID, jane, Effect.flatMap(Credential.Service, (c) => OutboundMCPSettings.prune(c, before, before)))
    expect(await rows(workspaceID)).toHaveLength(3)

    // A new address discards both members' values for the old one, even when pruned from one member's binding.
    const moved = { servers: { river: { type: "remote", url: "https://elsewhere.example/mcp", oauth: false } } } as const
    await as(workspaceID, jane, Effect.flatMap(Credential.Service, (c) => OutboundMCPSettings.prune(c, before, moved)))
    const remaining = await rows(workspaceID)
    expect(remaining.map((row) => [row.integration_id, row.userID])).toEqual([[other, bob]])
  })

  it("deletes a removed member's own Credentials and keeps other members'", async () => {
    const { workspaceID, jane, bob } = await seed()
    for (const [userID, token] of [[jane, "jane"], [bob, "bob"]] as const)
      await as(workspaceID, userID, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: river, scope: "member", value: values(token) })))
    await Effect.runPromise(Effect.flatMap(User.Service, (service) => service.remove(workspaceID, jane)).pipe(Effect.provide(users)))
    expect((await rows(workspaceID)).map((row) => row.userID)).toEqual([bob])
  })

  it("reports which members hold an active Connection, never their values", async () => {
    const { workspaceID, jane, bob, admin } = await seed()
    await as(workspaceID, jane, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: river, scope: "member", value: values("jane-secret") })))
    await as(workspaceID, bob, Effect.flatMap(Credential.Service, (c) => c.create({ integrationID: other, scope: "member", value: values("bob-secret") })))

    // Asked from any binding, it names Jane for this server and nobody for another's.
    const held = await as(workspaceID, admin, Effect.flatMap(Credential.Service, (c) => c.connected(river)))
    expect(held.map((item) => item.userID)).toEqual([jane])
    expect(JSON.stringify(held)).not.toContain("jane-secret")
    expect(Object.keys(held[0] ?? {}).toSorted()).toEqual(["updated", "userID"])
  })
})
