import { Storage } from "@bymorning/core/storage"
import { Workspace } from "@bymorning/schema/workspace"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { layer } from "./fixture/storage.js"

const namespace = { workspaceID: Workspace.ID.make("wrk_json"), pluginID: "json" }

it.effect("rejects hidden custom JSON conversion without invoking it or overwriting stored content", () =>
  Effect.gen(function* () {
    const storage = (yield* Storage.Service).scope(namespace)
    yield* storage.set("value", { original: true })
    let invoked = false
    const value = { valid: true }
    Object.defineProperty(value, "toJSON", {
      value: () => {
        invoked = true
        return "converted"
      },
    })
    expect(yield* storage.set("value", value).pipe(Effect.flip)).toMatchObject({
      _tag: "Storage.InputError",
      operation: "set",
      reason: "json",
    })
    expect(invoked).toBe(false)
    expect(yield* storage.get("value")).toEqual({ original: true })
  }).pipe(Effect.provide(layer)),
)

it.effect("encodes the parsed JSON snapshot instead of evaluating boundary getters twice", () =>
  Effect.gen(function* () {
    const storage = (yield* Storage.Service).scope(namespace)
    let reads = 0
    const value = {}
    Object.defineProperty(value, "snapshot", { enumerable: true, get: () => (++reads === 1 ? "first" : undefined) })
    yield* storage.set("value", value)
    expect(reads).toBe(1)
    expect(yield* storage.get("value")).toEqual({ snapshot: "first" })
  }).pipe(Effect.provide(layer)),
)
