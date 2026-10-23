# Storage design

Status: implemented; approved interface and lifecycle.

## Authority

`Storage` owns provider selection, provider-independent object operations, namespace
isolation, and the JSON key/value view supplied as `ctx.storage`. The Plugin host
supplies Workspace and Plugin identity. A Storage Provider owns technology-specific
I/O and resource cleanup.

The confirmed domain definitions are in `CONTEXT.md`. This document records the
approved interface and lifecycle.

## Existing patterns and reuse

The reference is `packages/core/src/websearch.ts` and its plugin draft:

| WebSearch pattern                                 | Storage design                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Named implementations registered with `draft.add` | Provider factories registered with `draft.add`, identified as `filesystem` or `s3` |
| `draft.default.get/set`                           | Same draft shape, selecting one provider ID                                        |
| Config overrides the registered default           | Application config overrides the registered default                                |
| Provider inventory and default inspection         | `list()` and `default()` return secret-free provider information                   |
| `X.Interface`, `X.Service`, Layer and node        | Same Effect service and composition conventions                                    |
| Workspace-scoped, replayable plugin registrations | Application-lifetime registrations established during Layer construction           |

Storage is initialized before Workspace recovery, and Project plugin loading itself
depends on Storage. Therefore the initial provider cannot depend on Workspace plugin
activation or Workspace configuration. The construction draft follows WebSearch's
vocabulary, but it is consumed once. A mutable `State.Transformable` registry would
add reload and removal behavior that this lifetime does not need.

Pre-migration implementations reused:

- `packages/server/src/adapters/storage-s3.ts`: move its streaming S3, multipart
  upload, ranges, pagination, cancellation, and client ownership into the S3
  provider (now `backends/aws/src/s3.ts` in the AWS backend package).
- `packages/server/src/adapters/storage-filesystem.ts`: move its persistent local
  objects, atomic replacement, ranges, and startup tool-output cleanup into private
  `packages/core/src/storage/filesystem.ts`.
- `packages/core/src/storage.ts`: path semantics and memory implementation.
- `packages/core/src/plugin-storage.ts`: existing namespace layout, JSON conversion,
  and scan behavior, moved inside Storage and given typed failures.

The filesystem provider supplies persistent KV through the JSON view. A distinct SQLite
engine is not required to achieve local KV; choosing one would be a separate adapter
decision.

## Configuration and lifecycle

Application configuration selects the actual provider directly:

```json
{
  "storage": {
    "provider": "s3"
  }
}
```

`storage.provider` has the same selector meaning as `websearch.provider`. The public
config accepts `filesystem` or `s3`; IDs identify implementation kinds directly,
without user-defined aliases, a destination map, or a separate `type` field.

`packages/schema/src/config/storage.ts` defines `ConfigStorage.Info` with one field:
`provider: "filesystem" | "s3"`. The application-level `storage` field is optional;
omitting it uses the composition's registered default.

Defaults and provider construction settings:

| Setting                              | Source/default                                                   |
| ------------------------------------ | ---------------------------------------------------------------- |
| Local application's default provider | `filesystem`                                                     |
| AWS application's default provider   | `s3`                                                             |
| Filesystem directory                 | `.bymorning/local/storage` under the application root            |
| Tool-output retention                | Existing seven-day policy                                        |
| S3 bucket                            | `STORAGE_BUCKET`, or SST's linked `Resource.Storage.name` in AWS |
| S3 region                            | `AWS_REGION`, otherwise the AWS SDK's normal resolution          |
| S3 credentials                       | Existing AWS SDK credential resolution                           |

Bucket names cannot have a universal default: selecting S3 without a configured or
linked bucket produces a typed application configuration error. S3 is AWS-host only:
the local host refuses an explicit `s3` selection with a configuration error. AWS
resource links are interpreted only by the AWS composition root. Unselected providers
do not require credentials or settings to be resolved. The composition registers
providers whose construction settings are available; an explicit S3 selection requires
resolving its bucket before Storage construction. Application tests inject temporary
directories explicitly.

