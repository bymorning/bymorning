/** Shared Scheduled Task fixtures for backend and SDK tests. */
export * as ScheduledTaskScenario from "./scheduled-task.js"

import { Database, ScheduledTaskTable } from "@bymorning/core/database"
import { Effect } from "effect"
import type { TestApp } from "../application.js"
import type { Chat } from "./chat.js"

/** Create a task owned by the member `Chat.make` provisioned, in that member's Project. */
export const create = Effect.fn("ScheduledTaskScenario.create")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  overrides: Partial<{
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly enabled: boolean
  }> = {},
) {
  return yield* Effect.tryPromise(() =>
    app.client.scheduledTask.create({
      name: overrides.name ?? "Daily briefing",
      prompt: overrides.prompt ?? "Summarize the last 24 hours of notable repository activity in five bullets.",
      cron: overrides.cron ?? "0 8 * * 1-5",
      timezone: overrides.timezone ?? "America/New_York",
      projectID: data.project.id,
      ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
    }),
  )
})

/**
 * Directly set run-tracking columns on the sole Scheduled Task row this test's Application owns, bypassing the
 * public update contract (which never accepts `nextRunAt` or `missedAt` directly).
 */
export const backdate = Effect.fn("ScheduledTaskScenario.backdate")(function* (
  app: TestApp.Interface,
  values: Partial<{ readonly nextRunAt: Date | null; readonly missedAt: Date | null }>,
) {
  yield* app
    .process(
      Database.Service.use((database) =>
        database.use("ScheduledTaskScenario.backdate", (db) => db.update(ScheduledTaskTable).set(values)),
      ),
    )
    .pipe(Effect.orDie)
})
