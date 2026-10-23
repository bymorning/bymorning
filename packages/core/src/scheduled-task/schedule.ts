/** Cron and time zone handling private to the Scheduled Task domain. */
export * as Schedule from "./schedule.js"

import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { Cron, Result } from "effect"

/** A parsed schedule bound to its time zone. */
export interface Parsed {
  readonly cron: Cron.Cron
  /** The normalized five-field expression as stored. */
  readonly expression: string
  readonly timezone: string
}

/**
 * Parse and validate a schedule. Fails when the cron expression or time zone is invalid, or when the first
 * occurrences are closer together than {@link ScheduledTask.MinIntervalMillis}.
 */
export const parse = (
  cron: string,
  timezone: string,
): Result.Result<Parsed, ScheduledTask.ScheduleError> => {
  const expression = cron.trim()
  const zone = timezone.trim()
  const fields = expression.split(/\s+/)
  if (fields.length !== 5) {
    return Result.fail(new ScheduledTask.ScheduleError({ message: "Cron schedule must have five fields" }))
  }
  const withoutZone = Cron.parse(expression)
  if (Result.isFailure(withoutZone)) {
    return Result.fail(new ScheduledTask.ScheduleError({ message: "Enter a valid cron schedule" }))
  }
  const parsed = Cron.parse(expression, zone)
  if (Result.isFailure(parsed)) {
    return Result.fail(new ScheduledTask.ScheduleError({ message: `Unknown time zone: ${zone}` }))
  }
  const interval = shortestInterval(parsed.success)
  if (interval !== undefined && interval < ScheduledTask.MinIntervalMillis) {
    return Result.fail(
      new ScheduledTask.ScheduleError({ message: "Schedule occurrences must be at least one hour apart" }),
    )
  }
  return Result.succeed({ cron: parsed.success, expression: fields.join(" "), timezone: zone })
}

/** The next occurrence strictly after `now`. */
export const next = (schedule: Parsed, now: Date): Date => Cron.next(schedule.cron, now)

/** Smallest gap between consecutive occurrences across a sample of upcoming runs, or undefined when none. */
const shortestInterval = (cron: Cron.Cron): number | undefined => {
  let previous: Date | undefined
  let shortest: number | undefined
  let count = 0
  for (const date of Cron.sequence(cron, new Date())) {
    if (previous !== undefined) {
      const gap = date.getTime() - previous.getTime()
      shortest = shortest === undefined ? gap : Math.min(shortest, gap)
    }
    previous = date
    if (++count >= 8) break
  }
  return shortest
}
