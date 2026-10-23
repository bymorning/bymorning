/** Declares durable Instruction source identity and state schemas. */
export * as Instruction from "./instruction.js"
export * as InstructionSchema from "./instruction.js"

import { Schema } from "effect"
import { Event as EventSchema } from "./event.js"

const Updated = EventSchema.define("instruction-discovery.updated", {})
export const Event = { Updated, Definitions: EventSchema.inventory(Updated) }

/** Stable key of one Instruction source. */
export const Key = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/),
).pipe(Schema.brand("Instruction.Key"))
/** Stable key of one Instruction source. */
export type Key = typeof Key.Type

/** Lowercase SHA-256 hash of one canonical Instruction value. */
export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(Schema.brand("Instruction.Hash"))
/** Lowercase SHA-256 hash of one canonical Instruction value. */
export type Hash = typeof Hash.Type

/** Durable Instruction source hashes keyed by stable source key. */
export const Values = Schema.Record(Key, Hash)
/** Durable Instruction source hashes keyed by stable source key. */
export type Values = typeof Values.Type

/** Literal marking a confirmed source removal. */
export const Removed = Schema.Literal("removed")
/** Literal marking a confirmed source removal. */
export type Removed = typeof Removed.Type
/** Confirmed source removal value. */
export const removed = Removed.make("removed")

export const Delta = Schema.Record(Key, Schema.Union([Hash, Removed]))
/** Durable changes to Instruction source hashes. */
export type Delta = typeof Delta.Type
