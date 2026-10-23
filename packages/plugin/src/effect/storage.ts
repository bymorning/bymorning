import type { Storage } from "@bymorning/schema/storage"
import type { Effect, Schema } from "effect"
import type { StorageScanOptions, StorageScanResult } from "../storage.js"

/** Durable JSON storage bound by the host to this Workspace and Plugin identity. */
export interface StorageDomain {
  /** Read a JSON value, or undefined when the key does not exist. */
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined, Storage.OperationError | Storage.DecodeError>
  /** Replace a key's JSON value; invalid runtime JSON fails with InputError. */
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void, Storage.OperationError | Storage.InputError>
  /** Remove a key; removing an absent key succeeds. */
  readonly remove: (key: string) => Effect.Effect<void, Storage.OperationError>
  /** Read sorted matching keys; any supplied limit must be a positive safe integer. */
  readonly scan: (
    options: StorageScanOptions,
  ) => Effect.Effect<StorageScanResult, Storage.OperationError | Storage.DecodeError | Storage.InputError>
}
