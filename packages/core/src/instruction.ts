/** Exposes the pure Instruction engine owned by this module. */
export * as Instruction from "./instruction.js"

import { Instruction } from "@bymorning/schema/instruction"
import { createHash } from "node:crypto"
import { Data, Effect, Option, Schema } from "effect"

export const Key = Instruction.Key
export type Key = Instruction.Key
export const Hash = Instruction.Hash
export type Hash = Instruction.Hash
export const Values = Instruction.Values
export type Values = Instruction.Values
export const Delta = Instruction.Delta
export type Delta = Instruction.Delta

type NonValue = Data.TaggedEnum<{ Unavailable: {}; Removed: {} }>
const NonValue = Data.taggedEnum<NonValue>()

/** The read failed temporarily; the stored value stands. */
export const unavailable = NonValue.Unavailable()
export type Unavailable = typeof unavailable

/** An observed absence: the source exists but its value is gone. */
export const removed = NonValue.Removed()
export type Removed = typeof removed

/** One composable Instruction source over canonical JSON. */
export interface Source {
  readonly key: Key
  readonly read: Effect.Effect<Schema.Json | Unavailable | Removed>
  readonly initial: (value: Schema.Json) => string | undefined
  readonly changed: (previous: Schema.Json, current: Schema.Json) => string | undefined
  readonly removed: (previous: Schema.Json) => string | undefined
}

export declare namespace Source {
  export interface Definition<A> {
    readonly key: Key
    readonly codec: Schema.Codec<A, Schema.Json>
    readonly read: Effect.Effect<A | Unavailable | Removed>
    readonly render: {
      readonly initial: (current: A) => string
      readonly changed: (previous: A, current: A) => string
      readonly removed?: (previous: A) => string
    }
  }
}

export type List = ReadonlyArray<Source>
export type ReadResult = ReadonlyArray<{
  readonly key: Key
  readonly value: Schema.Json | Unavailable | Removed
}>

export interface Admission {
  readonly delta: Delta
  readonly blobs: Readonly<Record<string, Schema.Json>>
}

/** Initial observation cannot proceed while a source is unavailable. */
export class InitializationError extends Schema.TaggedError<InitializationError>()("Instruction.InitializationError", {
  keys: Schema.Array(Key),
}) {
  override get message() {
    return `Instruction initialization blocked by unavailable sources: ${this.keys.join(", ")}`
  }
}

/** Two composed sources claimed the same stable key. */
export class KeyError extends Schema.TaggedError<KeyError>()("Instruction.KeyError", { key: Key }) {
  override get message() {
    return `Duplicate instruction key: ${this.key}`
  }
}

export const empty = [] as List

/** Close a typed definition into one erased source. */
export function make<A>(source: Source.Definition<A>): List {
  const decode = Schema.decodeUnknownOption(source.codec)
  const encode = Schema.encodeSync(source.codec)
  const initial = (value: A) => requireText(source.key, "initial", source.render.initial(value))
  const decodeValue = (value: Schema.Json) => Option.getOrUndefined(decode(value))
  return [
    {
      key: source.key,
      read: source.read.pipe(
        Effect.map((value) => {
          if (isUnavailable(value)) return unavailable
          if (isRemoved(value)) return removed
          return encode(value)
        }),
      ),
      initial: (value) => {
        const decoded = decodeValue(value)
        return decoded === undefined ? undefined : initial(decoded)
      },
      changed: (previous, current) => {
        const before = decodeValue(previous)
        const after = decodeValue(current)
        if (after === undefined) return undefined
        if (before === undefined) return initial(after)
        return requireText(source.key, "changed", source.render.changed(before, after))
      },
      removed: (previous) => {
        const decoded = decodeValue(previous)
        return decoded === undefined || source.render.removed === undefined
          ? undefined
          : requireText(source.key, "removed", source.render.removed(decoded))
      },
    },
  ]
}