The existing local `storage.directory` shape is a compatibility input normalized at
startup during migration. New authored configuration uses the single `provider`
selector. A local configuration file with no storage selector retains its previous
file-relative `.bymorning/local/storage` default; an explicit new selector uses the
application-root default unless a compatibility directory is supplied. Explicit
construction inputs remain available to application hosts and tests;
Storage's service Layer receives typed provider factories. Its built-in factory
constructors accept technology-specific construction settings through the public
Storage entrypoint; operation callers never handle SDK configuration or local paths.

Lifecycle rules:

1. Parse configuration, build the provider catalog, and resolve the selection.
2. An explicit selection overrides the registered default. Missing defaults, unknown
   effective selections, and duplicate provider IDs are typed configuration errors.
   The draft must declare a default ID, but an overridden default need not be registered
   when its construction settings are unavailable.
3. Acquire and initialize only the selected provider, once per Application Layer.
   Inventory reports registered definitions, not health checks of every destination.
4. Finish Storage initialization before Workspace recovery or plugin activation.
5. Bind object and KV operations to that provider for the Application lifetime.
6. Apply selection changes on restart. A failed operation fails on that destination;
   it does not select another provider. Selecting another provider does not migrate data.
7. Close provider-owned resources after Application dependents finish shutting down.

The selected provider is application-wide. Random selection and a
disabled state cannot satisfy the durable storage capability required by startup.

## Public interface

All declarations below belong to the public `Storage` entrypoint, except shared
serializable schemas, which live in `packages/schema/src/storage.ts` and are
re-exported where needed. Error classes are specified in the next section.

The current `Path`, `PathPart`, `path`, `key`, `Metadata`, `SetInput`, `Entry`,
`RangeInput`, `ItemMetadata`, and `Item` contracts remain available. `Entry.body`
continues to carry `OperationError`; reads retain whole-object metadata for ranges.

```ts
/** A schema-branded provider ID; built-ins use filesystem and s3. */
export type ID = StorageSchema.ID

/** Secret-free information about a registered provider. */
export interface Info {
  readonly id: ID
  readonly name: string
}

/** Provider-independent streamed object operations. */
export interface Object {
  readonly set: (path: Path, input: SetInput) => Effect.Effect<void, InvalidPathError | OperationError>
  readonly get: (path: Path) => Effect.Effect<Option.Option<Entry>, InvalidPathError | OperationError>
  readonly getRange: (
    path: Path,
    input: RangeInput,
  ) => Effect.Effect<Option.Option<Entry>, InvalidPathError | OperationError>
  readonly remove: (path: Path) => Effect.Effect<void, InvalidPathError | OperationError>
  readonly list: (prefix: Path) => Effect.Effect<ReadonlyArray<Item>, InvalidPathError | OperationError>
}

/** The adapter contract, including backing-store initialization. */
export interface Driver extends Object {
  readonly init: Effect.Effect<void, OperationError>
}

/** A provider factory whose resources belong to its acquisition Scope. */
export interface Provider {
  readonly id: ID
  readonly name: string
  readonly open: Effect.Effect<Driver, OperationError, Scope.Scope>
}

/** Construction-time provider registration and default selection. */
export interface Draft {
  readonly add: (provider: Provider) => void
  readonly default: {
    readonly get: () => ID | undefined
    readonly set: (id: ID) => void
  }
}

/** JSON values selected by prefix and an exclusive last-key cursor. */
export interface ScanInput {
  readonly prefix: string
  readonly after?: string
  readonly limit?: number
}

/** One JSON value with its namespace-relative key. */
export interface KVEntry {
  readonly key: string
  readonly value: Schema.Json
}

/** A page whose optional cursor identifies the last returned key. */
export interface ScanResult {
  readonly entries: readonly KVEntry[]
  readonly next?: string
}

/** JSON operations already bound to one namespace and provider. */
export interface KV {
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined, OperationError | DecodeError>
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void, OperationError | InputError>
  readonly remove: (key: string) => Effect.Effect<void, OperationError>
  readonly scan: (input: ScanInput) => Effect.Effect<ScanResult, OperationError | DecodeError | InputError>
}

/** The identities whose combination owns a plugin's namespace. */
export interface Namespace {
  readonly workspaceID: Workspace.ID
  readonly pluginID: string
}

/** Selected storage and its namespace-bound views. */
export interface Interface {
  readonly list: () => Effect.Effect<readonly Info[]>
  readonly default: () => Effect.Effect<Info>
  readonly object: Object
  readonly scope: (namespace: Namespace) => KV
}

/** The one public Storage service tag. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Storage") {}

/** Typed construction inputs supplied by the application root. */
export interface Options {
  readonly configure: (draft: Draft) => void
  readonly selection?: ID
}

/** Resolves, acquires, and initializes the selected provider. */
export declare const layer: (options: Options) => Layer.Layer<Service, ConfigError | OperationError>

/** The application-wide graph node for the configured Storage Layer. */
export declare const node: (options: Options) => GlobalNode<Service, ConfigError | OperationError>
```

