# 02 — Remove the shallow Config-replay pseudo-plugins (superseded)

> **Status: superseded.** This document records the earlier decision to absorb Config projection into owning domains.
> The current direction reverses that decision: top-level Workspace Config remains persisted in its existing shape,
> while internal Config Plugins own runtime application through domain transforms. See
> [`plans/config-plugin-migration.md`](../../../plans/config-plugin-migration.md) for current status, completed phases,
> constraints, and unresolved design work. The material below is retained only as historical rationale and must not be
> used as implementation guidance.

## 1. Summary

Six internal "plugins" (`bymorning.config.{agent,skill,command,provider,reference,websearch}`) exist only to move one Core-owned value — the Workspace Config row — from one Core-owned authority (the `Bus` `config.updated` event) to other Core-owned domains through the public plugin host. They are single Core implementations dressed as plugins: a hypothetical seam with exactly one adapter each, and IDs users can disable, silently breaking Config projection. This spec deletes them; the two domains that project real Config values (Agent, WebSearch) plus the two half-real ones (Catalog, GatewayConfig) absorb their own projection and `config.updated` subscription; the three pass-throughs (Command, Skill, Reference) fail the deletion test and are simply deleted.

## 2. Current shape

The shared observer keeps one Config snapshot current and replays one owning domain on every `config.updated`:

```ts
// packages/core/src/config/plugin/entry-observer.ts:7-26
/** Keep one Config snapshot current and replay only the supplied owning domain. */
export const observe = Effect.fnUntraced(function* (
  config: Config.Interface,
  event: EventDomain,
  reload: Effect.Effect<void>,
) {
  const loaded = { info: yield* config.get }
  const refresh = config.get.pipe(
    Effect.tap((info) => Effect.sync(() => (loaded.info = info))),
    Effect.andThen(reload),
  )
  yield* event.subscribe().pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() => refresh),
    Effect.forkScoped({ startImmediately: true }),
  )
  // Close the race between the first read and establishing the subscription.
  loaded.info = yield* config.get
  return loaded
})
```

Each replay plugin is a thin projection onto the public host's domain drafts. Typical full bodies:

```ts
// packages/core/src/config/plugin/command.ts:8-14 — no Config data used at all
export const Plugin = define({
  id: "bymorning.config.command",
  effect: Effect.fn(function* (context) {
    const config = yield* Config.Service
    yield* ConfigEntryObserver.observe(config, context.event, context.command.reload())
    yield* context.command.transform(() => undefined)
  }),
})

// packages/core/src/config/plugin/agent.ts:8-16 — projects default_agent
yield* ConfigEntryObserver.observe(config, context.event, context.agent.reload())
yield* context.agent.transform((draft) => {
  if (loaded.info.default_agent !== undefined) draft.default(loaded.info.default_agent)
})

// packages/core/src/config/plugin/provider.ts:8-22 — projects default_model + pass-through reloads
yield* ConfigEntryObserver.observe(
  config,
  context.event,
  context.integration.reload().pipe(Effect.andThen(context.catalog.reload())),
)
yield* context.integration.transform(() => undefined)
yield* context.catalog.transform((draft) => {
  const model = loaded.info.default_model
  if (model !== undefined) draft.model.default.set(model.provider, model.id)
})

// packages/core/src/config/plugin/websearch.ts:8-18 — projects the provider selection
yield* ConfigEntryObserver.observe(config, context.event, context.websearch.reload())
yield* context.websearch.transform((websearch) => {
  const selection = loaded.info.websearch
  if (selection === false) websearch.default.set(false)
  if (selection) websearch.default.set(selection.provider)
})
```

`skill.ts:8-14` and `reference.ts:8-14` are byte-for-byte the Command pattern (reload + no-op transform, zero Config fields read). `gateway.ts:9-17` projects `config.gateway` into the GatewayConfig domain; `instruction.ts` and `outbound-mcp.ts` do not use the observer at all.

Event flow today (both ends Core-owned):

