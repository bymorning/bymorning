import { Schema } from "effect"

/** A storage implementation identity. */
export const ID = Schema.NonEmptyString.pipe(Schema.brand("Storage.ID"))
/** A storage implementation identity. */
export type ID = typeof ID.Type

/** Secret-free provider information. */
export const Info = Schema.Struct({ id: ID, name: Schema.String })
/** Secret-free provider information. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Prefix selection with an exclusive last-key cursor. */
export const ScanInput = Schema.Struct({
  prefix: Schema.String,
  after: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Number),
})
/** Prefix selection with an exclusive last-key cursor. */
export interface ScanInput extends Schema.Schema.Type<typeof ScanInput> {}

/** A JSON value and its namespace-relative key. */
export const KVEntry = Schema.Struct({ key: Schema.String, value: Schema.Json })
/** A JSON value and its namespace-relative key. */
export interface KVEntry extends Schema.Schema.Type<typeof KVEntry> {}

/** One page of JSON values. */
export const ScanResult = Schema.Struct({ entries: Schema.Array(KVEntry), next: Schema.optionalKey(Schema.String) })
/** One page of JSON values. */
export interface ScanResult extends Schema.Schema.Type<typeof ScanResult> {}

/** Provider registration or selection is invalid. */
export class ConfigError extends Schema.TaggedError<ConfigError>()("Storage.ConfigError", {
  message: Schema.String,
  reason: Schema.Literals(["default", "unknown", "duplicate"]),
  providerID: Schema.optionalKey(ID),
}) {}

/** A path cannot be represented as an object key. */
export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()("Storage.InvalidPathError", {
  reason: Schema.Literals(["empty", "object", "segment"]),
  index: Schema.Int,
}) {}

/** A provider operation or byte stream failed. */
export class OperationError extends Schema.TaggedError<OperationError>()("Storage.OperationError", {
  message: Schema.String,
  providerID: ID,
  operation: Schema.Literals(["init", "set", "get", "list", "remove"]),
  cause: Schema.Defect(),
}) {}

/** JSON input or scan limit is invalid at a runtime boundary. */
export class InputError extends Schema.TaggedError<InputError>()("Storage.InputError", {
  message: Schema.String,
  operation: Schema.Literals(["set", "scan"]),
  reason: Schema.Literals(["json", "limit"]),
}) {}

/** Stored content is not a JSON value. */
export class DecodeError extends Schema.TaggedError<DecodeError>()("Storage.DecodeError", {
  message: Schema.String,
  providerID: ID,
}) {}

export * as Storage from "./storage.js"
