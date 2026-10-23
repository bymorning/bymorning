/** Renders supported SDK and provider failures without stringifying unknown payloads. */
export function errorText(error: unknown): string {
  return message(error, 0) ?? "Request failed."
}

function message(value: unknown, depth: number): string | undefined {
  if (typeof value === "string") return value || undefined
  if (value instanceof Error && value.message) return value.message
  if (!value || typeof value !== "object" || depth === 2) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.message === "string" && record.message) return record.message
  return message(record.cause, depth + 1) ?? message(record.error, depth + 1)
}