1. `Config.layer` publishes on every committed change: `packages/core/src/config.ts:95` (`bus.publish(Config.Event.Updated, {})`).
2. `PluginHost.make` re-projects the Bus into the public plugin event stream: `packages/core/src/plugin/host.ts:139-146`, filtered to `config.updated` by `projectEvent` at `host.ts:412-414`.
3. The observer (step 1 file) subscribes to that projection and triggers `domain.reload()`.
4. `State.reload` re-materializes the domain (`packages/core/src/state.ts:122-165`), re-running every registered transform — that is how the mutable `loaded` cell reaches domain state.

Registration and wiring: `packages/core/src/plugin/internal.ts:11-18` imports the six (alongside the gateway and instruction config plugins), `internal.ts:56-63` lists them as the `post` array, `internal.ts:152-155` wraps each with the captured `Config.Service` (`Effect.provideService(Config.Service, config)`), and `internal.ts:184-193` splices them around `gatewayConfig`/`instructionConfig` with `configured.slice(0, 5)` / `configured.slice(5)`.

What each owning domain actually does with Config:

| Replay plugin | Config field consumed | Where the value lands | Pass-through reload side effect |
| --- | --- | --- | --- |
| `bymorning.config.agent` | `default_agent` | `Data.default` via `draft.default` (`config/plugin/agent.ts:14`), read by `ordered()` at `packages/core/src/agent.ts:152` | none (Agent has no `State` `finalize`) |
| `bymorning.config.provider` | `default_model` | `Data.defaultModel` via `draft.model.default.set` (`config/plugin/provider.ts:20`), read only by the public `CatalogDraft.model.default.get` (`packages/core/src/catalog.ts:130`); Core resolution already reads Config live (`catalog.ts:286-294`) | re-materializes Integration and Catalog; neither has a `finalize`, neither materialization reads Config |
| `bymorning.config.websearch` | `websearch` | `Data.selection` via `draft.default.set` (`config/plugin/websearch.ts:15-16`), read by `defaultProvider()` at `packages/core/src/websearch.ts:66-76` | `WebSearch` `finalize` publishes `websearch.updated` (`websearch.ts:63`) |
| `bymorning.config.skill` | none | — | Skill has no `finalize`; re-runs plugin transforms to identical state (`packages/core/src/skill.ts:87-104`) |
| `bymorning.config.command` | none | — | Command `finalize` re-publishes `command.updated` with unchanged content (`packages/core/src/command.ts:56`) |
| `bymorning.config.reference` | none | — | Reference `finalize` re-publishes `reference.updated` and re-forks git materialization (`packages/core/src/reference.ts:46-76`) |

No code outside `internal.ts` imports any of the six. Domains that genuinely read Config at call time need no replay at all — `catalog.ts:68`, `tool-output.ts:37,46`, `plugin/internal/tool/subagent.ts:148`, and `session/runner.ts:114` all read `config.get` live.

Callers of the current shape:

- `packages/core/src/plugin/internal.ts:11-18,56-63,134-155,184-193` — the only production caller.
- `packages/core/test/plugin-internal.test.ts:481-512` — drives all post plugins with a `replayContext` fake and asserts per-domain reload counts.
- `packages/core/test/plugin-internal.test.ts:211-224` and `packages/server/src/auth-postgres.test.ts:356-367` — assert the exact post ID list.
- `packages/core/test/integration/integration.test.ts:317,518` — finds `bymorning.config.mcp` in `internal.post` (kept; unaffected).

## 3. Proposed interface

Everything in this spec is internal to `packages/core/src`; nothing changes in `@bymorning/plugin`, and no public plugin interface gains a Workspace selector (`packages/plugin/AGENTS.md` constraint preserved — the public host still exposes `config.updated` via `context.event.subscribe()` for external plugins).

One shared piece is added to the Config module; four domains consume it:

```ts
// packages/core/src/config.ts (additions to the existing module)

import { MutableRef } from "effect"

/**
 * Keep one synchronous projection of the active Config current, closing the
 * subscribe race the same way ConfigEntryObserver did. The returned cell is
 * safe to read from synchronous State drafts and `ordered`-style selectors.
 */
export const follow = <A>(
  project: (info: Config.Info) => A,
): Effect.Effect<MutableRef.MutableRef<A>, never, Service | Scope.Scope> =>
  Effect.gen(function* () {
    const workspace = yield* Service
    const cell = MutableRef.make<A>(project(yield* workspace.get))
    const update = Effect.map(workspace.get, (info) => MutableRef.set(cell, project(info)))
    yield* workspace.changes().pipe(Stream.runForEach(() => update), Effect.forkScoped({ startImmediately: true }))
    // Close the race between the first read and establishing the subscription.
    yield* update
    return cell
  })
```

