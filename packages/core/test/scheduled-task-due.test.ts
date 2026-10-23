import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Database } from "../src/database.js"
import { Due } from "../src/scheduled-task/due.js"

const now = new Date("2026-06-01T09:00:01.000Z")
const due = new Date("2026-06-01T09:00:00.000Z")

const row = {
  workspaceID: "workspace",
  id: "task",
  userID: "user",
  cron: "0 9 * * *",
  timezone: "UTC",
  nextRunAt: due,
  accountID: "account",
  userDeleted: null,
  accountStatus: "active",
  accountDeleted: null,
  workspaceStatus: "active",
  workspaceDeleted: null,
  projectArchived: null,
}

/** Record the database labels the claim flow touches; the queries themselves never run. */
const makeDatabase = (calls: Array<string>): Database.Interface => ({
  use: ((label: string) => {
    calls.push(label)
    return Effect.succeed(label === "ScheduledTask.Due.select" ? [row] : [{ id: row.id }])
  }) as Database.Interface["use"],
  transact: (effect) => effect,
  transactRoot: (effect) => effect,
  afterCommit: () => Effect.void,
})

const claim = (calls: Array<string>) => {
  const layer = Due.layer.pipe(Layer.provide(Layer.succeed(Database.Service, makeDatabase(calls))))
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Due.Service
      return yield* service.claim(now)
    }).pipe(Effect.provide(layer)),
  )
}

describe("ScheduledTask.Due", () => {
  it("claims due rows", async () => {
    const calls: Array<string> = []
    const claims = await claim(calls)
    expect(claims).toEqual([
      { taskID: "task", owner: { workspaceID: "workspace", accountID: "account", userID: "user" } },
    ])
    expect(calls).toEqual(["ScheduledTask.Due.select", "ScheduledTask.Due.advance"])
  })
})