`scope` is intentionally synchronous: it binds identities to closures and performs
no I/O or resource acquisition. All I/O remains in the returned Effect operations.
`default()` reports the effective selection after the config override. `list()` is
sorted by ID. `object.list(prefix)` lists stored objects, keeping the two meanings
explicit without an overloaded `list` method.

Ranges are required on provider drivers: every existing concrete adapter already
implements them, and ToolOutput requires them for bounded reads. This makes adapter
admission enforce that capability instead of callers discovering its absence later.

### Construction example

This is public interface usage, not implementation pseudocode:

```ts
Storage.node({
  configure: (draft) => {
    draft.add(
      Storage.filesystem({
        directory,
      }),
    )
    draft.add(
      Storage.s3({
        bucket,
        config: { region },
      }),
    )
    draft.default.set(filesystemID)
  },
  selection: configuredID,
})
```

The Storage entrypoint exports `filesystem(options): Provider` and
`s3(options): Provider`, with fixed IDs `filesystem` and `s3` and corresponding
display names. Their implementations live in private sibling files. Filesystem options
are `{ directory: string; toolOutputDays?: number }`.
S3 options are the existing exclusive union of a caller-owned `client: S3Client`
or `config?: S3ClientConfig`, plus `bucket`. Memory construction is
exported through the Storage entrypoint as `memory(): Provider`, with the ID `memory`;
this test provider is not a selectable application configuration value. Its mutable
state is allocated by `open`, independently for each Application acquisition.

Legacy optional graph seams retain `Storage.defaultNode` and `Storage.defaultLayer`
as stable replacement placeholders. Their unconfigured acquisition fails with a
typed missing-default `ConfigError`. Executable compositions and tests supply
explicit options; the compatibility placeholders do not choose a provider.

### Caller examples

Core object consumers use `storage.object.get(path)` and
`storage.object.set(path, input)`. ProjectStorage binds its existing project prefix
over `storage.object`; its project-relative listing contract remains the same.

The Plugin host supplies:

```ts
storage: services.storage.scope({
  workspaceID: services.workspaceID,
  pluginID,
})
```

Public Promise plugin usage:

```ts
await ctx.storage.set("cursor", { page: 3 })
const cursor = await ctx.storage.get("cursor")
const page = await ctx.storage.scan({ prefix: "cache:", limit: 20 })
await ctx.storage.remove("old-key")
```

The Effect plugin surface exposes the typed KV failures. The Promise adapter turns
them into rejected promises using the established runtime bridge. Shared JSON/scan
types and errors belong in the schema package so Plugin does not import Core. Existing
plugin type names remain compatibility aliases. The scoped plugin interface exposes
only JSON operations; the host retains the full Storage service.

## Errors and invariants

Every error is a `Schema.TaggedError`; both its class name and namespaced tag
end in `Error`.

