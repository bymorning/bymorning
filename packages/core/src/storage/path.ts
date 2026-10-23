import { Effect } from "effect"
import { InvalidPathError } from "@bymorning/schema/storage"
import type { Path } from "../storage.js"

/** Encode the existing object path and directory-marker convention. */
export const serializePath = Effect.fnUntraced(function* (path: Path) {
  if (path.length === 0) return yield* new InvalidPathError({ reason: "empty", index: -1 })
  const segments = Array<string>()
  for (const [index, part] of path.entries()) {
    if (typeof part === "string") {
      if (!isSafeSegment(part)) return yield* new InvalidPathError({ reason: "segment", index })
      segments.push(part)
      continue
    }
    const entries = Object.entries(part)
    if (entries.length !== 1) return yield* new InvalidPathError({ reason: "object", index })
    const entry = entries[0]
    if (entry === undefined) return yield* new InvalidPathError({ reason: "object", index })
    const [name, value] = entry
    if (!isSafeSegment(name) || !isSafeSegment(value)) return yield* new InvalidPathError({ reason: "segment", index })
    segments.push(name, value)
  }
  const marker = typeof path[path.length - 1] !== "string"
  return { key: `${segments.join("/")}${marker ? "/" : ""}`, marker }
})

const isSafeSegment = (segment: unknown): segment is string =>
  typeof segment === "string" && segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/")
