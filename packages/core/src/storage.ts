import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import type { Workspace } from "@bymorning/schema/workspace"
import { ConfigError, ID, InvalidPathError, OperationError } from "@bymorning/schema/storage"
import type { DecodeError, Info, InputError, ScanInput, ScanResult } from "@bymorning/schema/storage"
import { StorageKV } from "./storage/kv.js"
import { serializePath } from "./storage/path.js"

export {
  ID,
  Info,
  ScanInput,
  KVEntry,
  ScanResult,
  ConfigError,
  InvalidPathError,
  OperationError,
  InputError,
  DecodeError,
} from "@bymorning/schema/storage"
export { filesystem } from "./storage/filesystem.js"
export { memory } from "./storage/memory.js"

/** One object-key segment or a named pair of object-key segments. */
export type PathPart = string | Readonly<Record<string, string>>

/** Provider-independent object path. */
export type Path = ReadonlyArray<PathPart>

/** Declares a provider-independent object path without widening named segments. */
export const path = (...parts: Path): Path => parts

/** Metadata stored with an object. */
export interface Metadata {
  readonly contentType?: string
  readonly contentLength?: number
  readonly etag?: string
}

/** Streaming object write; source failures are reported as Storage operation failures. */
export interface SetInput {
  readonly body: Stream.Stream<Uint8Array, unknown>
  readonly contentType?: string
  readonly contentLength?: number
}

/** Streaming object read. */
export interface Entry {
  readonly metadata: Metadata
  readonly body: Stream.Stream<Uint8Array, OperationError>
}

/** Byte window requested from an object. */
export interface RangeInput {
  readonly offset: number
  readonly length: number
}

/** Object metadata returned by a recursive prefix listing. */
export interface ItemMetadata {
  readonly contentLength?: number
  readonly etag?: string
}

/** One object returned by a recursive prefix listing. */
export interface Item {
  readonly key: string
  readonly metadata: ItemMetadata
  readonly marker: boolean
}

/** Provider-independent object storage operations. */
export interface Object {
  /** Writes an object, replacing an existing object at the same path. */
  readonly set: (path: Path, input: SetInput) => Effect.Effect<void, InvalidPathError | OperationError>
  /** Reads an object, returning None when it does not exist. */
  readonly get: (path: Path) => Effect.Effect<Option.Option<Entry>, InvalidPathError | OperationError>
  /** Reads at most one byte window without materializing the rest of the object. */
  readonly getRange: (
    path: Path,
    input: RangeInput,
  ) => Effect.Effect<Option.Option<Entry>, InvalidPathError | OperationError>
  /** Removes an object. Missing objects are treated as already removed. */
  readonly remove: (path: Path) => Effect.Effect<void, InvalidPathError | OperationError>
  /** Recursively lists objects beneath a prefix in stable key order. */
  readonly list: (prefix: Path) => Effect.Effect<ReadonlyArray<Item>, InvalidPathError | OperationError>
}

/** Converts a validated path to its provider object key. */
export const key = (path: Path): Effect.Effect<string, InvalidPathError> =>
  Effect.map(serializePath(path), ({ key }) => key)

/** Provider operations and backing-store initialization. */
export interface Driver extends Object {
  /** Initialize the selected destination before any Application consumer runs. */
  readonly init: Effect.Effect<void, OperationError>
}

/** A provider factory whose resources belong to the acquisition scope. */
export interface Provider {
  /** Stable implementation identity used by configuration and errors. */
  readonly id: ID
  /** Secret-free display name for provider inventory. */
  readonly name: string
  /** Acquire a driver and register owned resource finalizers in the caller's scope. */
  readonly open: Effect.Effect<Driver, OperationError, Scope.Scope>
}

/** Construction-time registration and default selection. */
export interface Editor {
  /** Register a lazy provider definition; duplicate IDs fail Layer acquisition. */
  readonly add: (provider: Provider) => void
  /** Read or replace the composition default while configure executes. */
  readonly default: { readonly get: () => ID | undefined; readonly set: (id: ID) => void }
}

