import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { RunContext } from "../src/scheduled-task/context.js"
import { Schedule } from "../src/scheduled-task/schedule.js"
import { unattendedRules } from "../src/session/permission.js"

const failureOf = <A>(result: Result.Result<A, ScheduledTask.ScheduleError>) => {
  expect(Result.isFailure(result)).toBe(true)
  if (!Result.isFailure(result)) throw new Error("Expected Schedule.parse to fail")
  expect(result.failure).toBeInstanceOf(ScheduledTask.ScheduleError)
  return result.failure
}

const successOf = <A>(result: Result.Result<A, ScheduledTask.ScheduleError>) => {
  expect(Result.isSuccess(result)).toBe(true)
  if (!Result.isSuccess(result)) throw new Error(`Expected Schedule.parse to succeed: ${result.failure.message}`)
  return result.success
}

describe("Schedule.parse", () => {
  it("accepts a weekday cron in a named zone and normalizes whitespace", () => {
    const parsed = successOf(Schedule.parse("  0   8  * *   1-5  ", " America/New_York "))
    expect(parsed.expression).toBe("0 8 * * 1-5")
    expect(parsed.timezone).toBe("America/New_York")
  })

  it("rejects a six-field expression", () => {
    expect(failureOf(Schedule.parse("0 0 8 * * 1-5", "UTC")).message).toBe("Cron schedule must have five fields")
  })

  it("rejects a garbage cron expression", () => {
    expect(failureOf(Schedule.parse("this is not a cron", "UTC")).message).toBe("Enter a valid cron schedule")
  })

  it("rejects an unknown time zone", () => {
    expect(failureOf(Schedule.parse("0 8 * * 1-5", "Mars/Olympus")).message).toBe("Unknown time zone: Mars/Olympus")
  })

  it("rejects occurrences closer than one hour", () => {
    expect(failureOf(Schedule.parse("*/30 * * * *", "UTC")).message).toBe(
      "Schedule occurrences must be at least one hour apart",
    )
  })

  it("accepts occurrences exactly one hour apart", () => {
    // The minimum interval check is strictly less than one hour.
    successOf(Schedule.parse("0 * * * *", "UTC"))
  })
})

describe("Schedule.next", () => {
  it("returns the next occurrence strictly after now in the schedule's zone", () => {
    const parsed = successOf(Schedule.parse("0 8 * * 1-5", "America/New_York"))
    // Friday 2026-09-18 08:00 in New York (EDT, UTC-4); the next weekday 08:00 is Monday.
    const now = new Date("2026-09-18T12:00:00.000Z")
    const next = Schedule.next(parsed, now)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
    expect(next.toISOString()).toBe("2026-09-21T12:00:00.000Z")
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .formatToParts(next)
        .map((part) => [part.type, part.value]),
    )
    expect(parts.weekday).toBe("Mon")
    expect(Number(parts.hour)).toBe(8)
    expect(Number(parts.minute)).toBe(0)
  })
})

describe("unattendedRules", () => {
  it("denies every ask, keeps other effects, and appends the question denial", () => {
    const rules = [
      { action: "*", resource: "*", effect: "allow" as const },
      { action: "read", resource: "*.env", effect: "ask" as const },
      { action: "shell", resource: "*", effect: "deny" as const },
    ]
    expect(unattendedRules(rules)).toEqual([
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "shell", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "deny" },
    ])
    // The input ruleset is not mutated.
    expect(rules[1]?.effect).toBe("ask")
  })
})

describe("RunContext.render", () => {
  const task = { name: "Daily briefing", cron: "0 8 * * 1-5", timezone: "America/New_York" }

  it("describes the unattended run with the step budget and task name", () => {
    const rendered = RunContext.render(task)
    expect(rendered).toContain("scheduled task")
    expect(rendered).toContain("Daily briefing")
    expect(rendered).toContain(`${ScheduledTask.RunSteps}`)
    expect(rendered).toContain(task.cron)
    expect(rendered).toContain(task.timezone)
  })

  it("appends an optional note", () => {
    const rendered = RunContext.render(task, "The preferred model is unavailable; this run uses the default model.")
    expect(rendered).toContain("The preferred model is unavailable")
    expect(RunContext.render(task)).not.toContain("unavailable")
  })
})