| Error              | Fields and meaning                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfigError`      | `message`, `reason: "default" \| "unknown" \| "duplicate"`, optional `providerID`; invalid registry or selection                                |
| `InvalidPathError` | Existing `reason` and `index`; path cannot be encoded as an object key                                                                          |
| `OperationError`   | `message`, `providerID`, `operation: "init" \| "set" \| "get" \| "list" \| "remove"`, underlying cause; provider or byte-stream failure         |
| `InputError`       | `message`, `operation: "set" \| "scan"`, `reason: "json" \| "limit"`; invalid JSON at a runtime boundary or non-positive/non-safe-integer limit |
| `DecodeError`      | `message`, `providerID`; stored bytes are not a valid JSON value                                                                                |

Adapter errors and source/read stream errors are translated at the owning operation.
Expected KV I/O and decoding failures no longer use `Effect.orDie`. Provider IDs and
operation names are available for tracing; JSON bodies and credentials are not error
fields. Invalid numeric object ranges retain the existing operation-error behavior.

Object semantics retain overwrite-by-key, missing reads as `Option.none()`, idempotent
removal, zero-byte markers, stable recursive prefix listings, clamped ranges, and
whole-object range metadata. KV missing reads return `undefined` for plugin
compatibility. Namespace isolation is Workspace plus Plugin identity, including
Project-loaded plugins; plugin reload does not delete persistent values.

KV scans sort decoded keys, filter by prefix and exclusive `after`, and apply a
positive integer limit when supplied. An omitted limit returns all matches. Pagination
does not promise a transactional snapshot under concurrent writes. Initially, scans
retain the existing full-prefix listing cost; S3 is suitable for durable small plugin
state but this interface does not imply an indexed KV engine.

## Call and dependency graphs

```text
Plugin setup / Tool callback
  -> ctx.storage.get/set/remove/scan
  -> Storage's private namespace + JSON view
  -> selected Driver
  -> filesystem / S3

ProjectDirectory / project materialization
  -> ProjectStorage
  -> Storage.object
  -> selected Driver

ToolOutput / Auth / ManagedPolicy / other object consumers
  -> Storage.object
  -> selected Driver
```

```text
Application root -> configuration parser -> provider factories
Application root -> Storage.node
Storage          -> shared Storage schemas + injected Provider contract
Private providers -> Storage's provider contract + node filesystem / AWS SDK
Plugin host      -> Storage.Service
Plugin package   -> shared Storage schemas
```

Storage requires no Database, WorkspaceConfig, Workspace Bus, or plugin-registry
service. Driver acquisition depends on Effect Scope; concrete provider resources are
acquired through the factories. Private internals are path handling, registry
resolution, KV serialization/namespacing, and filesystem, S3, and memory providers. Only
`packages/core/src/storage.ts` is the supported Core entrypoint.

### Layer composition and shutdown

```text
Local / AWS config
  -> typed provider factories + configure draft + optional selection
  -> Storage.layer
       -> resolve selection
       -> selected Provider.open [Application Scope]
       -> Driver.init
       -> Storage.Service
  -> Application process graph
  -> Workspace recovery
  -> Workspace runtimes / Plugin host / Session execution

shutdown: dependent runtimes -> Storage scope -> owned provider resources
```

Application bootstrap consumes an initialized Storage Layer; the existing separate
`storage.init` step moves into Layer acquisition. S3 clients constructed by the
adapter are scope-owned; injected clients remain caller-owned. Provider factories for
unselected destinations are not acquired.

The S3 input producer is scoped to each upload; interruption joins its local resource
finalizers. The retained SDK `Upload.abort()`/`done()` contract does not join remote
multipart cleanup after cancellation. Tests observe the remote abort separately;
they do not imply cancellation waits for successful network cleanup. Filesystem
read streams are opened lazily when the returned body is consumed.

## Placement and migration

### Application entrypoints

> Superseded: one host program, `app/host`, replaced the per-cloud entrypoints.
> `Host.resolve` selects the provider from `STORAGE_PROVIDER` (`s3`, `azure-blob`;
> `filesystem` in the development entry only) and registers it as the Application
> default; there is no selector document and no local S3. The text below records the
> design as it was when Storage was introduced.

Both `app/local.ts` and `app/aws.ts` import `Storage` from
`@bymorning/core/storage` and supply the same expression to Application:

```ts
storage: Storage.node(config.storage)
```

The internal `config.storage` value is `Storage.Options`, prepared by shared
composition configuration in `app/config.ts`. It is distinct from the user-authored
`{ storage: { provider: "filesystem" | "s3" } }` document. Shared configuration
builds the construction draft from available provider settings, assigns the root's
default, and applies the explicit selector. Building these factories does not open
files, initialize a bucket, or acquire an AWS client.

| Entrypoint     | Storage responsibility                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/local.ts` | Load shared storage selection with a filesystem default; supply the resulting Storage node                                    |
| `app/aws.ts`   | Load the same selection with an S3 default; resolve the linked bucket fallback here and pass settings to shared configuration |
| `app/dev.ts`   | Load configuration for launcher settings, then forward the config path/environment to the watched local entrypoint            |
| `app/run.ts`   | Run migrations and serve the configured Application                                                                           |