Deleted exports (files removed outright):

- `packages/core/src/config/plugin/entry-observer.ts` (`ConfigEntryObserver`)
- `packages/core/src/config/plugin/{agent,command,provider,reference,skill,websearch}.ts`
- `packages/core/src/config/plugin/gateway.ts` (`ConfigGatewayPlugin`) — absorbed, see §4

Domain interfaces change only in their dependency lists and one shrink:

```ts
// packages/core/src/agent.ts — layer now requires the Workspace Config authority
export const layer: (workspaceID: Workspace.ID, coordinator?: State.Coordinator) => Layer.Layer<
  Service,
  never,
  Database.Service | Bus.Service | Model.Service | Provider.Service | Config.Service
>

// packages/core/src/websearch.ts — same shape
// packages/core/src/gateway-config.ts — interface shrinks; projection becomes live
export interface Interface {
  /** Read the active projected gateway policy for the bound Workspace. */
  readonly get: Effect.Effect<ConfigGateway.Info | undefined>
}
```

`State.Transformable` disappears from `GatewayConfig.Interface`: after absorption its only `transform`/`reload` callers are the deleted plugin (`config/plugin/gateway.ts:14-15`). `GatewayConfig.project`, `snapshot`, and `snapshotLayer` are unchanged (`gateway-config.ts:19-20,42-46`) and keep serving graph-less inference Workspaces.

## 4. Implementation sketch

### Agent — config projection absorbed (`packages/core/src/agent.ts`)

Precedence must be preserved exactly. Today the config transform registers after every pre-phase plugin (post phase), so it wins over any plugin-contributed `draft.default`; the env fallback only applies when neither set (`agent.ts:150-158`). A live cell read inside `ordered()` reproduces this: config when set, else plugin-contributed `Data.default`, else env.

```ts
// packages/core/src/agent.ts — inside layer(workspaceID)
import { WorkspaceConfig } from "./config.js" // effect's env Config stays imported as `Config`

const configured = yield* Config.option(Config.schema(Agent.ID, "BYMORNING_DEFAULT_AGENT"))
// One sync cell read by `ordered` and every effective-catalog recompute.
const configuredDefault = yield* WorkspaceConfig.follow((info) => info.default_agent)

const ordered = (data: Data) => {
  const agents = Array.from(data.agents.values())
  const preferred =
    MutableRef.get(configuredDefault) ??
    data.default ??
    (configured._tag === "Some" ? configured.value : undefined)
  const selected =
    (preferred === undefined ? undefined : selectable(data.agents.get(preferred))) ??
    selectable(data.agents.get(Agent.BuildID)) ??
    agents.find((agent) => selectable(agent) !== undefined)
  return selected === undefined ? agents : [selected, ...agents.filter((agent) => agent.id !== selected.id)]
}
```

No `state.reload()` subscription is needed: `list`/`get`/`resolve` recompute through the `catalog` `SynchronizedRef` on every call (`agent.ts:225-235`), and Agent publishes no materialization event, so the replay's reload was pure work.

### WebSearch — config projection and invalidation absorbed (`packages/core/src/websearch.ts`)

WebSearch is the one domain whose materialization event matters (`websearch.ts:61`), so its single subscription both refreshes the sync cell and triggers the reload that re-publishes `websearch.updated`:

```ts
// packages/core/src/websearch.ts — inside layer
import { Config as WorkspaceConfig } from "./config.js"
import { ConfigWebSearch } from "@bymorning/schema/config/websearch"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* WorkspaceConfig.Service
    const configuredSelection = MutableRef.make<ConfigWebSearch.Selection | undefined>(undefined)
    const update = config.get.pipe(Effect.map((info) => MutableRef.set(configuredSelection, info.websearch)))
    const state = State.create<Data, Draft>({ /* unchanged: websearch.ts:51-64, including the finalize publish */ })

    // One subscription keeps the sync cell current and republishes websearch.updated through reload.
    yield* config
      .changes()
      .pipe(
        Stream.runForEach(() => update.pipe(Effect.andThen(state.reload()))),
        Effect.forkScoped({ startImmediately: true }),
      )
    yield* update

    const selected = (data: Data) => {
      const configured = MutableRef.get(configuredSelection)
      if (configured !== undefined) return configured === false ? false : configured.provider
      return data.selection
    }

    const defaultProvider = Effect.fn("WebSearch.default")(function* () {
      const data = state.get()
      const selection = selected(data)
      if (selection === false) return yield* new DisabledError()
      if (selection === "random") {
        const providers = Array.from(data.providers.values())
        const provider = providers[Math.floor(Math.random() * providers.length)]
        return provider && { id: WebSearchSchema.ID.make(provider.id), name: provider.name }
      }
      const provider = data.providers.get(selection)
      return provider && { id: WebSearchSchema.ID.make(provider.id), name: provider.name }
    })
    // ... query unchanged; `draft.default.get/set` unchanged ...
  }),
)
```

Config still wins over plugin-contributed selections exactly as the post-phase transform did; `false` disables outright because `false ?? x` is `false`.

### Catalog — default-model draft view absorbed (`packages/core/src/catalog.ts`)

Core model resolution already reads Config live (`catalog.ts:286-294`); the only replay artifact is the plugin-visible `CatalogDraft.model.default.get` view (`catalog.ts:129-134`), which today is seeded by the config transform. Preserve it with the cell; no reload, no event (Catalog has no `finalize`):

```ts
// packages/core/src/catalog.ts — inside layer (Config.Service is already yielded at catalog.ts:68)
const configuredDefault = yield* Config.follow((info) => info.default_model)

const state = State.create<Data, CatalogDraft>({
  // ...
  draft: (data) => ({
    // ...
    model: {
      // ...
      default: {
        get: () => MutableRef.get(configuredDefault) ?? data.defaultModel,
        set: (providerID, modelID) => {
          data.defaultModel = { providerID, modelID }
        },
      },
    },
  }),
})
```

`bymorning.config.provider`'s `context.integration.reload()` pass-through has no replacement: Integration state reads env Config, not the Workspace row (`integration.ts:384-471`), and Integration publishes no materialization event.

### GatewayConfig — projection becomes the domain (`packages/core/src/gateway-config.ts`)

`bymorning.config.gateway` exists only to copy `config.gateway` into GatewayConfig state (deletion test: delete it and the complexity reappears nowhere — the state IS the projection). Make the projection live and delete the state machine:

```ts
// packages/core/src/gateway-config.ts
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workspace = yield* Config.Service
    return Service.of({ get: Effect.map(workspace.get, project) })
  }),
)

/** Project one immutable Config snapshot without activating the plugin host. */
export const snapshotLayer = (config: Config.Info) => Layer.succeed(Service, snapshot(project(config)))

export const snapshot = (policy: ConfigGateway.Info | undefined) => Service.of({ get: Effect.succeed(policy) })
```

### Command, Skill, Reference — deletion

These three consume no Config field; their materializations rebuild identical state from `initial()` plus the currently registered transforms. Delete `config/plugin/{command,skill,reference}.ts`. Nothing replaces them. If a client ever surfaces that depended on the redundant `command.updated` / `reference.updated` invalidations after `config.updated`, the optional pattern is one scoped line in the owning domain (`Stream.runForEach(() => state.reload())` forked like WebSearch above) — but the default is to drop them, since subscribers refetch identical state (see Open decisions).

### Resulting `internal.ts` post-definition array (with this spec only; composition itself is spec 05's subject)

```ts
// packages/core/src/plugin/internal.ts — recommended: gateway absorbed
const post = [] as const // the six replay plugins and ConfigGatewayPlugin are gone
```

and the returned `post` array collapses to:

```ts
post: [
  instructionConfig,
  mcp,
  AtlassianMCPPlugin,
  McpCodeModeExclusionPlugin,
  makeModelRoutingPlugin(models.all, models.available),
],
```