export function combine(values: ReadonlyArray<List>): List {
  const sources = values.flat()
  const keys = new Set<Key>()
  for (const source of sources) {
    if (keys.has(source.key)) throw new KeyError({ key: source.key })
    keys.add(source.key)
  }
  return sources
}

export function read(value: List): Effect.Effect<ReadResult> {
  return Effect.forEach(
    value,
    (source) => source.read.pipe(Effect.map((observed) => ({ key: source.key, value: observed }))),
    { concurrency: "unbounded" },
  )
}

export function diff(observed: ReadResult, previous?: Values): Effect.Effect<Admission, InitializationError> {
  const blocked = previous ? [] : observed.flatMap((entry) => (isUnavailable(entry.value) ? [entry.key] : []))
  if (blocked.length > 0) return Effect.fail(new InitializationError({ keys: blocked }))
  const delta = Object.fromEntries<Hash | Instruction.Removed>([])
  const blobs = Object.fromEntries<Schema.Json>([])
  for (const entry of observed) {
    if (isUnavailable(entry.value)) continue
    if (isRemoved(entry.value)) {
      if (previous && Object.hasOwn(previous, entry.key)) delta[entry.key] = Instruction.removed
      continue
    }
    const next = hash(entry.value)
    if (previous?.[entry.key] === next) continue
    delta[entry.key] = next
    blobs[next] = entry.value
  }
  return Effect.succeed({ delta, blobs })
}

export function renderInitial(value: List, values: Readonly<Record<string, Schema.Json>>) {
  return render(
    value.flatMap((source) => {
      const entry = Object.entries(values).find(([key]) => key === source.key)
      if (entry === undefined) return []
      const text = source.initial(entry[1])
      return text === undefined ? [] : [text]
    }),
  )
}

export function renderUpdate(
  value: List,
  previous: Readonly<Record<string, Schema.Json>>,
  delta: Readonly<Record<string, Option.Option<Schema.Json>>>,
) {
  return render(
    value.flatMap((source) => {
      const entry = Object.entries(delta).find(([key]) => key === source.key)
      if (entry === undefined) return []
      const current = entry[1]
      if (Option.isNone(current)) {
        const before = Object.entries(previous).find(([key]) => key === source.key)
        if (before === undefined) return []
        const text = source.removed(before[1])
        return text === undefined ? [] : [text]
      }
      const next = current.value
      const before = Object.entries(previous).find(([key]) => key === source.key)
      const text = before === undefined ? source.initial(next) : source.changed(before[1], next)
      return text === undefined ? [] : [text]
    }),
  )
}

export function hash(value: Schema.Json) {
  return Hash.make(createHash("sha256").update(canonical(value)).digest("hex"))
}

export function applyHashDelta(values: Values, delta: Delta): Values {
  const result = Object.assign(Object.fromEntries<Hash>([]), values)
  for (const [key, value] of Object.entries(delta)) {
    if (value === Instruction.removed) delete result[key]
    else result[key] = value
  }
  return result
}

export function diffByKey<A>(
  previous: ReadonlyArray<A>,
  current: ReadonlyArray<A>,
  key: (value: A) => string,
  changed: (previous: A, current: A) => boolean,
) {
  const currentKeys = new Set(current.map(key))
  const previousByKey = new Map(previous.map((value) => [key(value), value] as const))
  return {
    added: current.filter((value) => !previousByKey.has(key(value))),
    removed: previous.filter((value) => !currentKeys.has(key(value))),
    changed: current.flatMap((value) => {
      const before = previousByKey.get(key(value))
      return before === undefined || !changed(before, value) ? [] : [{ previous: before, current: value }]
    }),
  }
}

function render(parts: ReadonlyArray<string>) {
  return parts.join("\n\n")
}

function isUnavailable(value: unknown): value is Unavailable {
  return value === unavailable
}

function isRemoved(value: unknown): value is Removed {
  return value === removed
}

function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function requireText(key: Key, kind: string, text: string) {
  if (text.length === 0) throw new Error(`Instruction source ${key} rendered an empty ${kind}`)
  return text
}