AWS's loader gains support for the same optional storage selector document; it does
not parse that document through the local-only application schema. Shared selector
parsing belongs in `app/config.ts`; AWS authentication/deployment settings remain
owned by its existing loader. Read the linked S3 bucket only when S3 is selected and
the environment has not supplied one.

`bun dev` currently runs `app/dev.ts`, which starts local PostgreSQL, builds the Docker
execution image, launches `tsx watch app/local.ts`, and starts Vite. It remains a
launcher and never acquires a second Storage runtime. Its local API process receives
the selected provider through the same configuration path as a direct local launch.

```text
bun dev [--config file]
  -> app/dev.ts
       -> PostgreSQL / execution image preparation
       -> Vite
       -> watched app/local.ts [same config file and environment]
            -> Storage.node(config.storage)
            -> Application

AWS entrypoint
  -> app/aws.ts
       -> shared selector + AWS settings
       -> Storage.node(config.storage)
       -> Application
```

Selecting `s3` is AWS-host only; the local host refuses it with a configuration
error. Selecting `filesystem` in AWS changes storage while retaining
the AWS profile's other capabilities. Defaults are composition choices rather than
environment detection inside Storage. Provider initialization occurs once during
Application Layer acquisition, after the normal migration step and before Workspace
recovery.

```text
packages/core/src/storage.ts             public interface, Layer, node, exports
packages/core/src/storage/kv.ts          private namespace and JSON view
packages/core/src/storage/filesystem.ts  private filesystem provider
packages/core/src/storage/memory.ts      private memory driver implementation
packages/core/src/storage/path.ts        private path encoding implementation
backends/aws/src/s3.ts                   S3 provider in the AWS backend package
packages/schema/src/storage.ts          shared IDs, JSON/scan schemas, error schemas
packages/schema/src/config/storage.ts   provider selector: filesystem or s3
```

Implementation may keep small private helpers inline instead of creating files for
them. The namespace, public entrypoint, and private directory follow existing Core
standards.

Provider implementations belong with the capability that owns them, rather than in
a generic Server adapters directory. Server and App import only `@bymorning/core/storage`,
never `storage/**`. Add an explicit `./storage/*` export exclusion in Core, following
the existing private-domain exclusions. Move the S3 client and multipart-upload
dependencies from Server to Core after verifying their remaining consumers.

The Application root still resolves environment and SST settings and chooses the
provider; filesystem and S3 modules do not decide which deployment is running.

Move PluginStorage behavior under Storage and migrate the host to `scope`, then remove
`packages/core/src/plugin-storage.ts`. Update object callers and test fixtures to the
`object` view. Keep ProjectStorage's project-relative contract and point it at that
view. Update local/AWS application construction, bootstrap, and harness composition.
Remove the two old Server storage adapter files once their imports and focused tests
have moved. The current Server adapters directory also contains database, execution,
and identity implementations; relocating storage alone does not remove those
other files or make the directory empty.

Preserve existing object keys, plugin namespaces, JSON representation, local file
format, bucket identity, and tool-output retention behavior. Selection metadata does
not add a new prefix inside a provider. Existing local and AWS configuration must
normalize into the corresponding provider during migration, so the refactor itself does
not move or hide deployed data. Any encoding incompatibility discovered by migration
tests requires an explicit compatibility decision rather than silently rewriting keys.

### Legacy encoding compatibility

The retained PluginStorage format encodes Workspace IDs, Plugin IDs, and JSON keys
as lowercase UTF-8 hex, using `00` for the empty string. This pre-existing encoding
aliases the empty string with `U+0000`; `TextEncoder` also normalizes lone UTF-16
surrogates to the replacement character. This migration deliberately preserves those
bytes and their existing interpretation. It does not claim distinct identities for
those already-ambiguous inputs or silently assign existing values to new keys. A future
encoding change needs a versioned compatibility policy for ambiguous stored values.

## Deletion test and trade-offs

Deleting Storage would spread provider selection, resource lifetime, path rules,
namespace isolation, JSON conversion, and error translation across the host and Core
consumers. It earns one cohesive service seam. Removing the separate PluginStorage
entrypoint instead eliminates an extra public seam while keeping its useful behavior
private to Storage.

Alternatives considered:

- Existing one-adapter injection alone: good resource composition, but no common
  catalog/default/config-selection contract.
- Separate KV service and object service: duplicates provider selection and namespace
  ownership for the capability the user wants unified.
- Exact WebSearch runtime transforms: fits dynamically replaceable search providers,
  but requires additional policy for stored-data identity, plugin bootstrap cycles,
  removed registrations, and in-flight streams. Startup selection is the recommended
  initial lifetime.

The `object` grouping requires caller migration but keeps `list()` meaningful for
provider inventory and distinguishes byte content from JSON values without overloads.
Provider registration is extensible at Application construction; adding a new external
engine implements one contract and extends root configuration parsing.

## Verification strategy

1. Core interface tests: configured selection overrides the draft default; missing,
   duplicate, and unknown selections fail explicitly; inventory is deterministic;
   independent Applications have independent memory state.
2. Reusable provider contract tests: binary streams, metadata, markers, missing reads,
   replacement, removal, sorted prefix listing, byte ranges, source/read failures,
   and interrupted uploads. Run against memory, real temporary filesystem storage,
   and the S3 adapter against a local S3-compatible service. Verify actual AWS-specific
   behavior separately when necessary rather than claiming an emulator proves it.
3. KV tests through `Storage.Service.scope`: JSON round trips, Unicode/separator keys,
   Workspace/plugin isolation, scan cursors, invalid limits, and malformed persisted
   JSON producing a typed decoding error.
4. Compatibility tests: read existing file/object fixtures and plugin keys through
   the new public interface, and preserve project-relative file behavior.
5. Application scenarios using `TestApp.make`, the real plugin activation path, and
   generated SDK: plugin writes survive reload; Project reads and ToolOutput use the
   configured provider; Storage startup failure prevents Workspace recovery. Extend
   the fixture's explicit configuration seam as needed instead of bypassing the graph.
6. Lifecycle tests: unselected providers are not opened, selected resources are closed
   after consumers, caller-owned S3 clients are retained, and failed initialization
   releases acquired resources.

Run focused tests and `bun typecheck` from each affected package, including Plugin,
Schema, Core, Server, and App. Finish with `git diff --check`.

## Approval

Approved: one application-wide provider selected at startup, the construction-time
WebSearch-shaped draft, and the public `list/default/object/scope` interface above.
Live Workspace/plugin-driven provider replacement requires a different lifecycle design.

## Implemented verification

- Core provider/lifecycle/JSON suites exercise memory, real temporary filesystem
  storage, and Dockerized MinIO through `Storage.layer`. The S3 tests include more
  than 1,000 objects for continuation pagination, actual multipart upload and abort
  observation, source-finalizer joins, and caller-owned client retention. Separate
  real HTTP transport tests terminate successful S3 `get` and `getRange` bodies
  mid-read and assert typed stream failures.
- Legacy filesystem headers and namespace keys are read through the public service.
  Provider selection, captured-draft immutability, failed initialization cleanup,
  namespace isolation, JSON validation, scan cursors, and invalid ranges are covered.
- `app/test/storage.test.ts` uses the real Application, generated SDK, PostgreSQL,
  filesystem, plugin activation/configuration reload, and scripted external model.
  It verifies Project reads, persisted large ToolOutput, plugin KV surviving reload
  and Application disposal, and startup failure before recovery. The complete app
  suite passes 37 tests. A pre-existing `Config.plugin.configure` encoding defect
  was fixed by constructing its existing `ConfigPlugin.Entry` schema class, enabling
  the real reload path.
- ManagedPolicy persists before changing active registrations and serializes its
  mutations around that entire sequence. Gated concurrency tests cover overlapping
  creates and conflicting update/delete/enable operations, alongside typed write
  failure tests that preserve the existing active state.
- Core, Schema, Plugin, Server, and App typechecks pass. Focused Storage suites pass.
  Broader verification reproduced unrelated failures against pre-migration source:
  three Server migration-history expectations, one Server inference cancellation
  fixture, and one Schema event-inventory expectation. Stale plugin-supervisor and
  Server auth/MCP fixtures were corrected to complete their Storage-relevant flows.
- MinIO proves local S3-compatible integration, not AWS deployment behavior. Remote
  multipart abort remains asynchronous as described in the lifecycle section.
