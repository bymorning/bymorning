import { Cron, Result } from "effect"

/** Frequency presets offered in the dialog; `custom` exposes the raw cron field. */
export type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom"

export const frequencies: ReadonlyArray<{ readonly id: Frequency; readonly label: string }> = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "custom", label: "Custom cron" },
]

export const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

/** Structured schedule the dialog edits; converted to and from a cron expression. */
export interface Preset {
  readonly frequency: Frequency
  /** `HH:MM` in 24-hour form. */
  readonly time: string
  /** 0 = Sunday. Used by `weekly`. */
  readonly weekday: number
  /** 1..28. Used by `monthly`. */
  readonly day: number
  /** Raw expression. Used by `custom`. */
  readonly cron: string
}

export const defaultPreset: Preset = { frequency: "weekdays", time: "08:00", weekday: 1, day: 1, cron: "0 8 * * 1-5" }

const pad = (value: number) => String(value).padStart(2, "0")

/** Build a five-field cron from a preset. */
export function toCron(preset: Preset): string {
  if (preset.frequency === "custom") return preset.cron.trim().split(/\s+/).join(" ")
  const [hours, minutes] = preset.time.split(":").map(Number)
  const at = `${minutes ?? 0} ${hours ?? 0}`
  switch (preset.frequency) {
    case "daily":
      return `${at} * * *`
    case "weekdays":
      return `${at} * * 1-5`
    case "weekly":
      return `${at} * * ${preset.weekday}`
    case "monthly":
      return `${at} ${preset.day} * *`
  }
}

/** Recognise a cron produced by `toCron`; anything else becomes a `custom` preset. */
export function fromCron(cron: string): Preset {
  const fields = cron.trim().split(/\s+/)
  const base = { ...defaultPreset, cron: cron.trim() }
  if (fields.length !== 5) return { ...base, frequency: "custom" }
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
  const simple = /^\d{1,2}$/
  if (!simple.test(minute) || !simple.test(hour) || month !== "*") return { ...base, frequency: "custom" }
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`
  if (day === "*" && weekday === "*") return { ...base, frequency: "daily", time }
  if (day === "*" && weekday === "1-5") return { ...base, frequency: "weekdays", time }
  if (day === "*" && /^[0-6]$/.test(weekday)) return { ...base, frequency: "weekly", time, weekday: Number(weekday) }
  if (weekday === "*" && /^\d{1,2}$/.test(day) && Number(day) >= 1 && Number(day) <= 28)
    return { ...base, frequency: "monthly", time, day: Number(day) }
  return { ...base, frequency: "custom" }
}

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number)
  const date = new Date(2000, 0, 1, hours ?? 0, minutes ?? 0)
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
}

const ordinal = (day: number) => {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th"
  return `${day}${suffix}`
}

/** Human description like "Weekdays at 8:00 AM"; falls back to the raw expression. */
export function describe(cron: string): string {
  const hourly = /^(\d{1,2}) \* \* \* \*$/.exec(cron.trim().split(/\s+/).join(" "))
  if (hourly && Number(hourly[1]) < 60)
    return Number(hourly[1]) === 0 ? "Every hour" : `Every hour at :${pad(Number(hourly[1]))}`
  const preset = fromCron(cron)
  switch (preset.frequency) {
    case "daily":
      return `Daily at ${formatTime(preset.time)}`
    case "weekdays":
      return `Weekdays at ${formatTime(preset.time)}`
    case "weekly":
      return `Every ${weekdays[preset.weekday]} at ${formatTime(preset.time)}`
    case "monthly":
      return `Monthly on the ${ordinal(preset.day)} at ${formatTime(preset.time)}`
    case "custom":
      return cron
  }
}

/** Validate a cron and time zone the same way the server does, returning a message or undefined. */
export function validate(cron: string, timezone: string): string | undefined {
  const expression = cron.trim()
  if (expression.split(/\s+/).length !== 5) return "Enter a five-field cron schedule."
  if (Result.isFailure(Cron.parse(expression))) return "Enter a valid cron schedule."
  if (Result.isFailure(Cron.parse(expression, timezone))) return "Select a valid time zone."
  const parsed = Cron.parseUnsafe(expression, timezone)
  let previous: Date | undefined
  let count = 0
  for (const date of Cron.sequence(parsed, new Date())) {
    if (previous && date.getTime() - previous.getTime() < 60 * 60 * 1000) return "Runs must be at least one hour apart."
    previous = date
    if (++count >= 8) break
  }
  return undefined
}

/** The browser's IANA time zone, or UTC when unavailable. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** Every IANA zone the runtime knows, always including the given zone. */
export function timeZones(include?: string): ReadonlyArray<string> {
  const known: string[] =
    "supportedValuesOf" in Intl
      ? (Intl as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone")
      : ["UTC"]
  if (include && !known.includes(include)) return [include, ...known]
  return known
}

/** Format an instant for display in the task's time zone. */
export function formatInstant(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(value)
}
