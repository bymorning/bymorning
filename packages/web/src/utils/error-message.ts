const text = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value : undefined)

/**
 * Readable message for a failed request. Protocol errors carry their text in
 * `message` (most) or `error` (`Protocol.InputError`, whose `message` is empty),
 * and transport failures carry only a reason code, so those use the fallback.
 */
export const errorMessage = (cause: unknown, fallback: string) => {
  if (typeof cause !== "object" || cause === null) return fallback
  if (cause instanceof Error && cause.name === "ClientError") return fallback
  const fields = cause as { readonly message?: unknown; readonly error?: unknown }
  return text(fields.message) ?? text(fields.error) ?? fallback
}
