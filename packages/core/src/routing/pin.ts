export * as Pin from "./pin.js"

import type { Workspace } from "@bymorning/schema/workspace"
import { Cause, Clock, Effect } from "effect"
import type { KV } from "../kv.js"

/** Pins older than this are ignored and eventually removed. */
export const ttl = 60 * 60 * 1_000

/**
 * Returned by `get` when the pin store itself could not be read, as distinct from a turn that has
 * no pin: the caller judges again rather than trusting the default Tier.
 */
export const unreadable = Symbol("routing/pin/unreadable")
export type Unreadable = typeof unreadable

const prefix = (workspaceID: Workspace.ID) => `routing/pin/${workspaceID}/`

const hash = (text: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  })

/** Storage key for one Workspace, routing target, and conversation turn. */
export const key = (workspaceID: Workspace.ID, target: string, turn: string) =>
  hash(`${target}\u0000${turn}`).pipe(Effect.map((digest) => `${prefix(workspaceID)}${digest}`))

/**
 * Degrade a pin-store failure to a warning instead of failing the request; the KV layer dies on
 * database errors, so typed handling alone cannot see this. Interrupts still propagate.
 */
const degrade = <A>(message: string, fallback: A) =>
  Effect.catchCause((cause: Cause.Cause<never>) =>
    Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(message, { cause }).pipe(Effect.as(fallback)),
  )

/** The Tier pinned for a turn, when present and unexpired; `unreadable` when the store failed. */
export const get = Effect.fn("Routing.pin.get")(function* (kv: KV.Interface, key: string) {
  const value = yield* kv.get(key).pipe(degrade("Routing pin read failed; judging again", unreadable))
  if (value === unreadable) return unreadable
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const { tier, at } = value as { tier?: unknown; at?: unknown }
  if (typeof tier !== "string" || typeof at !== "number") return undefined
  return (yield* Clock.currentTimeMillis) - at > ttl ? undefined : tier
})

/** Pin a turn's Tier and opportunistically remove a bounded batch of expired pins. */
export const set = Effect.fn("Routing.pin.set")(function* (
  kv: KV.Interface,
  workspaceID: Workspace.ID,
  key: string,
  tier: string,
) {
  yield* Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    yield* kv.set(key, { tier, at: now })
    const { entries } = yield* kv.scan({ prefix: prefix(workspaceID), limit: 50 })
    yield* Effect.forEach(
      entries.filter((entry) => {
        const at = (entry.value as { at?: unknown } | null)?.at
        return typeof at !== "number" || now - at > ttl
      }),
      (entry) => kv.remove(entry.key),
      { discard: true },
    )
  }).pipe(degrade("Routing pin write failed; the turn is left unpinned", undefined))
})
