export * as Form from "./form.js"

import { Schema } from "effect"
import { ascending, SessionID } from "./identifier.js"
import { NonNegativeInt, optional, statics } from "./schema.js"

const IDSchema = Schema.String.check(Schema.isStartsWith("frm_")).pipe(Schema.brand("Form.ID"))
export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => ({ create: (id?: string) => schema.make(id ?? `frm_${ascending()}`) })),
)
export type ID = typeof ID.Type

export const Metadata = Schema.Record(Schema.String, Schema.Unknown).annotate({ identifier: "Form.Metadata" })
export type Metadata = typeof Metadata.Type

export const Option = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Form.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

// One visibility condition on a field. A field's `when` is a list of conditions that must all
// hold (AND) against the current answers for the field to be active. Semantics:
// - `value` must match the referenced field's type; against a multiselect answer, `eq` means
//   "selection includes value" and `neq` means "selection does not include value".
// - An unanswered referenced field makes the condition false for both ops.
// - `key` must reference a field defined earlier in the form's field list.
// Inactive fields are neither required nor answerable.
export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
}).annotate({ identifier: "Form.When" })
export interface When extends Schema.Schema.Type<typeof When> {}

const FieldBase = {
  key: Schema.String,
  title: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  required: Schema.Boolean.pipe(optional),
  when: Schema.Array(When).pipe(optional),
}

export const StringField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("string"),
  secret: Schema.Boolean.pipe(optional),
  multiline: Schema.Boolean.pipe(optional),
  format: Schema.Literals(["email", "uri", "date", "date-time"]).pipe(optional),
  minLength: NonNegativeInt.pipe(optional),
  maxLength: NonNegativeInt.pipe(optional),
  pattern: Schema.String.pipe(optional),
  placeholder: Schema.String.pipe(optional),
  default: Schema.String.pipe(optional),
  options: Schema.Array(Option).pipe(optional),
  custom: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Form.StringField" })
export interface StringField extends Schema.Schema.Type<typeof StringField> {}

export const NumberField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("number"),
  minimum: Schema.Number.pipe(optional),
  maximum: Schema.Number.pipe(optional),
  default: Schema.Number.pipe(optional),
}).annotate({ identifier: "Form.NumberField" })
export interface NumberField extends Schema.Schema.Type<typeof NumberField> {}

export const IntegerField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("integer"),
  minimum: Schema.Number.pipe(optional),
  maximum: Schema.Number.pipe(optional),
  default: Schema.Number.pipe(optional),
}).annotate({ identifier: "Form.IntegerField" })
export interface IntegerField extends Schema.Schema.Type<typeof IntegerField> {}

export const BooleanField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("boolean"),
  default: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Form.BooleanField" })
export interface BooleanField extends Schema.Schema.Type<typeof BooleanField> {}

export const MultiselectField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("multiselect"),
  options: Schema.Array(Option),
  minItems: NonNegativeInt.pipe(optional),
  maxItems: NonNegativeInt.pipe(optional),
  custom: Schema.Boolean.pipe(optional),
  default: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Form.MultiselectField" })
export interface MultiselectField extends Schema.Schema.Type<typeof MultiselectField> {}

export const ExternalField = Schema.Struct({
  key: Schema.String,
  type: Schema.Literal("external"),
  url: Schema.String,
  title: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Form.ExternalField" })
export interface ExternalField extends Schema.Schema.Type<typeof ExternalField> {}

export const Field = Schema.Union([
  StringField,
  NumberField,
  IntegerField,
  BooleanField,
  MultiselectField,
  ExternalField,
]).pipe(Schema.toTaggedUnion("type"), Schema.annotate({ identifier: "Form.Field" }))
export type Field = StringField | NumberField | IntegerField | BooleanField | MultiselectField | ExternalField

export const Fields = Schema.NonEmptyArray(Field).annotate({ identifier: "Form.Fields" })
export type Fields = typeof Fields.Type
export const Value = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]).annotate(
  {
    identifier: "Form.Value",
  },
)
export type Value = typeof Value.Type

export const Answer = Schema.Record(Schema.String, Value).annotate({ identifier: "Form.Answer" })
export type Answer = typeof Answer.Type

