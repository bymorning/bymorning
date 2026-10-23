const relativeTimes = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const spend = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const cost = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 })
const integer = new Intl.NumberFormat("en-US")
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const mediumDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })

export function formatRelativeTime(date: Date, now = new Date()) {
  const seconds = (date.getTime() - now.getTime()) / 1_000
  if (Math.abs(seconds) < 60) return relativeTimes.format(Math.round(seconds), "second")
  const minutes = seconds / 60
  if (Math.abs(minutes) < 60) return relativeTimes.format(Math.round(minutes), "minute")
  const hours = minutes / 60
  if (Math.abs(hours) < 24) return relativeTimes.format(Math.round(hours), "hour")
  return relativeTimes.format(Math.round(hours / 24), "day")
}

export const formatDollars = (value: number) => dollars.format(value)

/** Per-request USD at four decimals, matching OpenCode's usage table. */
export const formatSpend = (value: number) => spend.format(value)

export const formatCompact = (value: number) => compact.format(value)

export const formatCost = (value: number) => cost.format(value)

export const formatInteger = (value: number) => integer.format(value)

export const formatShortDate = (date: Date) => shortDate.format(date)

export const formatMediumDate = (date: Date) => mediumDate.format(date)

export const formatMonthYear = (date: Date) => monthYear.format(date)
