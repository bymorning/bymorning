export * as Wildcard from "./wildcard.js"

/** OpenCode-compatible `*` and `?` matching with normalized path separators. */
export const match = (value: string, pattern: string) => {
  value = value.replaceAll("\\", "/")
  pattern = pattern.replaceAll("\\", "/")
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(value)
}