/** Return whether a conditional form field is active for the supplied answers. */
export function fieldActive(
  field: Exclude<Field, ExternalField>,
  answer: Readonly<Record<string, Value | undefined>>,
) {
  if (!field.when) return true
  return field.when.every((condition) => {
    const value = answer[condition.key]
    if (value === undefined) return false
    const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
    return condition.op === "eq" ? matches : !matches
  })
}

/** Return non-secret defaults declared by a form. */
export function defaults(fields: ReadonlyArray<Field>): Answer {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.type !== "external" && !(field.type === "string" && field.secret) && field.default !== undefined
        ? [[field.key, field.default]]
        : [],
    ),
  )
}

/** Remove unanswered and inactive values before a form answer crosses a boundary. */
export function normalize(fields: ReadonlyArray<Field>, answer: Readonly<Record<string, Value | undefined>>): Answer {
  const normalized: Record<string, Value> = {}
  for (const field of fields) {
    if (field.type !== "external" && !fieldActive(field, normalized)) continue
    const value = answer[field.key]
    if (value !== undefined && value !== "") normalized[field.key] = value
  }
  return normalized
}

/** Return the first form constraint violation, or `undefined` for a valid answer. */
export function validate(fields: ReadonlyArray<Field>, answer: Readonly<Record<string, Value | undefined>>) {
  const declared = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(answer)) if (!declared.has(key)) return `Unknown form field: ${key}`
  for (const field of fields) {
    const value = answer[field.key]
    if (field.type === "external") {
      if (value !== true) return `External form field must be acknowledged: ${field.key}`
      continue
    }
    const active = fieldActive(field, answer)
    if (value === undefined) {
      if (field.required && active) return `Missing required form field: ${field.key}`
      continue
    }
    if (!active) return `Form field is not active: ${field.key}`
    if (field.type === "string") {
      if (typeof value !== "string") return `Expected string for form field: ${field.key}`
      if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
      if (field.minLength !== undefined && value.length < field.minLength)
        return `Form field is too short: ${field.key}`
      if (field.maxLength !== undefined && value.length > field.maxLength)
        return `Form field is too long: ${field.key}`
      if (field.pattern !== undefined) {
        try {
          if (!new RegExp(field.pattern).test(value)) return `Form field does not match pattern: ${field.key}`
        } catch {
          return `Form field has invalid pattern: ${field.key}`
        }
      }
      if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return `Expected email for form field: ${field.key}`
      if (field.format === "uri" && !URL.canParse(value)) return `Expected URI for form field: ${field.key}`
      if (field.format === "date") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined
        if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
          return `Expected date for form field: ${field.key}`
      }
      if (field.format === "date-time" && Number.isNaN(new Date(value).getTime()))
        return `Expected date-time for form field: ${field.key}`
      if (field.options && !field.custom && !field.options.some((option) => option.value === value))
        return `Invalid option for form field: ${field.key}`
      continue
    }
    if (field.type === "number" || field.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) return `Expected number for form field: ${field.key}`
      if (field.type === "integer" && !Number.isInteger(value)) return `Expected integer for form field: ${field.key}`
      if (field.minimum !== undefined && value < field.minimum) return `Form field is too small: ${field.key}`
      if (field.maximum !== undefined && value > field.maximum) return `Form field is too large: ${field.key}`
      continue
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") return `Expected boolean for form field: ${field.key}`
      continue
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
      return `Expected string array for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minItems !== undefined && value.length < field.minItems)
      return `Too few selections for form field: ${field.key}`
    if (field.maxItems !== undefined && value.length > field.maxItems)
      return `Too many selections for form field: ${field.key}`
    if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item)))
      return `Invalid option for form field: ${field.key}`
  }
}

export const Info = Schema.Struct({
  id: ID,
  /** A Session owns conversational forms; caller-bound forms deliberately have no Session. */
  sessionID: SessionID.pipe(optional),
  title: Schema.String,
  metadata: Metadata.pipe(optional),
  fields: Fields,
}).annotate({ identifier: "Form.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("answered"), answer: Answer }),
  Schema.Struct({ status: Schema.Literal("cancelled") }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Form.State" })
export type State = typeof State.Type

export const Reply = Schema.Struct({ answer: Answer }).annotate({ identifier: "Form.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}
