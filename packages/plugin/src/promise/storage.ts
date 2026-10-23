import type { Schema } from "effect"
import type { StorageScanOptions, StorageScanResult } from "../storage.js"

/** Durable JSON storage bound by the host to this Workspace and Plugin identity. */
export interface StorageDomain {
  /** Read a JSON value, or undefined when the key does not exist. */
  readonly get: (key: string) => Promise<Schema.Json | undefined>
  /** Replace a key's JSON value; storage or invalid-input failures reject the Promise. */
  readonly set: (key: string, value: Schema.Json) => Promise<void>
  /** Remove a key; removing an absent key succeeds. */
  readonly remove: (key: string) => Promise<void>
  /** Read sorted matching keys; any supplied limit must be a positive safe integer. */
  readonly scan: (options: StorageScanOptions) => Promise<StorageScanResult>
}
