/** Declares the Event contract owned by this module. */
export * as Event from "./event.js"
export * as EventSchema from "./event.js"

import { Schema } from "effect"
import { statics } from "./schema.js"

type Fields = Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>

/** Stable identity of one live Event occurrence. */
export const ID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Event.ID"))
export type ID = typeof ID.Type

/** Epoch-millisecond occurrence time. */
export const Created = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

/** Typed definition of one live Event. */
export type Definition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
> = Schema.Top & { readonly type: Type; readonly data: DataSchema }

/** Typed data declared by an Event definition. */
export type Data<D extends Definition> = Schema.Schema.Type<D["data"]>

/** One delivered Event occurrence. */
export type Payload<D extends Definition = Definition> = D extends Definition
  ? { readonly id: ID; readonly type: D["type"]; readonly created: number; readonly data: Data<D> }
  : never

/** Aggregate-neutral canonical Event envelope. */
export const Envelope = Schema.Struct({ id: ID, type: Schema.String, created: Created, data: Schema.Unknown })
export type Envelope = typeof Envelope.Type

/** Define one live Event. */
export function define<const Type extends string, const EventFields extends Fields>(type: Type, fields: EventFields) {
  const data = Schema.Struct(fields)
  return Schema.Struct({ id: ID, type: Schema.Literal(type), created: Created, data }).pipe(
    statics(() => ({ type, data })),
  )
}

/** Register an Event definition inventory while preserving its tuple type. */
export function inventory<const Definitions extends ReadonlyArray<Definition>>(...definitions: Definitions) {
  return Object.freeze(definitions)
}
