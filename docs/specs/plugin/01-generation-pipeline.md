# 01 — Generation Pipeline: one deep Workspace plugin generation Module

> **Historical proposal, not implemented architecture.** The consolidation into `PluginGeneration` below has not
> replaced the current source/supervisor/registry graph. Line numbers and counts are historical. For Tool and Mcp,
> [Tool registration](../tool-registration.md) is the canonical approved contract. This update
> reconciles those dependencies only; recorded regressions do not authorize the broader generation redesign or
> establish a complete migration pass.

## Implemented Tool/Mcp composition

**Member registry isolation verified:** `WorkspaceMap.node` wraps the complete compiled member graph with
`Layer.fresh` after hoisting globals. This prevents shared `LayerMap` memoization from reusing static Tool Layers
across member keys while retaining same-member reuse and shared global identities. The workspace-map regression
and real `app/test/tool-auth.test.ts` (1/1 passed; app typecheck exit 0) cover the recorded ownership/auth path.
Builtin caller resource binding and the MCP same-provider race now have independent regression verification.
OpenAPI production-host safety is also independently verified (55 focused tests, including 13 host cases). Final
published-artifact suites passed: Core integration 200 tests/17 files, Server with Docker 121/24, and Application
45/12, all with 0 skips and exit 0. The 5 real Application Docker scenarios add no binary/media export from `run`.
The full Application browser suite passed 8 tests/0 skips; Protocol passed 60 tests. Generated contract checks and
typechecks pass; the isolated docs build passed 162 pages and link validation passed. These complete the recorded
checks without expanding independent security/export scope. See the canonical
[verification checkpoint](../tool-registration.md#implementation-checkpoint--verification-gates).

`packages/server/src/workspace-runtime.ts` constructs exactly one Tool registry per member graph and passes that
same node to Session, PluginHost, and inbound `MCPGateway`. Public `Mcp` is constructed separately with direct
Integration, member-bound Credential, OAuth callback, and Bus dependencies. Plugin activation configures Mcp through
scoped transforms; it does not build another remote client service from PluginContext or install another registry.

```text
WorkspaceRuntime.nodes
  Tool.workspaceNodes ──> SessionWorkspace / PluginHost / MCPGateway
  Mcp.workspaceNodes  ──> PluginHost / Session guidance / private Tool discovery
  boot: PluginSupervisor.flush → ModelPolicy.flush → Layer.build(Tool.discovery)
        Tool.discovery: private McpTool initial flush (no extra Mcp reload)
```

Private `tool/mcp.ts` consumes public `Mcp.Service` and installs one stable replayable discovery transform in Tool.
Subsequent remote changes refresh schemas and descriptions after a 100 ms debounce without changing precedence.
Tool prepares direct definitions, the optional Code Mode catalog, and paired captured execution for both callers;
gateway builtin exclusion is a winning-provenance prefilter, not producer routing to another registry. Host inventory
is diagnostic contribution tracking, not a catalog or executor authority.

PluginHost delegates `transform`, `reload`, and hooks. Both public plugin surfaces expose `context.tool.openapi`
through private Tool-owned glue, using an existing Integration and invocation-time Connection resolution. Builtin
caller binding in plugin-private `plugin/internal/tool/binding.ts` now captures typed registration-time dependencies
and validates the real member-filtered Session/Project pair. Independent regressions verify the original ambient
directory mismatch reproduction and reject inconsistent callers. No public Binding or raw
metadata surface is implied by the generation proposal. The published Code Mode dependency and compatibility patches are pinned
in [dependency provenance](../../../references/codemode.md). These composition facts do not establish successful
every startup/authentication path or full Application execution-profile completion.

## 1. Summary

Observation (Config entries, package/local targets, Project materialization, fs watch), resolution (selectors, imports,
Promise adaptation), ordering (pre/external/post), Scope reconciliation, failed-replacement restoration, `State.batch`,
events, and inventory writes are today spread across three Modules (`PluginSource`, `PluginSupervisor`, the
`Plugin` registry) whose interfaces exist mainly to hand work to each other. This spec folds them into one deep
Workspace-scoped `PluginGeneration` Module whose entire external Interface is `flush`, `reloadAfter`, and a read-only
`list` projection. `Plugin.Service` survives as the read-only projection (`activate` becomes private); the
`PluginActivation.Cell` cycle-breaking cell survives unchanged. `ProjectMaterializer`, `PluginPackage`,
`PluginInternal`, `PluginComposition`, Config, Project storage, and Bus remain dependency Seams.

## 2. Current shape

### Registry — `packages/core/src/plugin.ts` (366 lines)

```ts
// plugin.ts:36-43
export interface Interface {
  readonly activate: (
    plugins: readonly Generation[],
    failures?: readonly Extract<PluginSchema.Info, { readonly status: "failed" }>[],
  ) => Effect.Effect<void>
  readonly list: () => Effect.Effect<PluginSchema.Info[]>
}
// plugin.ts:45-50
export type Generation = PluginDefinition & {
  readonly revision: string
  readonly source?: PluginSchema.Source
  readonly options?: PluginOptions
  readonly configured?: boolean
}
// plugin.ts:52-54
export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}
// plugin.ts:57-223
export const layer = (
  services: Omit<PluginHost.HostServices, "bus" | "plugin">,
  coordinator = State.makeCoordinator(),
) => /* Layer.effect(Service, …) */
// plugin.ts:226-325 — `workspaceNodes` node-graph wrapper harvesting host capabilities
```

Internal paths of `layer`: child Scope fork per load (`plugin.ts:71`), context isolation to Scope + loggers
(`plugin.ts:103-110`), `plugin.added` per successful setup (`plugin.ts:112-114`), unchanged-generation short-circuit
(`plugin.ts:141-153`), full restart of every desired definition sequentially inside `State.batch`
(`plugin.ts:155-202`), failed-replacement restoration (`plugin.ts:184-190`), one `plugin.updated` per reconcile
(`plugin.ts:203`), Scope-closing finalizer (`plugin.ts:208-213`), inventory projection helpers `activeInfo`/`configurationInfo`
(`plugin.ts:327-366`).

### Source — `packages/core/src/plugin/source.ts` (187 lines)

```ts
// source.ts:22-42
export type Operation =
  | { readonly type: "config.add"; readonly target: string; readonly options: Readonly<Record<string, unknown>>;
      readonly configured: boolean; readonly mtime?: number }
  | { readonly type: "config.remove"; readonly target: string }
  | { readonly type: "project.add"; readonly key: `project:${ID}:${ProjectDirectory.Path}`; readonly projectID: ID;
      readonly path: ProjectDirectory.Path; readonly entrypoint: string; readonly revision: string;
      readonly plugin?: Plugin }
// source.ts:44-47
export interface Snapshot {
  readonly operations: readonly Operation[]
  readonly failures: readonly Extract<Plugin.Info, { readonly status: "failed" }>[]
}
// source.ts:49-57
export interface Interface {
  readonly snapshot: () => Effect.Effect<Snapshot, never, Scope.Scope>
  readonly changes: () => Stream.Stream<void>
}
export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginSource") {}
// source.ts:59-160 — `layer`: Config entry parse + target resolution (70-81), stat mtime versioning (82-90),
// fs watch of configured absolute files (92-106), Project materialization via ProjectMaterializer (114-143),
// merged change stream (146-157). source.ts:185 — `parse("-")` throws.
```

### Supervisor — `packages/core/src/plugin/supervisor.ts` (352 lines) + `supervisor-service.ts` (15)

```ts
// supervisor-service.ts:5-13
export class ActivationError extends Schema.TaggedError<ActivationError>()(
  "PluginSupervisor.ActivationError", { cause: Schema.Defect() },
) {}
export interface Interface {
  readonly flush: Effect.Effect<void>
  readonly reload: Effect.Effect<void, ActivationError>
  readonly reloadAfter: <A, E, R>(mutation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ActivationError, R>
}
// supervisor.ts:38-106 — `layerWith(internal, activationCell?, additionalChanges?)`:
//   activate = internal → source.snapshot() → resolve → registry.activate (58-69)
//   reloadAfter holds the activation semaphore across mutation + activate (70-74)
//   readiness: Latch + observed counter (54-56), sliding buffer capacity 1 + 100 ms debounce (87-101), flush (102)
//   cell install (103)
// supervisor.ts:187-265 — `resolve`: selector semantics (203-225), per-operation import/load (226-251),
//   pre/external/post ordering (253-262), failure rows (263)
// supervisor.ts:267-312 — `load`: package/local/project entrypoint resolution, mtime cache-buster, Promise adaptation
// supervisor.ts:314-352 — `builtin`, `configured`, `matches`, `pluginSource`, `operationSource`, `isEffectPlugin`, `isPromisePlugin`
```

### Production callers

| Caller | Site | Uses |
| --- | --- | --- |
| `server/src/workspace-runtime.ts` | 214-244, 245-253, 260-283, 284-295 | `Plugin.workspaceNodes`, `PluginSource.workspaceNodes`, `PluginSupervisor.workspaceNodes`, boot flush |
| `server/src/workspace-runtime.ts` | 68, 107, 149, 161 | `PluginActivation.makeCell` / `flush(activationCell)` |
| `server/src/workspace-map.ts` | 75, 87, 90 | `Capabilities` union: `PluginSource.Service`, `Plugin.Service`, `PluginSupervisor.Service` |
| `server/src/handlers/plugin.ts` | 11 | `Plugin.Service.use((plugin) => plugin.list())` |
| `server/src/handlers/config.ts` | 17-20, 29-32 | `supervisor.flush` |
| `server/src/handlers/mcp.ts` | 44-45 | `supervisor.flush` |
| `server/src/handlers/budget.ts` | 18-21 | `supervisor.flush` |
| `server/src/middleware/auth.ts` | 112, 211-214 | `supervisor.flush` before every plugin-requiring request |
| `core/src/plugin/configuration.ts` | 26-27, 45, 47-53, 66-68 | `plugins.list()`, `supervisor.reloadAfter` |
| `core/src/plugin/host.ts` | 51-55, 72, 296 | `PluginRegistry { activate, list }` handed to plugins as `context.plugin` |
| `core/src/config.ts` | 19, 287 | `resolveConfigurationTarget` / `configurationTarget` (stays) |

`PluginSupervisor.reload` has no production caller (tests only). `PluginSupervisor.layer` (supervisor.ts:108-110) and
`layerWithCell` (supervisor.ts:112-114) have no callers outside the module graph. Nothing outside core imports
`Operation`/`Snapshot`.

## 3. Proposed interface

New Module `packages/core/src/plugin/generation.ts`. **External**: `Service`, `Interface`, `ActivationError`, `layer`,
`layerWith`, `workspaceNodes`. **Internal (private to the Module)**: `Definitions`, `Operation`, `Snapshot`,
observation, resolution, reconciliation, readiness, inventory state, events.

```ts
// packages/core/src/plugin/generation.ts
export * as PluginGeneration from "./generation.js"

import type { Plugin as EffectPlugin } from "@bymorning/plugin/effect/plugin"
import type { App } from "@bymorning/plugin/app"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import type { Workspace } from "@bymorning/schema/workspace"
import { type GlobalNode, makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Context, Effect, Layer, Schema, Scope, Stream } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Agent } from "../agent.js"
// …host capability imports exactly as plugin.ts:14-34 (AISDK, Catalog, Command, Integration, …)
import { Plugin } from "../plugin.js"
import { State } from "../state.js"
import { PluginActivation } from "./activation.js"
import { PluginComposition } from "./composition.js"
import { PluginConfiguration } from "./configuration.js"
import { PluginHost } from "./host.js"
import { context7EndpointLayer } from "./internal/tool/context7.js"
import { PluginPackage } from "./package.js"
import { Mcp } from "../mcp.js"

/** A Config entry which cannot become an operation; surfaced as a failed inventory row, not a thrown defect. */
export interface ParseFailure {
  readonly raw: string
  readonly reason: string
}

// ---- internal (not exported beyond the module) -----------------------------

/** One desired internal generation, resolved against the current Workspace catalog. */
interface Definitions {
  readonly pre: readonly EffectPlugin<Scope.Scope>[]
  readonly post: readonly EffectPlugin<Scope.Scope>[]
}

type Operation =
  | { readonly type: "config.add"; readonly target: string; readonly options: Readonly<Record<string, unknown>>;
      readonly configured: boolean; readonly mtime?: number }
  | { readonly type: "config.remove"; readonly target: string }
  | { readonly type: "project.add"; readonly key: `project:${Project.ID}:${ProjectDirectory.Path}`;
      readonly projectID: Project.ID; readonly path: ProjectDirectory.Path; readonly entrypoint: string;
      readonly revision: string; readonly plugin?: EffectPlugin<Scope.Scope> }

interface Snapshot {
  readonly operations: readonly Operation[]
  readonly failures: readonly Extract<PluginSchema.Info, { readonly status: "failed" }>[]
}

/** Services the Module observes and reconciles against; everything else arrives through `services`. */
type Inputs =
  | Bus.Service
  | Config.Service
  | Project.Service
  | Storage.Service
  | PluginPackage.Service
  | Scope.Scope

// ---- external --------------------------------------------------------------

export class ActivationError extends Schema.TaggedError<ActivationError>()(
  "PluginGeneration.ActivationError",
  { cause: Schema.Defect() },
) {}

export interface Interface {
  /** Resolve only after the latest observed generation has settled; never fails (settlement-only readiness). */
  readonly flush: Effect.Effect<void>
  /** Run one mutation, then reconcile the generation under the activation lock. */
  readonly reloadAfter: <A, E, R>(mutation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ActivationError, R>
  /** Current Workspace inventory: active rows plus failed observation/import rows. */
  readonly list: () => Effect.Effect<PluginSchema.Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginGeneration") {}

/** Direct constructor. `internal` and `additionalChanges` are the composition Seams (production passes PluginComposition). */
export const layerWith = <R, R2 = never>(
  services: Omit<PluginHost.HostServices, "bus" | "plugin">,
  internal: Effect.Effect<Definitions, never, R>,
  options: {
    readonly coordinator?: State.Coordinator
    readonly activationCell?: PluginActivation.Cell
    readonly additionalChanges?: Stream.Stream<void, never, R2>
  } = {},
): Layer.Layer<Service, never, R | R2 | Inputs> => /* §4 */

export const layer = (
  services: Omit<PluginHost.HostServices, "bus" | "plugin">,
  options: { readonly coordinator?: State.Coordinator } = {},
) =>
  layerWith(services, PluginComposition.definitions, {
    coordinator: options.coordinator,
    additionalChanges: PluginComposition.changes,
  }).pipe(Layer.provide(context7EndpointLayer))
// Mcp is supplied by the existing member graph, not constructed by this speculative generation Layer.
// Workspace boot retains Tool.discovery and its awaited initial flush.

/** Production node-graph constructor: harvests Workspace capabilities, then builds the generation Module. */
export const workspaceNodes = <E>(input: {
  readonly workspaceID: Workspace.ID
  readonly accountID?: Account.ID
  readonly app: App
  readonly coordinator: State.Coordinator
  readonly activationCell: PluginActivation.Cell
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly config: WorkspaceNode<Config.Service, E>
  readonly project: WorkspaceNode<Project.Service, E>
  readonly storage: GlobalNode<Storage.Service, E>
  readonly pluginPackage: GlobalNode<PluginPackage.Service>
  /** Ensures the public event bridge is subscribed before source-triggered activation. */
  readonly eventSourceReady: WorkspaceNode<never, E>
  readonly host: {
    // identical to Plugin.workspaceNodes' host input, plugin.ts:232-252
    readonly agent: WorkspaceNode<Agent.Service, E>
    readonly aisdk: WorkspaceNode<AISDK.Service, E>
    readonly catalog: WorkspaceNode<Catalog.Service, E>
    readonly command: WorkspaceNode<Command.Service, E>
    readonly integration: WorkspaceNode<Integration.Service, E>
    readonly oauthCallback: GlobalNode<IntegrationOAuthCallback.Service, E>
    readonly instruction: WorkspaceNode<InstructionDiscovery.Service, E>
    readonly mcp: WorkspaceNode<Mcp.Service, E>
    readonly policy: WorkspaceNode<Policy.Service, E>
    readonly reference: WorkspaceNode<Reference.Service, E>
    readonly runtime: WorkspaceNode<PluginRuntime.Service, E>
    readonly hooks: WorkspaceNode<PluginHooks.Service, E>
    readonly skill: WorkspaceNode<Skill.Service, E>
    readonly storage: GlobalNode<Storage.Service, E>
    readonly tool: WorkspaceNode<Tool.Service, E>
    readonly webSearch: WorkspaceNode<WebSearch.Service, E>
    readonly httpClient: GlobalNode<HttpClient.HttpClient, E>
  }
}): {
  readonly root: WorkspaceNode<Service | Plugin.Service, E>
  readonly generation: WorkspaceNode<Service, E>
  readonly registry: WorkspaceNode<Plugin.Service, E>
  readonly activationProvider: WorkspaceNode<never, E>
  readonly ready: WorkspaceNode<Service | Plugin.Service, E>
} => /* §4 */
```

`packages/core/src/plugin.ts` collapses to types plus the read-only projection tag — no layer, no node:

```ts
// packages/core/src/plugin.ts (after)
/** Exposes the Workspace-scoped read-only Plugin registry projection. */
export * as Plugin from "./plugin.js"

import type { Plugin as PluginDefinition } from "@bymorning/plugin/effect/plugin"
import type { PluginOptions } from "@bymorning/plugin/options"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Context, Effect } from "effect"

export interface Interface {
  readonly list: () => Effect.Effect<PluginSchema.Info[]>
}

export type Generation = PluginDefinition & {
  readonly revision: string
  readonly source?: PluginSchema.Source
  readonly options?: PluginOptions
  readonly configured?: boolean
}

/** Workspace-scoped read-only registry projection; the generation Module provides it. */
export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}
```

`packages/core/src/plugin/host.ts:51-55` narrows the handed-down registry accordingly:

```ts
// host.ts:51-55 (after)
export interface PluginRegistry {
  readonly list: () => Effect.Effect<import("@bymorning/schema/plugin").Plugin.Info[]>
}
```

Deleted: `plugin/source.ts`, `plugin/supervisor.ts`, `plugin/supervisor-service.ts`, `Plugin.layer`,
`Plugin.workspaceNodes`, `Plugin.Interface["activate"]`. Kept as dependency Seams (unchanged):
`plugin/activation.ts`, `plugin/composition.ts`, `plugin/internal.ts`, `plugin/package.ts` (`Service` + `node`),
`plugin/project-materializer.ts`, `plugin/source-target.ts` (also consumed by `config.ts:19`), `plugin/configuration.ts`
(see `03-configuration-normalization.md`).

Depth argument: the deleted interfaces (`PluginSource.Interface`, `PluginSupervisor.Interface`,
`Plugin.Interface["activate"]`) existed to pass work between the three Modules — the deletion test fails for each of
them (delete the Module and their complexity reappears at the single caller). The surviving Interface hides
observation, resolution, ordering, reconciliation, restoration, events, and inventory behind three methods.

## 4. Implementation sketch

```ts
// generation.ts (continued)

export const layerWith = <R, R2 = never>(
  services: Omit<PluginHost.HostServices, "bus" | "plugin">,
  internal: Effect.Effect<Definitions, never, R>,
  options: {
    readonly coordinator?: State.Coordinator
    readonly activationCell?: PluginActivation.Cell
    readonly additionalChanges?: Stream.Stream<void, never, R2>
  } = {},
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const projects = yield* Project.Service
      const storage = yield* Storage.Service
      const packages = yield* PluginPackage.Service
      const dependencies = yield* Effect.context<R | R2 | Scope.Scope>()
      const coordinator = options.coordinator ?? State.makeCoordinator()
      const scope = yield* Scope.make()
      const ready = yield* Latch.make()
      const activationLock = Semaphore.makeUnsafe(1)
      const configuredChanges = yield* PubSub.unbounded<void>()
      const watched = new Set<string>()
      const active = new Map<
        PluginSchema.ID,
        { readonly plugin: Plugin.Generation; readonly scope: Scope.Closeable }
      >()
      let inventory: PluginSchema.Info[] = []
      let observed = 0

      const list = Effect.fn("PluginGeneration.list")(function* () {
        return inventory
      })
      // Read-only projection handed to loaded plugins; referenced by `load` before initialization on
      // purpose — load only runs after this binding exists.
      const registry: PluginHost.PluginRegistry = { list }

      const changes = () =>
        Stream.merge(
          Stream.merge(config.changes(), Stream.fromPubSub(configuredChanges)),
          bus.subscribe([Deleted, FileChanged]).pipe(
            Stream.filter(
              (event) =>
                event.type === Deleted.type ||
                (event.type === FileChanged.type && event.data.path.startsWith("plugin/")),
            ),
            Stream.map(() => undefined),
          ),
        )

      // Config rows → ordered operations + fs watch registration (source.ts:70-108, with parse failures as rows).
      const configuredOperations = Effect.fn("PluginGeneration.configured")(function* () {
        const entries = yield* config.entries()
        const parsed = entries.flatMap((entry) =>
          (entry.info.plugins ?? []).map((item) =>
            parse(item, entry.path === undefined ? process.cwd() : path.dirname(entry.path)),
          ),
        )
        const failures = parsed.flatMap((item) =>
          "reason" in item
            ? [
                {
                  source: { type: "package", package: item.raw } as PluginSchema.Source,
                  status: "failed",
                  error: item.reason,
                  tui: false,
                } satisfies Extract<PluginSchema.Info, { readonly status: "failed" }>,
              ]
            : [],
        )
        const resolved = parsed.flatMap((item) => ("reason" in item ? [] : [item]))
        const versioned = yield* Effect.forEach(resolved, (operation) => {
          if (operation.type === "config.remove" || !path.isAbsolute(operation.target)) {
            return Effect.succeed(operation)
          }
          return Effect.promise(() => stat(operation.target)).pipe(
            Effect.map((info) => ({ ...operation, mtime: Math.trunc(info.mtimeMs) })),
            Effect.orElseSucceed(() => operation),
          )
        })
        for (const operation of versioned) {
          if (operation.type !== "config.add" || !path.isAbsolute(operation.target) || watched.has(operation.target)) {
            continue
          }
          const directory = yield* Effect.promise(() => stat(operation.target)).pipe(
            Effect.map((info) => info.isDirectory()),
            Effect.orElseSucceed(() => true),
          )
          if (directory) continue
          watched.add(operation.target)
          yield* Effect.acquireRelease(
            Effect.sync(() => watch(operation.target, () => void PubSub.publishUnsafe(configuredChanges, undefined))),
            (watcher) => Effect.sync(() => watcher.close()),
          )
        }
        return { operations: versioned, failures }
      })

      // Complete observation: configured rows + materialized Project generations (source.ts:111-145).
      const observe = Effect.fn("PluginGeneration.observe")(function* (): Effect.Effect<Snapshot> {
        const configured = yield* configuredOperations()
        const operations = Array<Operation>(...configured.operations)
        const failures = [...configured.failures]
        for (const project of yield* projects.list) {
          const projectStorage = yield* ProjectStorage.make(services.workspaceID, project.id).pipe(
            Effect.provideService(Storage.Service, storage),
          )
          const result = yield* Effect.gen(function* () {
            return yield* ProjectMaterializer.make(cacheRoot, services.workspaceID, project.id).materialize({
              storage: projectStorage,
              items: yield* projectStorage.list,
            })
          }).pipe(Effect.exit)
          if (result._tag === "Failure") {
            failures.push({
              source: { type: "project", projectID: project.id },
              status: "failed",
              error: Cause.pretty(result.cause),
              tui: false,
            })
            continue
          }
          for (const entrypoint of result.value.entrypoints) {
            operations.push({
              type: "project.add",
              key: `project:${project.id}:${entrypoint}`,
              projectID: project.id,
              path: entrypoint,
              entrypoint: path.join(result.value.directory, entrypoint.slice("plugin/".length)),
              revision: result.value.digest,
            })
          }
        }
        return { operations, failures }
      })

      // One operation → one Generation definition (supervisor.ts:267-312; `packages` closed over).
      const resolveOperation = Effect.fn("PluginGeneration.resolveOperation")(function* (
        operation: Extract<Operation, { readonly type: "config.add" | "project.add" }>,
      ) { /* body moved unchanged from supervisor.ts:271-311 */ })

      // Selector application + ordering (supervisor.ts:187-265, calling resolveOperation at 226's site).
      const resolve = Effect.fn("PluginGeneration.resolve")(function* (
        pre: readonly Plugin.Generation[],
        post: readonly Plugin.Generation[],
        snapshot: Snapshot,
      ) { /* body moved unchanged from supervisor.ts:193-264 */ })

      // Activate one definition in a child Scope (plugin.ts:70-121; configuration block replaced by §03 Module).
      const load = Effect.fnUntraced(function* (plugin: Plugin.Generation) {
        const child = yield* Scope.fork(scope)
        const inherit = yield* State.inherit()
        const configured = PluginConfiguration.activationOptions({
          configuration: plugin.configuration,
          options: plugin.options,
        })
        const loaded = yield* Effect.suspend(() =>
          "error" in configured
            ? Effect.die(new Error(configured.error))
            : plugin.effect(
                PluginHost.make({ ...services, bus, plugin: registry }, plugin.id, configured.options, plugin.source),
              ),
        ).pipe(
          inherit,
          Effect.updateContext((context: Context.Context<never>) =>
            Context.make(Scope.Scope, child).pipe(
              Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
              Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
            ),
          ),
          Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
          Effect.andThen(
            bus.publish(PluginSchema.Event.Added, { id: PluginSchema.ID.make(plugin.id) }).pipe(Effect.orDie),
          ),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
          Effect.exit,
        )
        if (Exit.isSuccess(loaded)) return { scope: child } as const
        yield* Effect.logWarning("failed to load plugin", { "plugin.id": plugin.id, cause: loaded.cause })
        return { error: Cause.pretty(loaded.cause) } as const
      })

      // Reconcile the active map against the desired definitions (plugin.ts:123-206; single lock suffices now).
      const activate = Effect.fn("PluginGeneration.activate")(function* (
        plugins: readonly Plugin.Generation[],
        failures: readonly Extract<PluginSchema.Info, { readonly status: "failed" }>[] = [],
      ) {
        const definitions = plugins.map((plugin) => ({ ...plugin, id: PluginSchema.ID.make(plugin.id) }))
        const ids = new Set<PluginSchema.ID>()
        for (const definition of definitions) {
          if (ids.has(definition.id)) return yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
          ids.add(definition.id)
        }
        const next = definitions.map((definition) => ({ id: definition.id, revision: definition.revision }))
        const current = Array.from(active.values(), (entry) => ({ id: entry.plugin.id, revision: entry.plugin.revision }))
        if (
          current.length === next.length &&
          current.every((definition, index) => {
            const candidate = next[index]
            return definition.id === candidate?.id && definition.revision === candidate.revision
          })
        ) {
          const nextInventory = [...Array.from(active.values(), (entry) => activeInfo(entry.plugin)), ...failures]
          if (JSON.stringify(inventory) === JSON.stringify(nextInventory)) return
          inventory = nextInventory
          yield* bus.publish(PluginSchema.Event.Updated, {}).pipe(Effect.orDie)
          return
        }
        yield* State.batch(
          coordinator,
          Effect.gen(function* () {
            const nextInventory: PluginSchema.Info[] = []
            for (const definition of definitions) {
              const previous = active.get(definition.id)
              active.delete(definition.id)
              if (previous) yield* Scope.close(previous.scope, Exit.void).pipe(Effect.ignore)
              const loaded = yield* load(definition)
              if (loaded.scope !== undefined) {
                active.set(definition.id, { plugin: definition, scope: loaded.scope })
                nextInventory.push(activeInfo(definition))
                continue
              }
              const configuration = PluginConfiguration.inventoryConfiguration({
                configuration: definition.configuration,
                options: definition.options,
                configured: definition.configured,
              })
              nextInventory.push({
                id: definition.id,
                source: definition.source ?? { type: "builtin" },
                status: "failed",
                error: loaded.error,
                tui: definition.tui ?? false,
                ...(configuration === undefined ? {} : { configuration }),
              })
              if (!previous) continue
              const restored = yield* load(previous.plugin)
              if (restored.scope !== undefined) {
                active.set(definition.id, { plugin: previous.plugin, scope: restored.scope })
                continue
              }
              yield* Effect.logError("failed to restore plugin; deactivating", { "plugin.id": definition.id })
            }
            const removed = Array.from(active.entries())
              .filter(([id]) => !ids.has(id))
              .toReversed()
            removed.forEach(([id]) => active.delete(id))
            yield* Effect.forEach(removed, ([, entry]) => Scope.close(entry.scope, Exit.void).pipe(Effect.ignore), {
              discard: true,
            })
            inventory = [...nextInventory, ...failures]
          }),
        )
        yield* bus.publish(PluginSchema.Event.Updated, {}).pipe(Effect.orDie)
      })

      const reconcile = Effect.gen(function* () {
        const definitions = yield* internal
        const snapshot = yield* observe()
        const resolved = yield* resolve(definitions.pre.map(builtin), definitions.post.map(builtin), snapshot)
        yield* activate(resolved.plugins, resolved.failures)
      }).pipe(
        Effect.provide(dependencies),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.fail(new ActivationError({ cause })),
        ),
        Effect.withSpan("PluginGeneration.reconcile"),
      )

      const reloadAfter = Effect.fn("PluginGeneration.reloadAfter")(function* <A, E, R3>(
        mutation: Effect.Effect<A, E, R3>,
      ) {
        return yield* activationLock.withPermit(mutation.pipe(Effect.tap(() => reconcile)))
      })

      const updates = (
        options.additionalChanges === undefined ? changes() : Stream.merge(changes(), options.additionalChanges)
      ).pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            observed++
            yield* ready.close
            return observed
          }),
        ),
      )
      yield* Stream.concat(Stream.succeed(0), updates).pipe(
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.debounce("100 millis"),
        Stream.runForEach((target) =>
          Effect.gen(function* () {
            yield* reloadAfter(Effect.void).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.logError("failed to reload plugins", { cause }),
              ),
            )
            if (observed === target) yield* ready.open
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      const flush = ready.await
      if (options.activationCell !== undefined) yield* PluginActivation.install(options.activationCell, flush)

      yield* Effect.addFinalizer((exit) =>
        Effect.gen(function* () {
          active.clear()
          yield* State.batch(Scope.close(scope, exit))
        }),
      )

      return Service.of({ flush, reloadAfter, list })
    }),
  )
```

Notes on the fold:

- The registry's own `Semaphore` (plugin.ts:67) is deleted. Every `activate` call now flows through
  `activationLock` (watcher path calls `reloadAfter(Effect.void)`, supervisor.ts:90-97 semantics preserved), so one
  lock carries the single-flight guarantee; `State.batch` continues to serialize commits against persisted
  installation (state.ts:34-46).
- The `Scope` in `dependencies` is the Layer build Scope, so `Effect.acquireRelease` watchers registered during
  `observe` close when the Workspace graph closes — the behavior plugin-source.test.ts asserts today.
- `cacheRoot` becomes a `layerWith` option (production: `path.join(process.cwd(), ".bymorning", "plugins", "materialized")`,
  workspace-runtime.ts:247) or a `layer` option; shown captured above for brevity.
- `workspaceNodes` mirrors the existing node-graph shapes — `Layer.unwrap` harvesting capabilities
  (plugin.ts:254-301), a dedicated `activationProvider` node installing the cell after the Module builds
  (supervisor.ts:173-182), and the read-only registry node derived from the built Module:

```ts
export const workspaceNodes = <E>(input: { /* §3 shape */ }) => {
  const generation = makeWorkspaceNode({
    service: Service,
    layer: Layer.unwrap(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const config = yield* Config.Service
        const projects = yield* Project.Service
        const storage = yield* Storage.Service
        const packages = yield* PluginPackage.Service
        const agent = yield* Agent.Service
        // …each remaining host capability harvested exactly as plugin.ts:258-274 does today
        return layerWith(
          { workspaceID: input.workspaceID, accountID: input.accountID, app: input.app, agent /* … */ },
          PluginComposition.definitions,
          { coordinator: input.coordinator, additionalChanges: PluginComposition.changes },
        ).pipe(Layer.provide(context7EndpointLayer))
      }),
    ),
    deps: [
      input.bus, input.config, input.project, input.storage, input.pluginPackage, input.eventSourceReady,
      input.host.agent, input.host.aisdk, input.host.catalog, input.host.command, input.host.integration,
      input.host.oauthCallback, input.host.instruction, input.host.mcp,
      input.host.policy, input.host.reference, input.host.runtime, input.host.hooks, input.host.skill,
      input.host.storage, input.host.tool, input.host.webSearch, input.host.httpClient,
      LayerNodePlatform.filesystem, LayerNodePlatform.path,
    ],
  })
  const registry = makeWorkspaceNode({
    service: Plugin.Service,
    layer: Layer.effect(
      Plugin.Service,
      Effect.map(Service, (generation) => Plugin.Service.of({ list: generation.list })),
    ),
    deps: [generation],
  })
  const activationProvider = makeWorkspaceNode({
    name: "@bymorning/core/PluginGeneration.activationProvider",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const current = yield* Service
        yield* PluginActivation.install(input.activationCell, current.flush)
      }),
    ),
    deps: [generation],
  })
  const ready = LayerNode.group([generation, registry, activationProvider])
  return { root: ready, generation, registry, activationProvider, ready }
}
```

Pure helpers move below the export unchanged: `builtin`, `configured`, `matches`, `pluginSource`, `operationSource`,
`isEffectPlugin`, `isPromisePlugin` (supervisor.ts:314-352) and `parse` (source.ts:181-187) reworked to return
`Operation | ParseFailure`:

```ts
type Parsed = Operation | ParseFailure

function parse(input: ConfigPlugin.Plugin, base: string): Parsed {
  if (typeof input !== "string")
    return { type: "config.add", target: input.package, options: input.options ?? {}, configured: true }
  if (!input.startsWith("-")) return { type: "config.add", target: input, options: {}, configured: false }
  if (input.length === 1) return { raw: input, reason: "Plugin remove operation requires a target" }
  return { type: "config.remove", target: input.slice(1) }
}
```

Target resolution stays in `configuredOperations` (`resolveConfigurationTarget` for `config.add` only, entry document
directory base — source.ts:73-79).

## 5. Caller migration

| Call site (current) | Today | After |
| --- | --- | --- |
| `server/src/workspace-runtime.ts:214-244` | `Plugin.workspaceNodes({…host…})` | merged into `PluginGeneration.workspaceNodes({…, host: {…same…}})` |
| `server/src/workspace-runtime.ts:245-253` | `PluginSource.workspaceNodes({workspaceID, cacheRoot, config, project, storage, bus, eventSourceReady})` | deleted; inputs move onto `PluginGeneration.workspaceNodes` |
| `server/src/workspace-runtime.ts:260-283` | `PluginSupervisor.workspaceNodes({registry, source, …22 deps})` | deleted; `pluginPackage`/platform inputs move onto `PluginGeneration.workspaceNodes` |
| `server/src/workspace-runtime.ts:284-295` | `yield* pluginSupervisor.flush` | `const generation = yield* PluginGeneration.Service; yield* generation.flush` |
| `server/src/workspace-runtime.ts:341` | `plugin: { runtime, registry, source, runtimeProvider, supervisor }` | `plugin: { runtime, generation, runtimeProvider }` |
| `server/src/workspace-map.ts:75,90` | `Capabilities` includes `PluginSource.Service`, `PluginSupervisor.Service` | `PluginSource.Service` removed; `PluginGeneration.Service` added; `Plugin.Service` (87) unchanged |
| `server/src/handlers/plugin.ts:11` | `Plugin.Service.use((plugin) => plugin.list())` | unchanged |
| `server/src/handlers/config.ts:2,17-20,29-32` | `PluginSupervisor` flush | import + tag swap to `PluginGeneration`; `yield* generation.flush` |
| `server/src/handlers/mcp.ts:6,44-45` | `PluginSupervisor` flush | same swap |
| `server/src/handlers/budget.ts:2,18-21` | `PluginSupervisor` flush | same swap |
| `server/src/middleware/auth.ts:21,112,211-214` | `PluginSupervisor.Service.use((supervisor) => supervisor.flush…)` | `PluginGeneration.Service.use((generation) => generation.flush…)` |
| `core/src/plugin/configuration.ts:26-27` | `plugins.list()` via `PluginRegistry.Service` | unchanged |
| `core/src/plugin/configuration.ts:45,47-53,66-68` | `PluginSupervisor.Service` + `reloadAfter` | `PluginGeneration.Service` + `reloadAfter` (bodies per `03-configuration-normalization.md`) |
| `core/src/plugin/host.ts:51-55,72` | `PluginRegistry { activate, list }` | `PluginRegistry { list }`; `host.ts:296` unchanged |
| `core/src/plugin.ts:57-223,226-325` | `layer`, `workspaceNodes` | deleted (types + tag remain) |

`PluginActivation` consumers are untouched: `workspace-runtime.ts:68` (`makeCell`), 107/149/161
(`PluginActivation.flush(activationCell)` for ModelPolicy, SessionWorkspace, SessionOperations).

## 6. Tests

| Existing test file | Decision |
| --- | --- |
| `core/test/plugin-supervisor.test.ts` (1266) | Rewrite → rename `plugin-generation.test.ts`. Keep every behavioral assertion (shared flush reconciliation, debounce/observed-counter, serialization of explicit reload vs watcher, `reloadAfter` read-modify-write serialization, hot reload of two Workspace graphs, routing regeneration). Replace `Layer.succeed(PluginSource.Service, …)` fakes (49-77, 115-131, 155-165, 194-199, 908-953, 1005-1018) with the real observation path through Config/Bus/Project adapters (the file's `supervisorGraph` at 1034-1106 already wires real Config — the middleman is gone). Replace `Plugin.Service.of({activate, list})` fakes with real inventory reads. |
| `core/test/plugin-source.test.ts` (344) | Delete. Ordering/mtime/watch assertions re-home into `plugin-generation.test.ts` as generation outcomes (inventory rows and versions) driven by real Config adapters; `buildSource`/`config`/`projectService` helpers (246-298) move to the rewritten file as adapters. |
| `core/test/plugin-scoped.test.ts` (176) | Rewrite against the real generation Module: build `PluginGeneration.layerWith` with the host adapter object (the deepProxy stays — it adapts unused host capabilities, not the Module under test), drive reconciliation via `reloadAfter`, assert lifecycle journal, restoration, duplicate-ID defect, and shutdown finalization exactly as today (35-150). |
| `core/test/plugin-activation.test.ts` (36) | Keep unchanged. |
| `core/test/plugin-materializer.test.ts` (141) | Keep unchanged. |
| `core/test/plugin-configuration.test.ts` (250) | Keep; fake supervisor tag swaps to `PluginGeneration.Service` (body changes per `03-configuration-normalization.md`). |
| `core/test/plugin-internal.test.ts` (603) | Keep unchanged (`PluginInternal` Seam untouched). |
| `core/test/plugin-host.test.ts` (1458) | Keep; type-level `PluginRegistry` narrowing only. |
| `server/src/routes.test.ts:791-798` | Rewrite fake: `PluginGeneration.Service.of({ flush, reloadAfter, list })` (no `reload`). |
| `server/src/server.test.ts:111-119,232-238` | Keep; real graph — no edit beyond nothing (tag invisible at usage sites). |
| `server/src/workspace-map.test.ts:54` | Rewrite fake: `Plugin.Service.of({ list: () => Effect.succeed([]) })`. |

New test cases:

| Name | Assertion |
| --- | --- |
| "activates a real Config row through the folded observation path" | Config row with a local entrypoint + a selector produces the exact pre/external/post inventory order and versions. |
| "settles readiness once per observed generation" | N coalesced change events produce one reconciliation; `flush` resolves only after the last target matches `observed`. |
| "serializes reloadAfter mutations with watcher activations" | A second `reloadAfter` mutation observes the first's Config commit in its snapshot (no interleaving). |
| "records a bare \"-\" selector as a failed inventory row" | Inventory contains the parse-failure row and the remaining desired definitions still activate. |
| "keeps the failed candidate row when a replacement is restored" | After a failing replacement the inventory shows the failed candidate while the restored old Scope is the live one (lifecycle journal). |
| "closes every activation Scope on Workspace shutdown" | Plugin finalizers run exactly once when the owning Scope closes. |

Representative new tests driving the real implementation (Config/Bus adapters are real second adapters;
`PluginPackage` failing adapter is the second Adapter of that Seam — two Adapters, so the Seam is real):

```ts
// core/test/plugin-generation.test.ts
const workspaceID = Workspace.ID.make("wrk_plugin_generation")

it.live("activates a real Config row through the folded observation path", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporaryDirectory(".plugin-generation-")
      const entrypoint = path.join(root, "plugin.ts")
      const lifecycle = path.join(root, "journal.log")
      yield* Effect.promise(() => writeFile(entrypoint, moduleSource(lifecycle, "one")))

      const updates = yield* PubSub.unbounded<void>()
      const graph = PluginGeneration.layerWith(
        hostAdapter(services.workspaceID),
        Effect.succeed({ pre: [], post: [] }),
        { additionalChanges: Stream.fromPubSub(updates) },
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Config.Service, config(decode({ plugins: [entrypoint] }), root), ),
            Layer.succeed(Project.Service, projectService([])),
            Layer.succeed(Storage.Service, yield* Storage.Service),
            Layer.succeed(Bus.Service, yield* Bus.Service),
            Layer.succeed(
              PluginPackage.Service,
              PluginPackage.Service.of({
                resolve: (target) => Effect.fail(new PluginPackage.ResolveError({ target })),
              }),
            ),
          ),
        ),
      )
      yield* Layer.build(graph).pipe(Effect.scoped)
      const generation = yield* PluginGeneration.Service
      yield* generation.flush

      expect((yield* generation.list())).toEqual([
        {
          id: "demo",
          source: { type: "local", path: entrypoint },
          status: "active",
          tui: false,
        },
      ])
      expect(yield* Effect.promise(() => readFile(lifecycle, "utf8"))).toContain("setup:one")
    }),
  ),
)

it.live("serializes reloadAfter mutations with watcher activations", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const updates = yield* PubSub.unbounded<void>()
      const current = { value: decode({ plugins: [] }) }
      const observedOptions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const graph = PluginGeneration.layerWith(
        hostAdapter(workspaceID),
        Effect.succeed({ pre: [], post: [] }),
        { additionalChanges: Stream.fromPubSub(updates) },
      ).pipe(Layer.provide(configLayer(current, updates, observedOptions)))
      yield* Layer.build(graph).pipe(Effect.scoped)
      const generation = yield* PluginGeneration.Service
      yield* generation.flush

      yield* generation.reloadAfter(
        Config.Service.use((config) => config.update(decode({ plugins: [{ package: "demo", options: { mode: "strict" } }] }))),
      )
      expect(yield* Ref.get(observedOptions)).toEqual([{ mode: "strict" }])
    }),
  ),
)
```

(The `config`/`configLayer`/`projectService`/`hostAdapter`/`moduleSource`/`temporaryDirectory` helpers are the
existing adapter helpers re-homed from `plugin-source.test.ts:246-344` and `plugin-supervisor.test.ts:1034-1188`.)

## 7. Preserved behavior

| Invariant | Where today |
| --- | --- |
| Plugin context isolation: load provides only Scope + loggers to the plugin effect | plugin.ts:103-110; README:203-209 |
| Internal definitions capture Workspace authorities before entering the registry | internal.ts:66-155; README:219-223 |
| Child Scope per definition; closed on replacement, removal (reverse order), and shutdown | plugin.ts:71,115,160-162,193-199,208-213 |
| Unchanged generation short-circuits; `plugin.updated` published only when inventory actually changed | plugin.ts:141-153 |
| One `plugin.updated` per changed reconcile, published after the `State.batch` | plugin.ts:203; README:64,66 |
| `plugin.added` per successful setup | plugin.ts:112-114 |
| Full-generation restart: any changed definition restarts every desired definition sequentially inside `State.batch` | plugin.ts:155-202; verified by plugin-scoped.test.ts:35-85 |
| Failed replacement attempts restoration; inventory keeps the failed candidate row | plugin.ts:170-190 |
| Duplicate IDs die before any mutation | plugin.ts:127-132 |
| Failed observation/import rows do not abort remaining operations | supervisor.ts:226-244; source.ts:124-131; README:65 |
| Pre → external → post ordering; selectors toggle membership in place | supervisor.ts:203-225,253-262; README:111,113-117 |
| Readiness: initial signal, sliding buffer capacity 1, 100 ms debounce, latch opens only when `observed` matches | supervisor.ts:54-56,76-101; README:62-63 |
| `reloadAfter` holds one lock across mutation + activation | supervisor.ts:70-74 |
| `State.batch` serializes generation commits with persisted base installation | plugin.ts:155-202; state.ts:34-46 |
| Activation cell install + flush cycle-breaking survives | supervisor.ts:103,173-182; activation.ts:19-28; workspace-runtime.ts:107,149,161 |
| Only directly configured absolute local files are watched; package targets are not watched or mtime-versioned | source.ts:92-106; supervisor.ts:281-287; README:63,151 |
| Package resolution order (`<name>/server`, then `<name>`, process `package.json` then cache) | package.ts:22-41 |
| Inventory row shape (active/failed union, redacted configuration) | plugin.ts:327-366; schema/plugin.ts:86-103 |

## 8. Open decisions

| Decision | Current behavior | Options | Recommended default |
| --- | --- | --- | --- |
| Full-generation restart | One changed definition restarts all (plugin.ts:155-202) | (a) preserve; (b) restart only changed + removed | **(a) preserve.** Scoped finalizers make restarts correct; per-definition restarts would reorder `State.batch` commits and change the lifecycle guarantees tests pin today. |
| Readiness failure semantics | `flush` is settlement-only; activation failures log and still open the latch (supervisor.ts:90-98) | (a) settlement-only; (b) `flush` fails with `ActivationError` | **(a) settlement-only.** Failure-aware readiness belongs to `reloadAfter` callers (configuration already inspects its own activation Exit, configuration.ts:53-63). |
| Event cardinality | `plugin.added` per successful setup, one broad `plugin.updated` per reconcile (plugin.ts:112-114,203) | (a) preserve; (b) per-plugin `updated` payloads | **(a) preserve.** Session-catalog invalidation (README:171) depends on the broad event. |
| Failed-restoration inventory | Failed candidate row stays while the old definition is restored active (plugin.ts:170-190) | (a) preserve; (b) rewrite the row to active | **(a) preserve.** The failed row is the only signal that the desired generation is not what is running. |
| `"-"` selector | `parse` throws → defect fails the whole reconcile (source.ts:185) | (a) failed inventory row (`{ source: { type: "package", package: "-" }, error: "Plugin remove operation requires a target" }`), generation continues; (b) keep throwing | **(a) failure row.** One malformed Config entry should not block every plugin; the row shape matches other failed observation rows. |
| `reload` external | Exposed on the supervisor Interface, production-unused (supervisor-service.ts:11) | (a) internal (drop; callers use `reloadAfter(Effect.void)`); (b) keep | **(a) internal.** Deletion test: zero production callers; tests use `reloadAfter(Effect.void)`. |
| `cacheRoot` placement | Constructed at the composition point (workspace-runtime.ts:247) | (a) `layerWith`/`layer` option; (b) module constant | **(a) option**, matching `PluginSource.layer` today and keeping the test adapter seam. |

## 9. Sequencing

1. **Introduce the deep Interface over the old internals.** Add `plugin/generation.ts` exposing `Service`
   (`flush`/`reloadAfter`/`list`), `ActivationError`, `layerWith`/`layer`/`workspaceNodes`, implemented by composing
   the existing `Plugin.layer`, `PluginSource.layer`, and `PluginSupervisor.layerWith` internally (build the merged
   internal Layer inside `Layer.unwrapScoped`, extract the two handles, and derive the read-only `Plugin.Service`
   projection). Move `workspace-runtime.ts` and every `PluginSupervisor`/`PluginSource` consumer to the new tag;
   `Plugin.Interface.activate` becomes unused by production. No behavior change; all tests pass unchanged except
   tag renames.
2. **Collapse the internals, move tests, delete the old Seams.** Inline observation (`source.ts`), resolution and
   readiness (`supervisor.ts`), and reconciliation (`plugin.ts` registry half) into `generation.ts`; apply the
   `"-"` failure-row and single-lock changes; rewrite `plugin-supervisor.test.ts` → `plugin-generation.test.ts`,
   delete `plugin-source.test.ts`, rewrite `plugin-scoped.test.ts`; delete `plugin/source.ts`,
   `plugin/supervisor.ts`, `plugin/supervisor-service.ts`, and `Plugin.layer`/`Plugin.workspaceNodes`/
   `activate`. Run core formatting, lint, `git diff --check`, and `bun typecheck` from `packages/core`.

## Appendix — alternative shapes considered

**A. Fold observation into the supervisor; keep the registry a separate Module.**

```ts
// PluginSource deleted; supervisor observes; registry keeps activate/list.
export namespace PluginSupervisor {
  export interface Interface {
    readonly flush: Effect.Effect<void>
    readonly reloadAfter: <A, E, R>(m: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ActivationError, R>
  }
  export const layerWith = (
    internal: Effect.Effect<Definitions>,
    deps: { readonly config: Config.Service; readonly projects: Project.Service; readonly storage: Storage.Service },
  ) => Layer.effect(Service, Effect.gen(function* () { /* observe → resolve → registry.activate */ }))
}
// Plugin.Interface stays { activate, list } — the write seam stays public.
```

Rejected: `activate` remains callable from anywhere, so the reconciliation protocol (dedupe, batching, restoration)
stays part of two Modules' shared interface. Depth does not improve; only one pass-through dies.

**B. Fold resolution into the registry; keep `PluginSource` as the observation Module.**

```ts
export namespace Plugin {
  export interface Interface {
    readonly activate: (operations: readonly PluginSource.Operation[]) => Effect.Effect<void>
    readonly list: () => Effect.Effect<PluginSchema.Info[]>
  }
}
// Registry now knows Config selectors, PluginPackage resolution, and import adaptation.
```

Rejected: inverts the shallow direction — the registry must know every source shape, while `PluginSource` degenerates
to a Config/Project reader whose only caller immediately re-derives meaning (deletion test fails in the other
direction). Import and Promise adaptation are resolution concerns, not inventory concerns.

**C. Keep three Modules but formalize the handoff with a `DesiredGeneration` type.**

```ts
export interface DesiredGeneration {
  readonly definitions: readonly Plugin.Generation[]
  readonly failures: readonly Extract<PluginSchema.Info, { readonly status: "failed" }>[]
}
// PluginSource: snapshot/changes (unchanged)
// PluginSupervisor: resolve(): Effect.Effect<DesiredGeneration, ActivationError> + flush/reloadAfter
// Plugin: activate(desired: DesiredGeneration) + list
```

Rejected: `DesiredGeneration` is a pure data handoff with exactly one producer and one consumer per reconcile — an
interface without hidden behavior. Readiness, locking, and failure semantics still span three Modules, which is the
complexity this spec removes.