i.e. expected activated post IDs become `["bymorning.config.instruction", "bymorning.config.mcp", "atlassian-mcp", "bymorning.mcp.codemode.exclusion", "bymorning.model-routing"]`. If Open decision 2 instead keeps the gateway plugin, `gatewayConfig` precedes `instructionConfig` and `"bymorning.config.gateway"` precedes `"bymorning.config.instruction"` in both the array and the test. The `configured.slice(0, 5)` / `configured.slice(5)` splice (`internal.ts:184-188`) and the `configured` wrapper (`internal.ts:152-155`) are deleted. The `Config.Service` capture at `internal.ts:76` remains for the `subagent`, `mcp`, and `ExternalServerCreatorPlugin` wraps.

## 5. Caller migration

| Production call site | Current | New |
| --- | --- | --- |
| `packages/core/src/plugin/internal.ts:11-18` | imports six `Config*Plugin` namespaces | delete imports (and `ConfigGatewayPlugin` if absorbed) |
| `packages/core/src/plugin/internal.ts:56-63` | `const post = [ConfigAgentPlugin.Plugin, ...]` | delete the array |
| `packages/core/src/plugin/internal.ts:76` | `const config = yield* Config.Service` | keep (still feeds `subagent`/`mcp`/`ExternalServerCreatorPlugin` wraps) |
| `packages/core/src/plugin/internal.ts:152-155,184-188` | `configured` wrapper + slice splice | delete; post list per §4 |
| `packages/server/src/workspace-runtime.ts:78` | `gatewayConfig` node with `deps: []` | `deps: [config]` (the `config` node already exists at line 77) |
| `packages/server/src/workspace-runtime.ts:76,79` | `WebSearch`/`Agent` nodes | add `config` to `deps` |
| `packages/core/src/plugin/README.md:113-117` | post table lists `bymorning.config.*` | rewrite (table is stale anyway); see also 05 |
| `packages/core/src/plugin/README.md:203-211` | "register config replay definitions in `post`" | reword: config projection is owned by the domains; `post` is for genuine post-phase built-ins |
| `packages/server/src/auth-postgres.test.ts:356-367` | full post ID list | update to §4's list |
| `packages/core/test/plugin-internal.test.ts:121` | `GatewayConfig.layer` merged without Config | add `Layer.succeed(Config.Service, config)` to the merge (layer build now requires Config) |
| `packages/core/test/integration/agent.test.ts:49,214`, `permission.test.ts` | `Agent.layer(...)` graphs | provide a plain-object `Config.Service` fake (pattern exists at `catalog.test.ts:152`) |
| `packages/core/test/websearch.test.ts:25` | `WebSearch.layer.pipe(Layer.provide(bus))` | also provide the Config fake |
| `packages/core/test/integration/integration.test.ts:317,518` | finds `bymorning.config.mcp` | unchanged |

Stale user Config entries need no data migration. `PluginSupervisor.resolve` treats `-bymorning.config.command` as a removal selector over `plugins()` (`supervisor.ts:204-209`) — with no matching definition it disables nothing. A bare `bymorning.config.command` target matches no definition, but `supervisor.ts:211-225` treats any `bymorning.*` target as a selector and `continue`s without attempting a package import, so it is inert, not a failed import. (Under `01-generation-pipeline.md` this resolution logic moves verbatim into `PluginGeneration` in `plugin/generation.ts`; the citations refer to its home at the time this spec lands.) The IDs simply disappear from `Plugin.Service.list()` / `GET /api/plugin` inventory.

## 6. Tests

| Existing test file | Action |
| --- | --- |
| `packages/core/test/plugin-internal.test.ts` — "reuses the workspace outbound MCP coordinator across internal definition reloads" (`:135-149`) | keep |
| … "registers the fixed Atlassian remote MCP server" (`:151-175`) | keep |
| … "exposes the deterministic builtin order and exact Bymorning guidance" (`:177-252`) | rewrite — post ID list per §4; pre list unchanged |
| … "installs every builtin product and scopes web search providers independently from its Tool" (`:254-479`) | keep |
| … "replays each config plugin's owning domains" (`:481-512`) | delete — replaced by domain-level tests; `replayContext` (`:589-603`) goes with it |
| `packages/core/test/websearch.test.ts` | keep + add config-following cases below |
| `packages/core/test/catalog.test.ts` | keep + add draft default view case |
| `packages/core/test/integration/agent.test.ts` | keep + add default-following case |
| `packages/core/test/plugin-supervisor.test.ts` | keep + add stale-selector cases |
| `packages/server/src/auth-postgres.test.ts:356-367` | rewrite list (see §5) |

