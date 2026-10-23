import { describe, expect, it } from "vitest"

import { defaultPreset, describe as describeCron, fromCron, toCron, validate, type Preset } from "./schedule"

describe("toCron", () => {
  it("builds each preset shape", () => {
    expect(toCron({ ...defaultPreset, frequency: "daily", time: "08:05" })).toBe("5 8 * * *")
    expect(toCron({ ...defaultPreset, frequency: "weekdays", time: "08:00" })).toBe("0 8 * * 1-5")
    expect(toCron({ ...defaultPreset, frequency: "weekly", time: "16:30", weekday: 5 })).toBe("30 16 * * 5")
    expect(toCron({ ...defaultPreset, frequency: "monthly", time: "09:00", day: 14 })).toBe("0 9 14 * *")
    expect(toCron({ ...defaultPreset, frequency: "custom", cron: "  0   9 * * 1  " })).toBe("0 9 * * 1")
  })
})

describe("fromCron round-trips", () => {
  const cases: ReadonlyArray<readonly [Preset, string]> = [
    [{ ...defaultPreset, frequency: "daily", time: "08:05" }, "5 8 * * *"],
    [{ ...defaultPreset, frequency: "weekdays", time: "08:00" }, "0 8 * * 1-5"],
    [{ ...defaultPreset, frequency: "weekly", time: "16:30", weekday: 5 }, "30 16 * * 5"],
    [{ ...defaultPreset, frequency: "monthly", time: "09:00", day: 14 }, "0 9 14 * *"],
  ]

  it.each(cases)("round-trips %s", (preset) => {
    const parsed = fromCron(toCron(preset))
    expect(parsed.frequency).toBe(preset.frequency)
    expect(parsed.time).toBe(preset.time)
    expect(parsed.weekday).toBe(preset.weekday)
    expect(parsed.day).toBe(preset.day)
  })

  it("recognises the same presets written by hand", () => {
    expect(fromCron("5 8 * * *")).toMatchObject({ frequency: "daily", time: "08:05" })
    expect(fromCron("30 16 * * 5")).toMatchObject({ frequency: "weekly", time: "16:30", weekday: 5 })
    expect(fromCron("0 9 28 * *")).toMatchObject({ frequency: "monthly", time: "09:00", day: 28 })
  })

  it("treats anything else as custom and keeps the raw expression", () => {
    expect(fromCron("*/15 * * * *")).toMatchObject({ frequency: "custom", cron: "*/15 * * * *" })
    expect(fromCron("0 8 * JAN 1")).toMatchObject({ frequency: "custom", cron: "0 8 * JAN 1" })
    expect(fromCron("not a cron")).toMatchObject({ frequency: "custom", cron: "not a cron" })
    expect(fromCron("0 9 29 * *")).toMatchObject({ frequency: "custom" })
  })
})

describe("describe", () => {
  it("labels the known presets", () => {
    expect(describeCron("0 * * * *")).toBe("Every hour")
    expect(describeCron("15 * * * *")).toBe("Every hour at :15")
    expect(describeCron("*/5 * * * *")).toBe("*/5 * * * *")
    expect(describeCron("0 8 * * *")).toBe("Daily at 8:00 AM")
    expect(describeCron("0 8 * * 1-5")).toBe("Weekdays at 8:00 AM")
    expect(describeCron("30 16 * * 5")).toBe("Every Friday at 4:30 PM")
    expect(describeCron("0 9 1 * *")).toBe("Monthly on the 1st at 9:00 AM")
    expect(describeCron("0 9 2 * *")).toBe("Monthly on the 2nd at 9:00 AM")
    expect(describeCron("0 9 3 * *")).toBe("Monthly on the 3rd at 9:00 AM")
    expect(describeCron("0 9 11 * *")).toBe("Monthly on the 11th at 9:00 AM")
    expect(describeCron("0 9 22 * *")).toBe("Monthly on the 22nd at 9:00 AM")
  })

  it("falls back to the raw expression for custom crons", () => {
    expect(describeCron("*/15 * * * *")).toBe("*/15 * * * *")
  })
})

describe("validate", () => {
  it("requires five fields", () => {
    expect(validate("0 8 * *", "UTC")).toBe("Enter a five-field cron schedule.")
    expect(validate("0 8 * * * *", "UTC")).toBe("Enter a five-field cron schedule.")
  })

  it("rejects an unparseable cron", () => {
    expect(validate("not a cron at all", "UTC")).toBe("Enter a valid cron schedule.")
  })

  it("rejects an invalid time zone", () => {
    expect(validate("0 8 * * *", "Not/AZone")).toBe("Select a valid time zone.")
  })

  it("rejects schedules running more than once an hour", () => {
    expect(validate("*/15 * * * *", "UTC")).toBe("Runs must be at least one hour apart.")
    expect(validate("0,30 8 * * *", "UTC")).toBe("Runs must be at least one hour apart.")
  })

  it("accepts hourly and slower schedules", () => {
    expect(validate("0 * * * *", "UTC")).toBeUndefined()
    expect(validate("0 8 * * 1-5", "America/New_York")).toBeUndefined()
  })
})