/** JSON operations bound to one namespace and provider. */
export interface KV {
  /** Read JSON, returning undefined for a missing key and typed errors for unreadable content. */
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined, OperationError | DecodeError>
  /** Replace JSON at a key; invalid runtime values fail before writing. */
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void, OperationError | InputError>
  /** Remove a value, succeeding when the key is already absent. */
  readonly remove: (key: string) => Effect.Effect<void, OperationError>
  /** List decoded keys in order with prefix filtering and an exclusive cursor. */
  readonly scan: (input: ScanInput) => Effect.Effect<ScanResult, OperationError | DecodeError | InputError>
}

/** The identities owning a plugin namespace. */
export interface Namespace {
  readonly workspaceID: Workspace.ID
  readonly pluginID: string
}

/** Selected storage and its namespace-bound views. */
export interface Interface {
  /** Return the immutable registered provider inventory, sorted by ID. */
  readonly list: () => Effect.Effect<readonly Info[]>
  /** Return the effective selected provider after the configuration override. */
  readonly default: () => Effect.Effect<Info>
  /** Stream objects through the Application's selected provider. */
  readonly object: Object
  /** Bind Workspace and Plugin identity synchronously without I/O or resource acquisition. */
  readonly scope: (namespace: Namespace) => KV
}

/** Application-wide storage authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Storage") {}

/** Typed provider construction inputs supplied by the application root. */
export interface Options {
  /** Register providers and declare a default before selected-provider acquisition. */
  readonly configure: (editor: Editor) => void
  /** Override the declared default for this Application lifetime. */
  readonly selection?: ID
}

/** Resolve and initialize only the selected provider in the Layer scope. */
export const layer = (options: Options): Layer.Layer<Service, ConfigError | OperationError> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const providers = new Map<ID, Provider>()
      let defaultID: ID | undefined
      let duplicate: ID | undefined
      options.configure({
        add: (provider) => {
          if (providers.has(provider.id)) duplicate = provider.id
          providers.set(provider.id, provider)
        },
        default: {
          get: () => defaultID,
          set: (id) => {
            defaultID = id
          },
        },
      })
      if (duplicate !== undefined)
        return yield* new ConfigError({
          message: "Duplicate storage provider",
          reason: "duplicate",
          providerID: duplicate,
        })
      // Snapshot every definition before acquisition can yield to a retained editor callback.
      const catalog = new Map([...providers.values()].map(({ id, name, open }) => [id, { id, name, open }]))
      if (defaultID === undefined)
        return yield* new ConfigError({ message: "No storage default is registered", reason: "default" })
      const selected = options.selection ?? defaultID
      const provider = catalog.get(selected)
      if (provider === undefined)
        return yield* new ConfigError({ message: "Unknown storage provider", reason: "unknown", providerID: selected })
      const info = globalThis.Object.freeze({ id: provider.id, name: provider.name })
      const inventory = globalThis.Object.freeze(
        [...catalog.values()]
          .map(({ id, name }) => globalThis.Object.freeze({ id, name }))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      )
      const driver = yield* provider.open
      yield* driver.init
      const object = globalThis.Object.freeze({
        set: driver.set,
        get: driver.get,
        getRange: driver.getRange,
        remove: driver.remove,
        list: driver.list,
      })
      return Service.of({
        list: Effect.fn("Storage.list")(() => Effect.succeed(inventory)),
        default: Effect.fn("Storage.default")(() => Effect.succeed(info)),
        object,
        scope: (namespace) => StorageKV.make(namespace, object, provider.id),
      })
    }),
  )

/** Application graph node for configured Storage. */
/** Build one configured Storage provider implementation. */
export const configured = (options: Options) => makeGlobalNode({ service: Service, layer: layer(options), deps: [] })

/** Host-selected process-global Storage provider. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)

/** Compatibility graph placeholder; acquisition fails unless the host supplies Storage. */
export const defaultLayer = layer({ configure: () => {} })
/** Stable identity for legacy graph replacement seams. */
export const defaultNode = makeGlobalNode({ service: Service, layer: defaultLayer, deps: [] })

export * as Storage from "./storage.js"