New test cases:

- WebSearch: "applies the configured selection as Config changes" — with two providers registered, `default()` is random; publish a Config selecting `exa` and `default()` is exa; publish `websearch: false` and `default()` fails `WebSearch.Disabled`.
- WebSearch: "keeps the plugin-contributed default when Config omits a selection" — `draft.default.set` survives a Config update that clears `websearch`.
- Catalog: "seeds the draft default-model view from Config" — a plugin-style transform reads `draft.model.default.get()` and sees the Config value.
- Agent: "prefers the configured default agent over plugin and environment defaults" — drive `Agent.layer` with a Config fake.
- GatewayConfig: "projects the active Config as the gateway policy".
- Supervisor: "`-bymorning.config.command` and bare `bymorning.config.command` are inert selectors" — resolve yields no failures and no imports.
- `test/gateway-config.test.ts` (new file) hosts the GatewayConfig case.

Two representative tests driving the real implementations (plain-object Config fake per `AGENTS.md`; no mocks of the module under test):

```ts
// packages/core/test/websearch.test.ts (additions)
const baseConfig = ConfigSchema.Info.make({
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
})

const configLayer = (info: ConfigSchema.Info) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<unknown>()
    const current = Ref.make(info)
    const service = Config.Service.of({
      get: Ref.get(current),
      update: () => Effect.die(new Error("unused")),
      refresh: () => Effect.die(new Error("unused")),
      mcp: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      modelPolicy: { reconcile: () => Effect.die("unused"), toggle: () => Effect.die("unused"), setDefault: () => Effect.die("unused") },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.die(new Error("unused")),
      changes: () => Stream.fromPubSub(events),
    })
    const publish = (next: ConfigSchema.Info) =>
      Ref.set(current, next).pipe(Effect.andThen(PubSub.publish(events, { type: "config.updated" })))
    return { layer: Layer.succeed(Config.Service, service), publish }
  })

it.effect("applies the configured selection as Config changes", () =>
  Effect.gen(function* () {
    const config = yield* configLayer(baseConfig)
    const websearch = yield* WebSearch.Service
    yield* register("exa")
    yield* register("tavily")

    const initial = yield* websearch.default()
    expect(initial?.id).toBe(WebSearchSchema.ID.make("exa"))

    yield* config.publish({
      ...baseConfig,
      websearch: ConfigWebSearch.Info.make({ provider: WebSearchSchema.ID.make("tavily") }),
    })
    yield* Effect.yieldNow
    expect((yield* websearch.default())?.id).toBe(WebSearchSchema.ID.make("tavily"))

    yield* config.publish({ ...baseConfig, websearch: false })
    yield* Effect.yieldNow
    expect(yield* websearch.default().pipe(Effect.flip)).toBeInstanceOf(WebSearch.DisabledError)
  }).pipe(Effect.provide(Layer.merge(WebSearch.layer, config.layer, bus)), Effect.scoped),
)
```

```ts
// packages/core/test/gateway-config.test.ts (new file; the Config fake above moves to test/service-fixtures.ts so both files share it)
it.effect("projects the active Config as the gateway policy", () =>
  Effect.gen(function* () {
    const config = yield* configLayer(baseConfig)
    const gateway = yield* GatewayConfig.Service
    expect(yield* gateway.get).toEqual(baseConfig.gateway)

    const updated = { ...baseConfig, gateway: ConfigGateway.Info.make({ budget: 2_000 }) }
    yield* config.publish(updated)
    yield* Effect.yieldNow
    expect(yield* gateway.get).toEqual(updated.gateway)
  }).pipe(Effect.provide(Layer.merge(GatewayConfig.layer, config.layer)), Effect.scoped),
)
```

