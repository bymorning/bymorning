/** Declares the Session Config contract owned by this module. */
export * as SessionConfig from "./config.js"

import { Effect, Schema } from "effect"
import * as Agent from "../agent.js"
import * as Model from "../model.js"
import { NonNegativeInt } from "../schema.js"

/** Defaults applied when Session Config fields are absent. */
export const defaults = {
  compaction: {
    auto: true,
    buffer: 20_000,
    keep: { tokens: 15_000 },
  },
} as const

const Keep = Schema.Struct({
  tokens: NonNegativeInt.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaults.compaction.keep.tokens))),
})

const Compaction = Schema.Struct({
  auto: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaults.compaction.auto))),
  keep: Keep.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  buffer: NonNegativeInt.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaults.compaction.buffer))),
})

/** Session Config accepting sparse encoded fields and decoding all runtime defaults. */
export const Info = Schema.Struct({
  default_agent: Schema.optionalKey(Agent.ID),
  default_model: Schema.optionalKey(Model.Ref),
  compaction: Compaction.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
})

/** Fully resolved Session runtime Config. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
