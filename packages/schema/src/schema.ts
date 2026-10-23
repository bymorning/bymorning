import { Option, Schema, SchemaGetter, SchemaTransformation } from "effect"

const canonicalISO = Schema.makeFilter<string>((value) => {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value ? true : "Expected a canonical ISO timestamp"
})

/** A Date encoded as a canonical ISO timestamp. */
export const Timestamp = Schema.String.check(canonicalISO).pipe(
  Schema.decodeTo(Schema.Date, SchemaTransformation.dateFromString),
)

/** A normalized absolute filesystem path. */
export const AbsolutePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")),
)

/** A nonnegative integer within JavaScript's safe integer range. */
export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

export const PositiveInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))