## 7. Preserved behavior

- **Selector semantics are untouched** — `supervisor.ts:203-225`, `README.md:86-96`; removed IDs resolve as inert selectors, never failed imports. (01 later moves this resolution into `PluginGeneration` unchanged.)
- **External plugins keep `config.updated`** — `host.ts:139-146,412-414` still projects the Bus event; `outbound-mcp.ts:524` keeps using `config.changes()` directly.
- **Config publish path is untouched** — `config.ts:95` publishes `Config.Event.Updated` on committed, non-equivalent patches only (`config.ts:134,144`).
- **Default precedence** — Config `default_agent` > plugin-contributed default > env `BYMORNING_DEFAULT_AGENT` > first selectable (`agent.ts:150-158`); Config `websearch` selection (including `false`) > plugin-set > `random` (`config/plugin/websearch.ts:15-16` sets the draft in the post phase; read at `websearch.ts:66-76`); Config `default_model` continues to drive `Catalog.model.default()` live (`catalog.ts:286-294`).
- **One adapter = hypothetical seam, two = real** — each replay plugin had exactly one Core caller and no external adapter; the plugin host seam (`packages/plugin`) remains real for external plugins via `context.*` drafts (`host.ts:97-368`).
- **`README.md:203-209` isolation** — domains now read Config inside Core layers that already own the graph context; no plugin-context capture is involved for these paths.
- **Timing improvements, not regressions** — projections become visible at layer build / live-read instead of after the post phase; today's window where `GatewayConfig.get` is `undefined` before post activation disappears.

## 8. Open decisions

1. **Redundant domain invalidations after config change** — today each config change re-materializes Command/Skill/Reference/Agent/Catalog and republishes `command.updated`/`reference.updated` with unchanged content (`command.ts:56`, `reference.ts:75`). Current behavior: broadcast-then-refetch-identical. Options: drop (recommended — the events carry no data; `config.updated` remains the invalidation signal) or keep a scoped reload subscription in Command/Reference. Default: drop; revisit only if a client demonstrably chains on those events.
2. **Gateway absorption** — `bymorning.config.gateway` is listed neither in the candidate file set nor as an owning domain, but `gateway.ts:7` imports the deleted `ConfigEntryObserver`, so it must change. Options: absorb (recommended — the domain's whole state is a Config projection; interface shrinks to `get`) or keep the plugin and inline a `config.changes()` subscription where `ConfigEntryObserver.observe` stood. Default: absorb.
3. **`Config.follow` location** — shared helper in `config.ts` (recommended: two to four users, and it owns the subscribe-race choreography from `entry-observer.ts:23-24`) versus inlining the fork per domain. Default: shared.
4. **Plugin-visible WebSearch default during pre-phase transforms** — today an external plugin transform reading `draft.default.get()` sees pre-config state because the config transform runs in the post phase; the live cell makes the configured selection visible there. Default: accept (more consistent; no bundled plugin depends on the old skew).

## 9. Sequencing

1. Add `Config.follow` to `packages/core/src/config.ts` (unused yet) — no behavior change.
2. Absorb WebSearch (cell + reload subscription); update `websearch.test.ts`; delete `config/plugin/websearch.ts`; drop its `internal.ts` entry; update order assertions.
3. Absorb GatewayConfig (live `get`, interface shrink); add `test/gateway-config.test.ts`; delete `config/plugin/gateway.ts`; update `workspace-runtime.ts` deps and `plugin-internal.test.ts` layer merge.
4. Absorb Agent and Catalog (cells in `ordered()` / draft view); extend `test/integration/agent.test.ts` and `test/catalog.test.ts`; delete `config/plugin/{agent,provider}.ts`; update `workspace-runtime.ts` deps.
5. Delete `config/plugin/{command,skill,reference}.ts` and `entry-observer.ts`; delete the "replays each config plugin's owning domains" test; update `auth-postgres.test.ts` and README wording.
6. Add the supervisor stale-selector cases; run `bun test` and `bun typecheck` from `packages/core`, then the docs build if `README.md` links changed. (Spec 05, if adopted, lands after this and removes the remaining `internal.ts` hand-wraps.)
