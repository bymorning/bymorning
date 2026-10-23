import { Account } from "@bymorning/schema/account"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { User } from "@bymorning/schema/user"
import * as UsageSchema from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { NodeCrypto } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { eq } from "drizzle-orm"
import { Cause, Effect, Layer, Redacted } from "effect"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  AccountTable,
  Database,
  UsageTable,
  ServiceAccountTable,
  UserTable,
  WorkspaceTable,
} from "../../src/database.js"
import { Usage } from "../../src/usage.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const workspaceID = Workspace.ID.create()
const accountID = Account.ID.create()
const userID = User.ID.create()
const serviceAccountID = ServiceAccount.ID.create()
const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(process.env.DATABASE_URL) })))
const testLayer = Layer.merge(
  database,
  Usage.layer(workspaceID).pipe(Layer.provide(Layer.merge(database, NodeCrypto.layer))),
)

describe("Usage inference persistence", () => {
  beforeAll(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("UsageInferenceTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Inference usage", status: "active" })
            yield* db.insert(UserTable).values({
              id: userID,
              workspaceId: workspaceID,
              accountId: accountID,
              role: "admin",
            })
            yield* db.insert(ServiceAccountTable).values({
              id: serviceAccountID,
              workspaceID,
              name: "Inference usage",
              status: "active",
            })
          }),
        )
      }).pipe(Effect.provide(database)),
    ),
  )

  afterAll(async () => {
    await Effect.runPromise(
      Database.Service.use((database) =>
        database.use("UsageInferenceTest.cleanup", (db) =>
          Effect.gen(function* () {
            yield* db.delete(UsageTable).where(eq(UsageTable.workspaceID, workspaceID))
            yield* db.delete(ServiceAccountTable).where(eq(ServiceAccountTable.workspaceID, workspaceID))
            yield* db.delete(UserTable).where(eq(UserTable.workspaceId, workspaceID))
            yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID))
            yield* db.delete(AccountTable).where(eq(AccountTable.id, accountID))
          }),
        ),
      ).pipe(Effect.provide(database)),
    )
  })

  it("records principal-attributed Gateway usage and preserves historical and Session attribution", async () => {
    const user = { type: "user" as const, userID }
    const serviceAccount = { type: "service_account" as const, serviceAccountID }
    const period = {
      start: new Date("2026-09-01T00:00:00.000Z"),
      end: new Date("2026-10-01T00:00:00.000Z"),
    }
    const entry = {
      model: "public-model",
      endpointID: "endpoint",
      upstreamModel: "upstream-model",
      tokens: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      selection: Model.Info.make({
        id: "priced-model",
        provider: Provider.Name.make("test"),
        apiID: "upstream-model",
        name: "Priced model",
        description: "",
        status: "active",
        releaseDate: "2026-01-01",
        lastUpdated: "2026-01-01",
        openWeights: false,
        capabilities: { temperature: true, reasoning: true, attachment: false, tools: true, input: [], output: [] },
        variants: [],
        limit: { context: 1_000_000, output: 100_000 },
        cost: { input: 1_000_000, output: 0, cache: { read: 0, write: 0 } },
      }),
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        yield* usage.record({
          ...entry,
          requestID: "gateway-first",
          occurredAt: new Date("2026-09-01T00:00:00.000Z"),
          principal: user,
        })
        yield* usage.record({
          ...entry,
          requestID: "gateway-newest",
          occurredAt: new Date("2026-09-02T00:00:00.000Z"),
          principal: serviceAccount,
        })

        yield* Database.Service.pipe(
          Effect.flatMap((database) =>
            database.use("UsageInferenceTest.sessionUsage", (db) =>
              db.insert(UsageTable).values([
                {
                  // Historical Gateway rows predate attribution and stay anonymous.
                  id: UsageSchema.ID.make(randomUUID()),
                  workspaceID,
                  source: "inference",
                  request_id: "historical-anonymous",
                  model: "historical-anonymous-model",
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: "1",
                  occurredAt: new Date("2026-09-01T00:00:00.000Z"),
                },
                {
                  id: UsageSchema.ID.make(randomUUID()),
                  workspaceID,
                  userID,
                  source: "inference",
                  request_id: "historical-user",
                  model: "historical-user-model",
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: "3",
                  occurredAt: new Date("2026-09-03T00:00:00.000Z"),
                },
                {
                  id: UsageSchema.ID.make(randomUUID()),
                  workspaceID,
                  serviceAccountID,
                  source: "inference",
                  request_id: "historical-service-account",
                  model: "historical-service-account-model",
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: "5",
                  occurredAt: new Date("2026-09-04T00:00:00.000Z"),
                },
                {
                  id: UsageSchema.ID.make(randomUUID()),
                  workspaceID,
                  userID,
                  source: "session",
                  model: "session-model",
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: "4",
                  costComplete: false,
                  occurredAt: new Date("2026-09-30T23:59:59.999Z"),
                },
              ]),
            ),
          ),
        )

        // The two recorded Gateway invocations price at 1 each; historical rows
        // sum 3 + 5, and the anonymous row contributes only to the total.
        expect(yield* usage.spend({ source: "inference", period })).toBe(11)
        expect(yield* usage.spend({ source: "inference", principal: user, period })).toBe(4)
        expect(yield* usage.spend({ source: "inference", principal: serviceAccount, period })).toBe(6)
        expect(yield* usage.spend({ source: "all", period })).toBe(15)

        const records = (yield* usage.records()).data
        const gateway = records.find((item) => item.requestID === "gateway-newest")
        const gatewayUser = records.find((item) => item.requestID === "gateway-first")
        const session = records.find((item) => item.source === "session")
        const historicalServiceAccount = records.find((item) => item.requestID === "historical-service-account")
        const historicalAnonymous = records.find((item) => item.requestID === "historical-anonymous")
        expect(gateway).toBeDefined()
        expect(gateway?.principal).toEqual(serviceAccount)
        expect(gatewayUser?.principal).toEqual(user)
        expect(session?.principal).toEqual(user)
        expect(historicalServiceAccount?.principal).toEqual(serviceAccount)
        expect(historicalAnonymous).toBeDefined()
        expect(historicalAnonymous).not.toHaveProperty("principal")
      }).pipe(Effect.provide(testLayer)),
    )
  })

  it("rejects invalid Usage principals", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const fields = {
          workspaceID,
          model: "constraint-model",
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: "0",
          costComplete: true,
          occurredAt: new Date("2026-09-05T00:00:00.000Z"),
        }

        const bothPrincipals = yield* database
          .use("UsageInferenceTest.bothPrincipals", (db) =>
            db.insert(UsageTable).values({
              ...fields,
              id: UsageSchema.ID.make("00000000-0000-4000-8000-000000000001"),
              userID,
              serviceAccountID,
              source: "inference",
            }),
          )
          .pipe(Effect.flip)
        expect(bothPrincipals).toMatchObject({
          _tag: "EffectDrizzleQueryError",
        })
        expect(Cause.squash(bothPrincipals.cause as Cause.Cause<unknown>)).toMatchObject({
          _tag: "SqlError",
          reason: { _tag: "ConstraintError", cause: { constraint: "usage_principal_check" } },
        })

        const sessionWithoutUser = yield* database
          .use("UsageInferenceTest.sessionWithoutUser", (db) =>
            db.insert(UsageTable).values({
              ...fields,
              id: UsageSchema.ID.make("00000000-0000-4000-8000-000000000002"),
              source: "session",
            }),
          )
          .pipe(Effect.flip)
        expect(sessionWithoutUser).toMatchObject({
          _tag: "EffectDrizzleQueryError",
        })
        expect(Cause.squash(sessionWithoutUser.cause as Cause.Cause<unknown>)).toMatchObject({
          _tag: "SqlError",
          reason: { _tag: "ConstraintError", cause: { constraint: "usage_session_principal_check" } },
        })
      }).pipe(Effect.provide(database)),
    )
  })
})
