# 05 — Deepen internal built-in composition

> **Historical proposal, not implemented architecture.** The declaration/compose redesign and line-numbered
> sketches below are not approved implementation instructions. They also include removed builtin examples and
> legacy Tool callback shapes; do not restore those APIs. [Tool registration](../tool-registration.md) is the
> canonical approved migration contract. No new public plugin API is proposed by this update.

## Tool/Mcp reconciliation and verification limits

Core consumers use public `Mcp` from `packages/core/src/mcp.ts`; remote implementation remains private in `mcp/`.
Mcp acquires Integration, Credential, OAuth callback, and Bus directly. Internal plugin configuration delegates
through the existing service; it does not create a client service from PluginContext. Private `tool/mcp.ts` installs
one stable discovery transform in the existing Tool registry, and workspace boot awaits its initial flush.

One Tool registry belongs to each member graph, shared by Session and inbound gateway. Publication uses a
winning-provenance prefilter in shared direct/CodeMode snapshot preparation, not dual registration.
**Member registry isolation is verified for the recorded regression:** `WorkspaceMap.node` applies `Layer.fresh`
around the complete compiled member graph after hoisting globals, preventing static Tool Layers from sharing
captured member services through `LayerMap`'s memo map. The workspace-map regression and real
`app/test/tool-auth.test.ts` (1/1 passed; app typecheck exit 0) cover member ownership, refresh, and revocation.
Builtin caller resource binding and the MCP same-provider race now have independent regression verification;
OpenAPI production-host safety is also independently verified (55 focused tests, including 13 host cases). Final
published-artifact suites passed: Core integration 200 tests/17 files, Server with Docker 121/24, and Application
45/12, all with 0 skips and exit 0. The 5 real Application Docker scenarios add no binary/media export from `run`.
The full Application browser suite passed 8 tests/0 skips; Protocol passed 60 tests. Generated contract checks and
typechecks pass; the isolated docs build passed 162 pages and link validation passed. These complete the recorded
checks without expanding independent security/export scope. See the canonical
[verification checkpoint](../tool-registration.md#implementation-checkpoint--verification-gates).

Builtin caller binding is implemented in plugin-private `plugin/internal/tool/binding.ts`, with typed
registration-time dependencies and real member-filtered Session/Project validation. Independent review reran the
original caller-A / ambient-directory-B reproduction using A, mismatch rejection, and success/defect finalizers.
The recorded PostgreSQL/focused regressions establish this gate, not the historical declaration/compose proposal
below. Successful activation alone remains insufficient evidence; preserve the canonical contract's safety requirements.

## 1. Summary

Adding one internal built-in plugin today requires knowing `Plugin.load` context-isolation internals: which Workspace authorities survive activation, which phase the definition belongs to, which of three hand-wiring styles to use, and which exact-order assertions to update. Order lives in three places — the README table, the `internal.ts` arrays, and the test — and already drifted. This spec moves each built-in to a declarative entry (definition + its Effect requirement type `R` + phase) and one `compose` that provides the captured authorities, so the requirement type flows through and a missing authority is a compile error, while `internal.ts` becomes an ordered list. Nothing is exported from `@bymorning/plugin`, and no external plugin ever receives the Workspace context.

## 2. Historical shape (before Tool migration)

`packages/core/src/plugin/internal.ts` (195 lines) is the wiring module. It yields ~15 Workspace authorities up front because `Plugin.load` replaces the Effect context at activation:

```ts
// packages/core/src/plugin.ts:99-110 — the isolation every wrapper works around
const loaded = yield* Effect.suspend(() =>
  configurationError === undefined
    ? plugin.effect(PluginHost.make({ ...services, bus, plugin: registry }, plugin.id, options, plugin.source))
    : Effect.die(new Error(configurationError)),
).pipe(
  inherit,
  Effect.updateContext((context: Context.Context<never>) =>
    Context.make(Scope.Scope, child).pipe(
      Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
      Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
    ),
  ),
```

```ts
// packages/core/src/plugin/internal.ts:76-90 — capture phase (15 yields)
const config = yield* Config.Service
const gateway = yield* GatewayConfig.Service
const toolOutput = yield* ToolOutput.Service
const runtime = yield* PluginRuntime.Service
const mcp = yield* Mcp.Service
const bus = yield* Bus.Service
const instruction = yield* InstructionDiscovery.Service
const project = yield* Project.Service
const storage = yield* Storage.Service
const policy = yield* Policy.Service
const managedPolicy = yield* ManagedPolicy.Service
const tools = yield* Tool.Service
const context7Endpoint = yield* Context7Endpoint
const http = yield* HttpClient.HttpClient
const models = yield* modelInventory
```

Then three ad-hoc wiring styles, none typed against the definition's real requirement:

```ts
// internal.ts:91-94 — spread + provideService over an already-typed definition (websearch: R erased by hand)
const websearch = WebSearchPlugins.map((plugin): Plugin => ({
  ...plugin,
  effect: (host) => plugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http)),
}))
// internal.ts:95-98 — same for shell
// internal.ts:99-106 — same for subagent (Config + PluginRuntime)
// Historical wrapper: context7 (now consumes public Mcp + Context7Endpoint)
// internal.ts:115-125 — same for the policy tool (Policy + ManagedPolicy)
// Historical wrapper: MCP config plugin (now consumes Config + public Mcp)
// internal.ts:134-151 — same for instruction and gateway config plugins

// internal.ts:152-155 — a blanket wrapper for the six config replay entries
const configured = post.map((plugin): Plugin => ({
  ...plugin,
  effect: (host) => plugin.effect(host).pipe(Effect.provideService(Config.Service, config)),
}))

// internal.ts:184-193 — hand-spliced ordering
post: [
  ...configured.slice(0, 5),
  gatewayConfig,
  instructionConfig,
  ...configured.slice(5),
  mcp,
  AtlassianMCPPlugin,
  McpCodeModeExclusionPlugin,
  makeModelRoutingPlugin(models.all, models.available),
],
```

Five factories exist only to inject a captured service or value positionally, which `README.md:178-180` forbids:

- `ToolOutputPlugin(toolOutput)` — `packages/core/src/plugin/internal/tool/tool-output.ts:21`
- `PolicyToolPlugin(tools)` — `packages/core/src/plugin/internal/tool/policy.ts:70` (the effect already yields `Policy.Service`/`ManagedPolicy.Service` itself at `policy.ts:75-76`; only `tools` is positional)
- `ExternalServerCreatorPlugin(config)` — `packages/core/src/plugin/internal/tool/external-server.ts:43`
- `makeGoogleGmailPlugin(client)` — `packages/core/src/plugin/internal/integration/google-gmail/index.ts:27`
- `makeModelRoutingPlugin(models, destinations)` — `packages/core/src/plugin/internal/policy/model-routing.ts:7` (the only one injecting a *data snapshot*, needed because `configuration` is a static definition property; see Open decisions)

Definition-side requirements are already expressible — `define<R>` accepts any `R` and Tavily uses it (`packages/core/src/plugin/internal/websearch/tavily.ts:30`, `define<HttpClient.HttpClient | Scope.Scope>`) — but nothing consumes that `R`: each wrapper erases it with hand-picked `provideService` calls, and a missing authority is a runtime "Service not found" defect surfacing as a failed inventory row.

The three sources of truth for order, already inconsistent:

- `packages/core/src/plugin/README.md:113-117` — pre list omits `google.gmail.openapi` and the four `core.websearch.*` providers; post list omits `bymorning.config.gateway`, `bymorning.config.instruction`, `atlassian-mcp`, `bymorning.mcp.codemode.exclusion`, and `bymorning.model-routing`.
- `internal.ts:157-193` — the arrays.
- `packages/core/test/plugin-internal.test.ts:181-224` — the exact ID assertions (this is the correct list, including everything the README misses).

`packages/core/src/plugin/composition.ts:9-12` is the only caller of `PluginInternal.list`, passing the catalog-backed model inventory; `supervisor.ts:58-69` re-runs it on every reload and provides the whole graph (provide at `supervisor.ts:64`; the composition is entered at `supervisor.ts:108,114,146`). `packages/core/test/plugin-internal.test.ts` (603 lines) is the hottest test file; its activation test (`:254-479`) drives every pre definition through the real registry, so it already catches runtime wiring mistakes — after the fact, not at compile time.

## 3. Proposed interface

All of this lives in `packages/core/src/plugin/internal/declaration.ts` and is internal to Core. Nothing is added to `@bymorning/plugin`; no external (package/Project) plugin can import it, and no external plugin's `context` gains Effect services (`packages/plugin/AGENTS.md`: "Internal Core plugins may receive injected services through Core composition, but that is not public plugin API").

```ts
// packages/core/src/plugin/internal/declaration.ts (new file)
export * as PluginDeclaration from "./declaration.js"

import type { Plugin } from "@bymorning/plugin/effect/plugin"
import { Context, Effect, Scope } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { GatewayConfig } from "../../gateway-config.js"
import { InstructionDiscovery } from "../../instruction-discovery.js"
import { ManagedPolicy } from "../../managed-policy.js"
import { Mcp } from "../../mcp.js"
import { Policy } from "../../policy.js"
import { PluginRuntime } from "../runtime.js"
import { Storage } from "../../storage.js"
import { Tool } from "../../tool.js"
import { ToolOutput } from "../../tool-output.js"
import type { Context7Endpoint } from "./tool/context7.js"

/**
 * Services an internal definition may require across Plugin.load context
 * isolation. Scope is deliberately excluded: the registry installs the
 * activation scope, and capturing a scope here would attach plugin finalizers
 * to the wrong lifetime.
 */
export type CapturedRequirement =
  | Bus.Service
  | Config.Service
  | Context7Endpoint
  | GatewayConfig.Service
  | HttpClient.HttpClient
  | InstructionDiscovery.Service
  | ManagedPolicy.Service
  | Mcp.Service
  | PluginRuntime.Service
  | Policy.Service
  | Project.Service
  | Storage.Service
  | Tool.Service
  | ToolOutput.Service

export type InternalRequirement = CapturedRequirement | Scope.Scope

/** One Workspace snapshot of the captured authorities, provided to every internal definition. */
export type Authorities = Context.Context<CapturedRequirement>

export interface Declaration {
  readonly phase: "pre" | "post"
  readonly plugin: Plugin<InternalRequirement>
}

export interface Composition {
  readonly pre: readonly Plugin<Scope.Scope>[]
  readonly post: readonly Plugin<Scope.Scope>[]
}

/** Provide the captured authorities to each declaration; array order within a phase is activation order. */
export const compose = (authorities: Authorities, declarations: readonly Declaration[]): Composition => {
  const activate = (declaration: Declaration): Plugin<Scope.Scope> => ({
    ...declaration.plugin,
    effect: (host) => Effect.provideContext(declaration.plugin.effect(host), authorities),
  })
  return {
    pre: declarations.filter((declaration) => declaration.phase === "pre").map(activate),
    post: declarations.filter((declaration) => declaration.phase === "post").map(activate),
  }
}
```

The enforcement points, both compile-time:

1. **A definition requiring an uncaptured service fails at its declaration entry.** `Plugin<InternalRequirement>` is the declared type of `Declaration.plugin`; `Effect`'s third parameter is covariant in v4 (`Effect<out A, out E, out R>`, `effect` 4.0.0-rc.112 `src/Effect.ts:117`), so plain `Plugin<Scope.Scope>` definitions fit, but a definition requiring e.g. `Database.Service` — including un-annotated definitions whose `R` is inferred from `yield*` in their `effect` generator, like `ConfigInstructionPlugin` — does not. Because the authority context contains *every* member of `CapturedRequirement`, `Effect.provideContext` (`Effect.provideContext: <XR>(context: Context.Context<XR>) => <A, E, R>(self) => Effect<A, E, Exclude<R, XR>>`) erases exactly `CapturedRequirement`, leaving `Scope.Scope` — so the wrapped plugin satisfies `Plugin<Scope.Scope>` and the supervisor's `builtin(plugin: EffectPlugin<Scope.Scope>)` unchanged.
2. **A capture missing a member of `CapturedRequirement` fails at the capture.** The capture's local is annotated `: Authorities`, so forgetting an entry is a type error, not a runtime defect.

`Effect.provideContext` merges via `Context.merge(context, current)`-shaped update where the *provided* context wins on conflicts — which is precisely why `CapturedRequirement` must exclude `Scope.Scope`: the fresh `Context.make(...)` authorities contain no scope, so the registry-installed activation scope (`plugin.ts:106`) survives the merge. This is the invariant the type encodes.

`PluginInternal.list` keeps its name and its model-inventory parameter (so tests can stub the catalog cheaply, as they do today at `plugin-internal.test.ts:138,179,263,487`):

```ts
// packages/core/src/plugin/internal.ts (new shape; exports unchanged: `list`)
export const list: (
  modelInventory: Effect.Effect<
    { readonly all: ReadonlyArray<Model.Info>; readonly available: ReadonlyArray<Model.Info> },
    never,
    Catalog.Service
  >,
) => Effect.Effect<Composition, never, CapturedRequirement | Catalog.Service>
```

## 4. Implementation sketch

### `plugin/internal/declaration.ts`

As shown in §3.

### Converted built-in 1 — `tool-output.ts`: factory becomes a static definition

```ts
// packages/core/src/plugin/internal/tool/tool-output.ts
export * as ToolOutputPluginModule from "./tool-output.js"

import { ID } from "@bymorning/schema/tool-output"
import { NonNegativeInt, optional } from "@bymorning/schema/schema"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { Tool } from "../../../tool.js"
import { ToolOutput } from "../../../tool-output.js"

// Input/Output schemas unchanged (tool-output.ts:9-18)

/** The core stored Tool output retrieval plugin; the Workspace authority is captured by composition. */
export const ToolOutputPlugin = define<ToolOutput.Service | Scope.Scope>({
  id: "core.tool.tool-output",
  effect: (context) =>
    Effect.gen(function* () {
      const toolOutput = yield* ToolOutput.Service
      const tool = Tool.define({
        name: "tool_output",
        options: { codemode: false },
        description: "Retrieve one bounded page of stored Tool output. Use the returned byte cursor to continue reading.",
        input: Input,
        output: Output,
        execute: (context) =>
          Effect.gen(function* () {
            yield* context.permission({
              action: "tool_output",
              resources: [context.input.outputID],
              save: [context.input.outputID],
              metadata: { outputID: context.input.outputID, cursor: context.input.cursor ?? 0 },
            })
            const page = yield* toolOutput
              .readForTool(
                context.sessionID,
                context.input.outputID,
                context.input.cursor === undefined ? {} : { cursor: context.input.cursor },
              )
              .pipe(Effect.mapError(() => new ToolFailure({ message: "Tool output is unavailable" })))
            const next = page.cursor < page.size ? page.cursor : undefined
            return {
              result: next === undefined ? {} : { next },
              content: [{ type: "text" as const, text: page.content }],
              metadata: {
                truncated: next !== undefined,
                outputID: context.input.outputID,
                cursor: context.input.cursor ?? 0,
                ...(next === undefined ? {} : { next }),
              },
            }
          }),
      })
      yield* Effect.asVoid(context.tool.transform((draft) => draft.add(tool)))
    }),
})
```

This historical test sketch is not a current passing-test claim. Tool output retrieval must be verified through
the current host and caller-bound execution path, including rejection of mismatched Session/Project context.

### Converted built-in 2 — `policy.ts`: positional `tools` becomes a requirement

```ts
// packages/core/src/plugin/internal/tool/policy.ts — head only; body (policy.ts:74-216) unchanged
/** Core agent-callable policy management Tools; Workspace authorities are captured by composition. */
export const PolicyToolPlugin = define<Tool.Service | Policy.Service | ManagedPolicy.Service | Scope.Scope>({
  id: "core.tool.policy",
  effect: (context) =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const policy = yield* Policy.Service
      const managed = yield* ManagedPolicy.Service
      // ... policy.ts:78-214 verbatim ...
    }),
})
```

Same one-line pattern for `ExternalServerCreatorPlugin` (`external-server.ts:43-63`: `define<Config.Service | Scope.Scope>`, `const config = yield* Config.Service` inside the effect; the exported `createExternalServer(config, context)` helper keeps its parameter because it is a plain function used by `external-server.test.ts`) and `makeGoogleGmailPlugin(client)` → static `GoogleGmailPlugin = define<HttpClient.HttpClient | Scope.Scope>` with `const client = yield* HttpClient.HttpClient` inside the effect (`google-gmail/index.ts:27-31`; the body is otherwise verbatim).

### Converted built-in 3 — `shell.ts` and `websearch/tavily.ts`: unchanged code, typed requirements flow

Neither file changes. `ShellPlugin` (`shell.ts:167-176`) already yields `PluginRuntime.Service` inside its effect; `WebSearchTavily.Plugin` already declares `define<HttpClient.HttpClient | Scope.Scope>` (`tavily.ts:30-33`). What changes is that the wrapper is generated from the requirement instead of hand-written per plugin:

```ts
// entries in internal.ts (below) replace internal.ts:91-98 entirely
{ phase: "pre", plugin: ShellPlugin },
{ phase: "pre", plugin: WebSearchTavily.Plugin },
```

### Kept factory — `model-routing.ts`

`makeModelRoutingPlugin` stays a factory because it injects the catalog *snapshot* that its static `configuration` form is built from (`model-routing.ts:8-32`); `configuration` is read at activation by `supervisor.ts:314-318` for versioning, so it cannot be built inside `effect`. It injects data, not a service, so it does not violate the factory rule.

### The new `internal.ts`

```ts
// packages/core/src/plugin/internal.ts
export * as PluginInternal from "./internal.js"

import type { Model } from "@bymorning/schema/model"
import { Context, Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Catalog } from "../catalog.js"
import { Config } from "../config.js"
import { GatewayConfig } from "../gateway-config.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { ManagedPolicy } from "../managed-policy.js"
import { Mcp } from "../mcp.js"
import { Policy } from "../policy.js"
import { Project } from "../project.js"
import { Storage } from "../storage.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { Bus } from "../bus.js"
import { PluginRuntime } from "./runtime.js"
import { compose, type Authorities, type CapturedRequirement, type Declaration } from "./internal/declaration.js"
import { Context7Endpoint, Context7Plugin } from "./internal/tool/context7.js"
import { ProviderIntegrationPlugin } from "./internal/provider.js"
import { McpCodeModeExclusionPlugin } from "./internal/mcp-codemode-exclusion.js"
import { GoogleGmailPlugin } from "./internal/integration/google-gmail/index.js"
import { WebSearchExa } from "./internal/websearch/exa.js"
import { WebSearchFirecrawl } from "./internal/websearch/firecrawl.js"
import { WebSearchParallel } from "./internal/websearch/parallel.js"
import { WebSearchTavily } from "./internal/websearch/tavily.js"
// ... remaining tool/agent/skill/atlassian imports as today (internal.ts:19-54) ...
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { ConfigGatewayPlugin } from "../config/plugin/gateway.js"
import { ConfigCommandPlugin } from "../config/plugin/command.js"
import { ConfigProviderPlugin } from "../config/plugin/provider.js"
import { ConfigSkillPlugin } from "../config/plugin/skill.js"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch.js"
import { ConfigInstructionPlugin } from "../config/plugin/instruction.js"
import { makeModelRoutingPlugin } from "./internal/policy/model-routing.js"

/**
 * Ordered internal declarations. Array order is activation order within each
 * phase (pre, external, post); selectors may exclude any entry, so no entry may
 * rely on another merely being earlier.
 *
 * Ordering dependency on 02-config-replay-plugins.md: if 02 has landed, its six
 * `Config*Plugin` post entries (and `ConfigGatewayPlugin`, if the gateway was
 * absorbed) are absent here — see Open decision 5. This array is drawn against
 * pre-02 code so both specs remain independently applicable.
 */
export const declarations = [
  { phase: "pre", plugin: ProviderIntegrationPlugin },
  { phase: "pre", plugin: GoogleGmailPlugin },
  { phase: "pre", plugin: WebSearchExa.Plugin },
  { phase: "pre", plugin: WebSearchFirecrawl.Plugin },
  { phase: "pre", plugin: WebSearchParallel.Plugin },
  { phase: "pre", plugin: WebSearchTavily.Plugin },
  { phase: "pre", plugin: AddPlugin },
  { phase: "pre", plugin: GlobPlugin },
  { phase: "pre", plugin: GrepPlugin },
  { phase: "pre", plugin: ReadPlugin },
  { phase: "pre", plugin: ToolOutputPlugin },
  { phase: "pre", plugin: WritePlugin },
  { phase: "pre", plugin: EditPlugin },
  { phase: "pre", plugin: ShellPlugin },
  { phase: "pre", plugin: ExecutePlugin },
  { phase: "pre", plugin: WebSearchToolPlugin },
  { phase: "pre", plugin: Context7Plugin },
  { phase: "pre", plugin: SkillToolPlugin },
  { phase: "pre", plugin: QuestionToolPlugin },
  { phase: "pre", plugin: PolicyToolPlugin },
  { phase: "pre", plugin: SubagentToolPlugin },
  { phase: "pre", plugin: ExternalServerCreatorPlugin },
  { phase: "pre", plugin: ExternalServerSkillPlugin },
  { phase: "pre", plugin: BymorningPlugin },
  { phase: "pre", plugin: DefaultAgentPlugin },
  { phase: "pre", plugin: BuildAgentPlugin },
  { phase: "pre", plugin: GeneralAgentPlugin },
  { phase: "pre", plugin: ExploreAgentPlugin },
  { phase: "post", plugin: ConfigAgentPlugin.Plugin },
  { phase: "post", plugin: ConfigSkillPlugin.Plugin },
  { phase: "post", plugin: ConfigCommandPlugin.Plugin },
  { phase: "post", plugin: ConfigProviderPlugin.Plugin },
  { phase: "post", plugin: ConfigReferencePlugin.Plugin },
  { phase: "post", plugin: ConfigGatewayPlugin.Plugin },
  { phase: "post", plugin: ConfigInstructionPlugin.Plugin },
  { phase: "post", plugin: ConfigWebSearchPlugin.Plugin },
  { phase: "post", plugin: Mcp.Plugin },
  { phase: "post", plugin: AtlassianMCPPlugin },
  { phase: "post", plugin: McpCodeModeExclusionPlugin },
] as const satisfies readonly Declaration[]

/** Capture the Workspace authorities internal definitions require across Plugin.load context isolation. */
const capture = Effect.fn("PluginInternal.capture")(function* () {
  const bus = yield* Bus.Service
  const config = yield* Config.Service
  const context7Endpoint = yield* Context7Endpoint
  const gateway = yield* GatewayConfig.Service
  const http = yield* HttpClient.HttpClient
  const instruction = yield* InstructionDiscovery.Service
  const managedPolicy = yield* ManagedPolicy.Service
  const mcp = yield* Mcp.Service
  const policy = yield* Policy.Service
  const project = yield* Project.Service
  const runtime = yield* PluginRuntime.Service
  const storage = yield* Storage.Service
  const tools = yield* Tool.Service
  const toolOutput = yield* ToolOutput.Service
  // Every CapturedRequirement member must appear here or this annotation fails to compile.
  const authorities: Authorities = Context.make(Bus.Service, bus).pipe(
    Context.add(Config.Service, config),
    Context.add(Context7Endpoint, context7Endpoint),
    Context.add(GatewayConfig.Service, gateway),
    Context.add(HttpClient.HttpClient, http),
    Context.add(InstructionDiscovery.Service, instruction),
    Context.add(ManagedPolicy.Service, managedPolicy),
    Context.add(Mcp.Service, mcp),
    Context.add(Policy.Service, policy),
    Context.add(Project.Service, project),
    Context.add(PluginRuntime.Service, runtime),
    Context.add(Storage.Service, storage),
    Context.add(Tool.Service, tools),
    Context.add(ToolOutput.Service, toolOutput),
  )
  return authorities
})

/** Build the ordered internal plugin generations for one Workspace activation. */
export const list = Effect.fn("PluginInternal.list")(function* (
  modelInventory: Effect.Effect<
    { readonly all: ReadonlyArray<Model.Info>; readonly available: ReadonlyArray<Model.Info> },
    never,
    Catalog.Service
  >,
) {
  const authorities = yield* capture
  const models = yield* modelInventory
  return compose(authorities, [
    ...declarations,
    { phase: "post", plugin: makeModelRoutingPlugin(models.all, models.available) },
  ])
})
```

What disappears: the `post` const (`internal.ts:56-63`), the eight spread-and-`provideService` wrapper groups (`internal.ts:91-151`), the `configured` blanket wrapper (`internal.ts:152-155`), and the `configured.slice(0, 5)` / `configured.slice(5)` splice (`internal.ts:184-188`). What is gained: adding an internal plugin is "define it (typed `R`), add one `{ phase, plugin }` line, extend `CapturedRequirement` + `capture` only if it needs a new service" — no knowledge of isolation internals, wiring style, or which authorities survive.

### Historical proposed correctness argument — not verified isolation

- **Activation scope survives.** The authorities context contains no `Scope.Scope` (type-excluded and absent from the fresh `Context.make`), so `Effect.provideContext`'s merge cannot shadow the child scope `plugin.ts:106` installs; `shell.ts:172` and `subagent.ts:75-76` keep receiving the activation scope.
- **Per-generation capture.** `capture` runs on every `list()` call exactly as the fifteen yields do today (`supervisor.ts:58-69` re-runs `internal` per reload), so captured values stay per-activation snapshots of the workspace graph.
- **External plugins are untouched.** `supervisor.ts:267-312` loads package/Project modules exactly as before; their `R` is whatever they declare, unmet requirements still surface as failed inventory rows, and they have no path to `Authorities` or `compose`.

## 5. Caller migration

| Production call site | Current | New |
| --- | --- | --- |
| `packages/core/src/plugin/internal.ts` (whole file) | capture + 8 hand-wrap groups + slice-spliced arrays | `declarations` + `capture` + `list` per §4 |
| `packages/core/src/plugin/internal/tool/tool-output.ts:21` | `ToolOutputPlugin(toolOutput)` factory | static `define<ToolOutput.Service \| Scope.Scope>` |
| `packages/core/src/plugin/internal/tool/policy.ts:70` | `PolicyToolPlugin(tools)` factory | static `define<Tool.Service \| Policy.Service \| ManagedPolicy.Service \| Scope.Scope>` |
| `packages/core/src/plugin/internal/tool/external-server.ts:43` | `ExternalServerCreatorPlugin(config)` factory | static `define<Config.Service \| Scope.Scope>`; `createExternalServer(config, …)` unchanged |
| `packages/core/src/plugin/internal/integration/google-gmail/index.ts:27` | `makeGoogleGmailPlugin(client)` factory | static `GoogleGmailPlugin = define<HttpClient.HttpClient \| Scope.Scope>` |
| `packages/core/src/plugin/internal/tool/shell.ts`, `subagent.ts`, `context7.ts`, `websearch/*.ts`, `internal/mcp-codemode-exclusion.ts`, `internal/atlassian-mcp.ts`, agents, skills | static definitions, some with typed `R` | unchanged; their `R` now flows through `Declaration` |
| `packages/core/src/plugin/composition.ts:10-12` | `PluginInternal.list(Catalog.Service.use(...))` | unchanged (signature preserved) |
| `packages/core/src/plugin/supervisor.ts:38-106,108-110,314-318` | `layerWith`, `builtin`, endpoint layers | unchanged — composed output is `readonly Plugin<Scope.Scope>[]` |
| `packages/core/src/plugin/README.md:174-232` | manual capture/provide recipe + checklist | rewritten to the declaration workflow (see below) |
| `packages/core/test/plugin-internal.test.ts:138,179,263,487` | `PluginInternal.list(Effect.succeed({ all: [], available: [] }))` | unchanged (parameter preserved) |

README sections to update:

- `README.md:113-117` — replace the stale hand-copied ID tables with the ordering rule (pre → external → post; declaration order within a phase; selectors may exclude any built-in) plus a pointer to `declarations` in `plugin/internal.ts` as the single order source, pinned by the test. Keeping the table would preserve a third source of truth.
- `README.md:141` — host capability list is stale: add `location`, `gateway`, `instruction`, `mcp`, `policy` to match `packages/plugin/src/effect/plugin.ts:24-46`.
- `README.md:176-180` — drop "config plugin modules conventionally export `Plugin`" guidance only insofar as spec 02 removes them; the "never add a plugin factory merely to inject a service" rule now has no sanctioned exceptions.
- `README.md:203-209` — the capture/provide paragraph becomes: requirements are declared as the definition's Effect `R`; `PluginInternal.capture` snapshots the Workspace authorities once per activation; `compose` provides them via `Effect.provideContext`; `Scope.Scope` must never be captured.
- `README.md:225-232` — checklist items become: define with typed `R`; add the `{ phase, plugin }` entry; extend `CapturedRequirement` and `capture` only if a new service is needed; update the exact-order test; run the focused plugin tests.

## 6. Tests

| Existing test file | Action |
| --- | --- |
| `packages/core/test/plugin-internal.test.ts` — "reuses the workspace outbound MCP coordinator across internal definition reloads" (`:135-149`) | keep — still asserts `list()` stability across reloads |
| … "registers the fixed Atlassian remote MCP server" (`:151-175`) | keep (activates `AtlassianMCPPlugin.effect` directly — that test targets one contribution, not the module under composition) |
| … "exposes the deterministic builtin order and exact Bymorning guidance" (`:177-252`) | keep, unchanged — see the argument below |
| … "installs every builtin product and scopes web search providers independently from its Tool" (`:254-479`) | Historical activation coverage only; it does not establish caller-bound execution or cross-member isolation |
| … "replays each config plugin's owning domains" (`:481-512`) | keep under this spec; deleted by spec 02 |
| `test/tool-output-plugin.test.ts`, `test/policy-tool.test.ts`, `test/external-server.test.ts`, `test/google-gmail-plugin.test.ts` | keep — they drive the converted definitions through the host; only factory-argument plumbing in the test setup changes |
| `test/plugin-supervisor.test.ts` | keep unchanged — `layerWith` input type is unchanged |

**The exact-order test stays explicit, not derived.** Deriving the expected IDs from `declarations` would make the test assert that the code equals itself; it pins nothing. Its value is as the module's test surface: activation order is observable behavior (tool snapshot order, contribution precedence, and the README contract all follow from it), so one explicit expected array is the cheapest tripwire against accidental reordering, and the `slice(0, 5)` splice that made order hard to see can no longer drift silently. The behavioral order consequences remain covered by the tool-snapshot assertion (`:270-306`), which is already derived from real activation. New test cases:

- Type-level: "a definition requiring an uncaptured service is rejected" — a `*.type-test.ts` guarded by `@ts-expect-error`, verified by `bun typecheck` (convention exists in `packages/plugin/src/effect/integration.type-test.ts`):

```ts
// packages/core/test/plugin-internal-declaration.type-test.ts
import type { PluginDeclaration } from "../src/plugin/internal/declaration.js"
import { Database } from "../src/database.js"
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"

const uncaptured = define({
  id: "test.uncaptured",
  effect: () =>
    Effect.gen(function* () {
      yield* Database.Service
    }),
})

// Database.Service is not part of CapturedRequirement; the declaration must not compile.
// @ts-expect-error — effect requires a service outside InternalRequirement
export const rejected: PluginDeclaration.Declaration = { phase: "pre", plugin: uncaptured }
```

- One representative runtime test, driving the real composition (no fakes of the module under test — the fake graph services are the test's own dependencies, as the file already does at `:45-87`):

```ts
// packages/core/test/plugin-internal.test.ts (addition)
testEffect("composes every declaration with its captured authorities", () =>
  Effect.gen(function* () {
    const internal = yield* PluginInternal.list(Effect.succeed({ all: [], available: [] }))
    const pre = internal.pre.map((plugin) => plugin.id)
    const post = internal.post.map((plugin) => plugin.id)
    // Every declaration appears exactly once, in its declared phase, with no duplicate IDs.
    expect(new Set([...pre, ...post]).size).toBe(pre.length + post.length)
    expect(pre).toContain("core.tool.shell")
    expect(pre).toContain("core.websearch.tavily")
    expect(post).toContain("bymorning.model-routing")
  }).pipe(
    Effect.provideService(Config.Service, config),
    Effect.provideService(ToolOutput.Service, toolOutput),
    Effect.provideService(PluginRuntime.Service, runtime),
  ),
)
```

(The existing "installs every builtin product" test remains the deep end-to-end assertion: it activates the composed output through `Plugin.Service`, exercising the same isolation bridge as production.)

## 7. Preserved behavior

- **Activation order** — `compose` preserves declaration order per phase; the resulting `pre`/`post` ID sequences are identical to `internal.ts:157-193` today, pinned by `plugin-internal.test.ts:181-224`. `README.md:111` (pre, external in first-target order, post) is unchanged (`supervisor.ts:253-262`).
- **Context isolation** — `Plugin.load` still replaces the context with only the activation scope and log context (`plugin.ts:99-110`); `README.md:203-209` unchanged in intent, only its mechanism description is updated.
- **Scope correctness** — `Scope.Scope` is never captured; plugin-scoped transforms, `forkScoped`, and finalizers keep binding to the activation scope (`README.md:215-217`; `shell.ts:172`, `subagent.ts:76`).
- **Per-activation capture** — `capture` runs once per `list()` call, which the supervisor re-runs on every reload (`supervisor.ts:58-69`), matching today's yield-per-call semantics (`internal.ts:76-90`).
- **Registry and supervisor contracts** — `Plugin.activate` dedupe/restore (`plugin.ts:126-130,182-188`), `builtin()` versioning from `configuration` (`supervisor.ts:314-318`), and selector resolution (`supervisor.ts:203-225`) are untouched.
- **Public surface** — `packages/plugin` exports are unchanged; `define<R>` already existed (`packages/plugin/src/effect/plugin.ts:55-57`); external plugins never receive `Authorities` (no Core import path, no host capability change at `host.ts:90-371`).

## 8. Open decisions

1. **Model inventory as parameter vs `Catalog.Service` requirement.** Current behavior: `list(modelInventory)` takes the catalog snapshot as an effect parameter (`internal.ts:66-74`), letting tests stub it with `Effect.succeed({ all: [], available: [] })`. Options: keep the parameter (recommended — keeps `plugin-internal.test.ts` light; Catalog's layer needs Provider/Model/Integration/Config and would balloon four test graphs) or have `list` require `Catalog.Service` directly and drop the parameter. Default: keep.
2. **Exact-order test: explicit vs derived.** Current behavior: `plugin-internal.test.ts:181-224` pins both phases explicitly. Options: keep explicit (recommended, argued in §6) or replace with a loop over `declarations` (asserts nothing beyond `compose`'s `filter`). Default: keep, with the derived duplicate-IDs assertion added.
3. **Central list vs colocated declarations.** Current behavior: all wiring in one file. Options: central `declarations` array (recommended — order *is* the interface, and one ordered list makes reordering reviewable in one diff) vs each built-in file exporting its own `Declaration` collected via a registry import side-effect (hides order across ~20 files). Default: central list.
4. **Type-level negative test placement.** Core has no `.type-test.ts` convention yet; the negative test is verified by `bun typecheck`, not `bun test`. Options: introduce `test/plugin-internal-declaration.type-test.ts` (recommended — it documents the compile-error guarantee the spec promises) or rely on the `satisfies readonly Declaration[]` at the `declarations` array alone. Default: introduce it.
5. **Interaction with spec 02.** If 02-config-replay-plugins.md lands first, the six `Config*Plugin` imports and their six `post` entries disappear from `declarations`, `capture` keeps `Config.Service` (subagent/MCP/external-server still require it), and the `GatewayConfig` entry drops if the gateway is absorbed. Both specs are written to apply independently against current code.

## 9. Sequencing

1. Add `plugin/internal/declaration.ts` (`CapturedRequirement`, `Declaration`, `compose`) with the type-test; nothing consumes it yet.
2. Convert the four service-injecting factories to static definitions (`tool-output.ts`, `policy.ts`, `external-server.ts`, `google-gmail/index.ts`), updating their tests' setup only; keep the old wrappers temporarily by calling the now-static definitions where the factories stood.
3. Introduce `declarations` + `capture` + new `list` in `internal.ts`; delete the hand-wraps and the slice splice; verify `plugin-internal.test.ts:181-224` still passes unchanged (order must be identical).
4. Update `README.md` sections listed in §5 (order rule, host capability list, registration workflow, checklist).
5. Run the focused plugin tests plus `plugin-internal.test.ts` and `plugin-supervisor.test.ts`, then core formatting, lint, `git diff --check`, and `bun typecheck` from `packages/core`.
