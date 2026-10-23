# 04 — Stop hand-mirroring the Effect and Promise plugin interfaces

Status: proposed design · Target: `packages/plugin` (+ adapter tests in `packages/core`)

## Summary

`packages/plugin` defines every plugin-facing type twice: once in `src/effect/` and once in `src/promise/`.
Of ~2,380 lines across the two trees, ~600 are pair-for-pair duplicates that differ only in the
asynchrony spelling (`Effect.Effect<A, E, Scope.Scope>` vs `Promise<A>`), in `Types.DeepMutable` vs a
hand-copied `DeepMutable`, in Effect callback failures vs Promise overloads, and in which generated
client each domain extends. The seam is real — two adapters satisfy the same Effect `Plugin` module
(the Effect-native loader path and `promise/adapter.ts` `fromPromise`) — so it should be deepened, not
removed.

**Recommendation: design (a), scoped by an empirical finding.** Deepening here is mostly *not* a
type-level transformer. Reading every pair end to end shows the duplication splits into two tiers:

1. **Pure-data payloads** (drafts, hook payloads, method payloads — `AgentDraft`, `CommandDraft`,
   `GatewayHooks`, `IntegrationMethod`, `ShellHooks`, `AISDKHooks`, …) are byte-identical or differ only
   in the `DeepMutable` import. These are deleted by **re-exporting the Effect-side definition** from the
   promise file. No transformer, no author-visible change, `Equal<>`-provable.
2. **Effect-carrying types** (registration primitives, hook callbacks, `session.create`, Tool/WebSearch
   execute callbacks, OAuth authorization) genuinely change shape between modes. A small **`Promisify`
   transformer** (full TypeScript below) derives these from the Effect definition, with **explicit
   overrides** for the domains where semantics — not just wrappers — differ: Tool execute/`ToolContext`,
   WebSearch `AbortSignal`, the Integration OAuth trio, and the hook failure channel.

Domain *shells* (`interface CommandDomain extends CommandApi { transform; reload }`, ≤ 6 lines each)
stay hand-written, deliberately: wholesale derivation replaces one line of `reload: () => Promise<void>`
with splice machinery (`Omit` + index access) and mis-derives `Registration.dispose`, which must change
from an Effect value to a deferred thunk. That fails the deletion test: the replacement is shallower
than the thing it replaces. The ~600 duplicated lines live in the payloads, and those go.

Net effect: one definition per payload type (the Effect module becomes the only place a draft or hook
payload can change), `promise/types.ts` deleted, every promise payload either derived or pinned to its
Effect twin by a compile-time `Equal` assertion in a new `promise/parity.type-test.ts`, and
`fromPromise` folds six hand-rolled hook adaptations into two named helpers so the `Tool.Error`
before-hook classification exists once instead of twice (~62 lines of call sites become ~47 including
the helpers). The Promise-first public contract — `Plugin.define({ id, setup(context) })`, awaited
registrations, `dispose()` handles, `AsyncIterable` events — is byte-identical before and after; the
author snippet that proves it is in [Proposed interface](#proposed-interface).

Terms used as defined in the repo design vocabulary: **Module** (interface + implementation), **Depth**
(behavior hidden per unit of interface), **Seam** (where behavior changes without editing in place),
**Adapter** (concrete thing satisfying an interface at a seam), **Locality**, **Deletion test**, "the
interface is the test surface", "one adapter = hypothetical seam, two = real".

## Current shape

### Inventory

19 domain pairs under `effect/` ↔ `promise/` (agent, aisdk, catalog, command, event, gateway,
instruction, integration, mcp, policy, plugin, reference, registration, session, shell, skill, storage,
tool, websearch) plus the two `index.ts` files. Effect-only: `openapi.ts`, `openapi.test.ts`.
Promise-only: `adapter.ts` (447 lines), `types.ts` (9), `tool.type-test.ts`. Shared leaf modules
(`options.ts`, `location.ts`, `app.ts`, `storage.ts`, `session-hooks.ts`) are already single-sourced —
the mirroring tax is paid only where Effect flows through the type.

Both `Context` interfaces enumerate the same 18 domains
(`effect/plugin.ts:24-46`, `promise/plugin.ts:23-45`). The recent `feat(plugin): expose plugin location
context` commit (`262e1d20`) added 8 lines of feature across **8 files** — both Contexts, both indexes,
host, adapter, tests — a textbook mirroring tax paid on every interface change.

### Per-domain difference catalogue

Difference classes: **return-wrapper** (Effect value/thunk → Promise), **callback-wrapper** (Effect
callback → Promise callback), **mutable-type** (`Types.DeepMutable` vs copied `DeepMutable`),
**client-type** (`XApi<unknown>` vs `XApi`), **overload/special** (failure channel as overloads,
`AbortSignal`, sandbox passthrough, value-vs-thunk).

| Domain | Member | Effect (`effect/*.ts`) | Promise (`promise/*.ts`) | Class |
| --- | --- | --- | --- | --- |
| registration | `Registration.dispose` | `Effect.Effect<void>` (value) | `() => Promise<void>` (thunk) | return-wrapper (value→thunk) |
| registration | `Hooks`/`ModelHooks` callback | `(input) => Effect.Effect<void, Failures[Name]>` | `(input) => Promise<void> \| void` | callback-wrapper + failure channel dropped |
| registration | `Hooks`/`ModelHooks`/`Transform` return | `Effect.Effect<Registration, never, Scope.Scope>` | `Promise<Registration>` | return-wrapper + Scope consumed by adapter |
| agent | extends | `AgentApi<unknown>` | `AgentApi` | client-type |
| agent | `AgentDraft` | `Types.DeepMutable<Agent.Info>` | copied `DeepMutable<Agent.Info>` | mutable-type |
| agent | `reload` | `Effect.Effect<void>` | `Promise<void>` | return-wrapper |
| aisdk | whole file | — | — | byte-identical; inherits registration differences only |
| catalog | extends | `CatalogApi<unknown>` | `CatalogApi` | client-type |
| catalog | `provider.list` / `model.list` | `Effect.Effect<ReadonlyArray<T>, unknown>` | `Promise<ReadonlyArray<T>>` | return-wrapper (E channel vanishes) |
| catalog | drafts | `Types.DeepMutable` | copied `DeepMutable` | mutable-type |
| command | extends / `reload` | `CommandApi<unknown>` / `Effect.Effect<void>` | `CommandApi` / `Promise<void>` | client-type / return-wrapper |
| command | `CommandDraft.update` callback | `Types.DeepMutable<Command.Info>` | copied `DeepMutable` | mutable-type |
| event | `subscribe` | `Stream.Stream<WorkspaceEventItem, E>` (via `EventApi<unknown>`) | `AsyncIterable<WorkspaceEventItem>` (via `EventApi`) | client-type + return-wrapper (Stream→AsyncIterable) |
| gateway | `GatewayHooks` payload | — | — | verbatim duplicate |
| gateway | `hook` | `Hooks<GatewayHooks, GatewayFailures>` (`Effect<void, Tool.Error>` on `tool.execute.before`) | `GatewayHook` overloads returning `Tool.Error \| void` | overload/special + callback-wrapper |
| instruction | `list`/`transform`/`reload` | `Effect.Effect<…>` | `Promise<…>` | return-wrapper |
| integration | method payloads (`IntegrationOAuthMethod` …) | — | — | verbatim duplicate |
| integration | `IntegrationOAuthAuthorization.callback` | `Effect.Effect<Credential.OAuth, unknown>` / `(code) => Effect.Effect<…>` | `Promise<Credential.OAuth>` / `(code) => Promise<…>` | callback-wrapper |
| integration | `IntegrationOAuthCallbackRegistration.wait` | `Effect.Effect<Response>` (value) | `Promise<Response>` (value) | return-wrapper |
| integration | `…MethodRegistration.authorize` | `Effect.Effect<Authorization, unknown, Scope.Scope>` | `Promise<Authorization>` | callback-wrapper + Scope captured by `AsyncLocalStorage` |
| integration | `…MethodRegistration.refresh` | `Effect.Effect<Credential.OAuth, unknown>` | `Promise<Credential.OAuth>` | callback-wrapper |
| integration | `IntegrationDomain` extends | `IntegrationApi<unknown>` | `IntegrationApi` | client-type |
| integration | `connection.active`/`resolve`, `oauth.callback.register` | `Effect.Effect<…, …, Scope.Scope?>` | `Promise<…>` | return-wrapper + Scope |
| mcp | `Draft` | `Types.DeepMutable<ConfigMCP.Remote>` | copied `DeepMutable` | mutable-type |
| mcp | `list`/`transform`/`reload` | `Effect.Effect<…>` | `Promise<…>` | return-wrapper |
| policy | `list` | `Effect.Effect<ReadonlyArray<Policy.Info>>` | `Promise<ReadonlyArray<Policy.Info>>` | return-wrapper |
| policy | `add`/`remove` | `Effect.Effect<Registration, never, Scope.Scope>` | `Promise<Registration>` | return-wrapper + Scope |
| reference | extends / `transform`/`reload` | `ReferenceApi<unknown>` / `Effect.Effect<…>` | `ReferenceApi` / `Promise<…>` | client-type / return-wrapper |
| session | `Pick<SessionApi<unknown> \| SessionApi, …>` | effect client | promise client | client-type |
| session | `create` (hand-written union) | `Effect.Effect<Session.Info, unknown>` | `Promise<Session.Info>` | return-wrapper |
| session | `hook` | `ModelHooks<SessionHooks>` (Effect) | `ModelHooks<SessionHooks>` (Promise) | callback-wrapper + return-wrapper via registration |
| shell | whole file | — | — | byte-identical; inherits registration only |
| skill | extends / drafts / `reload` | as agent | as agent | client-type + mutable-type + return-wrapper |
| storage | `get`/`set`/`remove`/`scan` | `Effect.Effect<…>` | `Promise<…>` | return-wrapper |
| tool | `ToolContext.progress`/`permission` | `Effect.Effect<void>` / `Effect.Effect<void, Error>` | `Promise<void>` | callback-wrapper |
| tool | `execute` (host `Info`) | `(input, Tool.Context) => Effect.Effect<Result, Error>` | `(input, ToolContext) => Promise<Result>` | callback-wrapper |
| tool | `ToolDraft.add` parameter | `Tool.Registration` | `Info` (sandbox passthrough + Promise execute) | overload/special |
| tool | `ToolHooks` payload | — | — | verbatim duplicate |
| tool | `hook` | `Hooks<ToolHooks, ToolFailures>` | `ToolHook` overloads (`Tool.Error \| void`) | overload/special |
| websearch | `Provider.execute` | `(input) => Effect.Effect<readonly Result[], unknown>` | `(input, { signal: AbortSignal }) => Promise<…>` | callback-wrapper + overload/special (real second parameter) |
| websearch | extends / `transform`/`reload` | as command | as command | client-type + return-wrapper |
| plugin | `Context.plugin` | `Pick<PluginApi<unknown>, "list">` | `Pick<PluginApi, "list">` | client-type |
| plugin | `Plugin.effect` vs `Plugin.setup` | `(context) => Effect.Effect<void, never, R>`, `R = Scope.Scope` | `(context) => Promise<Cleanup \| void> \| Cleanup \| void` | return-wrapper + lifecycle (host finalizer vs returned cleanup) |
| index | export set | adds `OpenAPI` | adds `fromPromise`, `GatewayToolBeforeResult` | intentional, not duplication |

### Quoted evidence

The primitive every wrapper difference radiates from — `effect/registration.ts:12-27` vs
`promise/registration.ts:10-21`:

```ts
// effect/registration.ts:12-17
export type Hooks<Spec, Failures extends Record<keyof Spec, unknown> = Record<keyof Spec, never>> = <
  Name extends keyof Spec,
>(
  name: Name,
  callback: (input: Spec[Name]) => Effect.Effect<void, Failures[Name]>,
) => Effect.Effect<Registration, never, Scope.Scope>

// promise/registration.ts:10-13
export type Hooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void,
) => Promise<Registration>
```

The hand-copied mutable helper — `promise/types.ts:1-9` exists only so promise files need not import
from `effect`; it is behaviorally identical to `Types.DeepMutable` (`effect@4.0.0-rc.112`,
`Types.ts:530-533`) for every payload used:

```ts
export type DeepMutable<A> = A extends (...args: never[]) => unknown
  ? A
  : A extends ReadonlyMap<infer K, infer V>
    ? Map<DeepMutable<K>, DeepMutable<V>>
    : ...
```

`shell.ts` is duplicated byte-for-byte — `diff effect/shell.ts promise/shell.ts` is empty — and
`aisdk.ts` likewise; both differ from their twin only in nothing at all. `agent.ts` differs in three
spellings (`promise/agent.ts:6-16`): the `DeepMutable` import, `AgentApi` vs `AgentApi<unknown>`, and
`Promise<void>` vs `Effect.Effect<void>`.

Tool's special-cased Promise surface — `promise/tool.ts:75-81` (overloads replacing the `ToolFailures`
error channel) and the matching runtime checks in `promise/adapter.ts:360-380` plus the execute bridge
`adapter.ts:345-359` and `adapter.ts:436-447`:

```ts
// promise/tool.ts:75-81
export interface ToolHook {
  (
    name: "execute.before",
    callback: (input: ToolExecuteBefore) => ToolBeforeResult | Promise<ToolBeforeResult>,
  ): Promise<Registration>
  (name: "execute.after", callback: (input: ToolExecuteAfter) => void | Promise<void>): Promise<Registration>
}
```

```ts
// promise/adapter.ts:363-371 — Promise execute.before failures re-encoded as Effect failures
host.tool.hook(name, (event) =>
  Effect.promise(() => Promise.resolve(Reflect.apply(callback, undefined, [event]))).pipe(
    Effect.flatMap((result) => {
      if (result === undefined) return Effect.void
      if (result instanceof Tool.Error) return Effect.fail(result)
      return Effect.die(new TypeError("Promise execute.before must return Tool.Error or undefined"))
    }),
  ),
)
```

The Scope seams the adapter owns — `AsyncLocalStorage` capture for OAuth authorization
(`promise/adapter.ts:105` creation, `:219-226` registration into the current authorization scope,
`:262-293` wrapping `authorize`), and cleanup-as-finalizer (`adapter.ts:423-425`):

```ts
// promise/adapter.ts:105
const authorizationScopes = new AsyncLocalStorage<Scope.Scope>()
// promise/adapter.ts:268-274
authorize: (answer, clientAnswer) =>
  Effect.gen(function* () {
    const authorizationScope = yield* Scope.Scope
    return yield* Effect.promise((): Promise<IntegrationOAuthAuthorization> =>
      authorizationScopes.run(authorizationScope, () => input.authorize(answer, clientAnswer)),
    )
  })
// promise/adapter.ts:423-425
const cleanup = yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
if (!cleanup) return
yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())))
```

Parity between the two trees is enforced only by per-side type tests (`*.type-test.ts` on each side
assert their own surface; nothing asserts the surfaces correspond). The client-type tier is already
single-sourced: `packages/client/src/contract.ts` re-exports one `HttpApi` contract and codegen emits
both clients — but the two projections emit different spellings (effect: `readonly` properties,
`ReadonlyArray`, no `requestOptions` parameter; promise: mutable shapes and an extra
`requestOptions?: RequestOptions` parameter on every method). Note `promise/adapter.ts` implements
every client-backed method with one parameter (`adapter.ts:121`, `(input?: unknown) => …`), so the
promise `Context` currently *advertises* a `requestOptions` argument the adapter silently drops.

## Design evaluation

### (a) Derived Promise types — recommended, scoped

Define each plugin-facing type once as the Effect interface; derive or re-export the Promise twin.
The task's sketch proposed one deep transformer over whole domain interfaces. Reading the pairs shows
that over-shoots: deriving `CommandDomain` wholesale produces `transform: (cb) => Promise<{ dispose:
Promise<void> }>` — the derived `Registration` loses the thunk that defers disposal — and binds
client-backed members to the effect client's endpoint types, changing every plugin's hover and error
messages. The scoped variant keeps the transformer for what it is good at (Effect-carrying payloads)
and uses plain re-exports for pure data:

- **Tier 1 — pure-data payloads: re-export.** `promise/command.ts` re-exports `CommandDraft` from
  `effect/command.js`. `Equal<>` pins prove identity during migration. Deletes ~330 lines.
- **Tier 2 — Effect-carrying payloads and members: `Promisify` derivation.** Full transformer below;
  applied to `session.create` today, and it is the mechanism the next Effect-carrying payload (a new
  hook domain with a failure channel, a Promise `openapi` twin) uses instead of a hand copy.
- **Tier 3 — overrides: hand-written.** Tool, WebSearch provider, Integration OAuth trio, hook
  overload sets, registration primitives, `Plugin`/`define` — places where the modes differ
  semantically, not just mechanically.
- **Domain shells stay explicit** (≤ 6 lines each, ~120 lines total across 19 domains). Deletion test:
  replacing `reload: () => Promise<void>` with `Promisify<Omit<EffectCommandDomain, "transform">> &`
  splice machinery hides nothing and costs more interface. The shells are shallow on purpose; their
  content is pinned by Tier 1/2 plus the parity file.

Reasons for (a): one definition per payload gives real **Locality** — the recent location-context
commit's 8-file ripple collapses to host + both indexes; the promise payload cannot drift from the
effect payload because there is only one; **Leverage** flows to plugin authors, who keep a
Promise-shaped interface whose every payload is compiled against the Effect definition the host
actually implements; the deepening sits at the existing seam (two adapters already satisfy the same
Effect `Plugin` module — a real seam, not a hypothetical one) instead of inventing a mode abstraction.

### (b) Shared semantic contract + two thin projections — rejected

The same three domains under a `Mode`-parameterized contract:

```ts
type Mode = "effect" | "promise"

interface CommandDomainContract<M extends Mode> extends CommandApi<M extends "effect" ? unknown : never> {
  readonly transform: (callback: (draft: CommandDraft) => void) => M extends "effect"
    ? Effect.Effect<Registration, never, Scope.Scope>
    : Promise<Registration>
  readonly reload: () => M extends "effect" ? Effect.Effect<void> : Promise<void>
}
export type CommandDomain = CommandDomainContract<"effect">
export type PromiseCommandDomain = CommandDomainContract<"promise">
```

Concrete failure modes:

1. **Overloads and genericity cannot be shared.** The promise `ToolHook`/`GatewayHook` overload sets
   and the effect `Hooks<Spec, Failures>` per-name literal correlation are different *signature
   shapes*, not different wrapper types. A conditional cannot produce both from one declaration, so
   the contract carries a third copy of the trickiest interfaces anyway.
2. **The two projections stay hand-correlated.** Nothing forces the `"effect"` and `"promise"` branches
   of a member to correspond; drift risk is identical to today, now interleaved inside each member and
   harder to review than two side-by-side files.
3. **Hover and errors degrade.** Authors never touch the contract, but diagnostics against
   `CommandDomainContract<"promise">` print unresolved conditionals until instantiation.
4. **The HKT variant does not rescue it.** `effect/HKT` (`TypeLambda`, `Kind`) exists in
   `effect@4.0.0-rc.112`, but the divergence between the modes is in error channels, sync-allowance,
   Scope consumption, and overload arity — not in the wrapper alone — so a `Kind<F>` parameterization
   lands in the same wall at `hook`.

The contract also changes author-facing types on *both* sides (both instantiate from it), widening the
migration for no locality gain over (a).

### What stays hand-written no matter what

| Artifact | Reason |
| --- | --- |
| `promise/registration.ts` primitives | `<Name extends keyof Spec>` literal correlation, sync-allowing callbacks, `dispose` thunk; derivation provably degrades (shown below) |
| `promise/plugin.ts` `Plugin`/`define`/`Cleanup` | the public authoring contract per `packages/plugin/AGENTS.md`; Promise-first and unchanged |
| `promise/tool.ts` `ToolContext`/`Info`/`ToolDraft`/`ToolHook` + `adapter.ts` `executePromiseTool` | Promise `execute`, Promise `progress`/`permission`, sandbox passthrough, `Tool.Error` failure mapping — semantics, not wrappers |
| `promise/gateway.ts` / `promise/tool.ts` hook overload sets | the Promise failure channel is encoded as overloads; `Equal`-stable, 12 lines |
| `promise/websearch.ts` `Provider` | real second `AbortSignal` parameter bridged to Effect interruption by `adapter.ts:393` |
| `promise/integration.ts` OAuth trio + `IntegrationDraft` | `IntegrationOAuthAuthorization` is an intersection of a base object with a discriminated union; mapped types flatten it and lose `mode`↔`callback` correlation; Scope is captured by `AsyncLocalStorage` at runtime |
| `promise/adapter.ts` endpoint enumeration (`adaptApiMethod` bindings) | it replicates the promise client's schema encode/decode behavior in-process; bindings are data, not types |
| `effect/openapi.ts` (+ test) | Effect-only module; no twin to mirror |
| both `index.ts` | intentionally different export surfaces |

## Proposed interface

### The transformer — `packages/plugin/src/promise/promisify.ts` (new)

```ts
import type { Effect, Scope, Stream } from "effect"

/**
 * Derives the Promise projection of a plugin-owned Effect type.
 *
 * Applied recursively through objects, arrays, tuples, and union members:
 * - A function returning `Effect.Effect<Value, Error, Required>` becomes the same function returning
 *   `Promise<Value>`. `Required` must be `Scope.Scope` or `never`; anything else derives to `never`
 *   so an unsupported requirement fails at every use instead of silently vanishing.
 * - A bare `Effect.Effect<Value, Error, Required>` value becomes `Promise<Value>`.
 * - A `Stream.Stream<Value, Error, Required>` value becomes `AsyncIterable<Value>`.
 * - Parameters of surviving functions are derived recursively, so Effect-typed members nested in
 *   callback inputs (for example `IntegrationMethodRegistration.authorize`) are promisified too.
 * - Function results are NOT derived recursively — client endpoint payloads and schema types are
 *   shared verbatim between the modes, and recursing into them would re-map `Date` fields and
 *   endpoint unions for no benefit.
 * - Scalars (including branded strings), `Date`, `ReadonlyMap`, `ReadonlySet`, and non-Effect
 *   functions pass through; `Types.DeepMutable`, `readonly`, and optionality survive untouched.
 * - Objects with no Effect anywhere inside them pass through untouched as well (`HasEffect` guard),
 *   so plain schema payloads keep their exact original identities instead of becoming mapped shells.
 *
 * Not applied to whole domain interfaces: `Registration.dispose` must become a deferred thunk, not a
 * `Promise`, and client-backed members stay bound to each client's generated types. See
 * `parity.type-test.ts` for the assertions that hold this contract in place.
 */
type HasEffect<A> = A extends Effect.Effect<infer _Value, infer _Error, infer _Required>
  ? true
  : A extends (...args: infer Args) => infer Out
    ? Out extends Effect.Effect<infer _Value, infer _Error, infer _Required>
      ? true
      : HasEffect<Args[number]>
    : A extends object
      ? HasEffect<A[keyof A]>
      : false

export type Promisify<A> = A extends (...args: infer Args) => infer Out
  ? Out extends Effect.Effect<infer Value, infer _Error, infer Required>
    ? [Required] extends [Scope.Scope]
      ? (...args: { [Index in keyof Args]: Promisify<Args[Index]> }) => Promise<Value>
      : never
    : (...args: { [Index in keyof Args]: Promisify<Args[Index]> }) => Out
  : A extends Stream.Stream<infer Value, infer _Error, infer _Required>
    ? AsyncIterable<Value>
    : A extends Effect.Effect<infer Value, infer _Error, infer _Required>
      ? Promise<Value>
      : A extends ReadonlyMap<infer Key, infer Item>
        ? ReadonlyMap<Promisify<Key>, Promisify<Item>>
        : A extends ReadonlySet<infer Item>
          ? ReadonlySet<Promisify<Item>>
          : A extends Function
            ? A
            : A extends Date
              ? A
              : A extends object
                ? HasEffect<A> extends false ? A : { [Key in keyof A]: Promisify<A[Key]> }
                : A
```

Deliberate choices, each with its reason:

- **`HasEffect` fast path.** Effect-free payloads (`Session.CreateInput`, `CommandDraft`, endpoint
  inputs) come out as their exact original types, not mapped shells — which is what makes the strict
  `Equal` pins in `parity.type-test.ts` hold instead of degrading to structural assignability. The
  guard is a parallel shallow walk, so it adds no asymptotic cost over the mapping it avoids.
- **No `-readonly` in the object branch.** `Promisify` is a projection, not a mutability transform;
  `readonly` payloads must stay readonly so `Equal` pins against today's promise types hold.
- **No recursion into function results.** `Session.Info` (Date fields via `Timestamp`) flows through
  method returns; recursing would re-map it. Only callback *parameters* recurse, which is where
  Effect-typed members actually live.
- **`Date`/`Function`/`Map`/`Set` guards before the object branch.** The mapped-type branch would
  otherwise rebuild a `Date` as a bag of its methods and a `ReadonlyMap` as an object of its methods.

### Application — three domains

**Command (trivial).** The draft is pure data → re-export; the shell stays explicit:

```ts
// packages/plugin/src/promise/command.ts (after)
import type { CommandApi } from "@bymorning/client/promise/api"
import type { Transform } from "./registration.js"

export type { CommandDraft } from "../effect/command.js"

export interface CommandDomain extends CommandApi {
  readonly transform: Transform<CommandDraft>
  readonly reload: () => Promise<void>
}
```

What derivation *would* give, and why it is rejected for the shell:

```ts
// Demonstrative only — not committed.
type DerivedReload = Promisify<import("../effect/command.js").CommandDomain["reload"]>
//   = () => Promise<void>                       ✅ identical, but costs an index access to read
type DerivedTransform = Promisify<import("../effect/command.js").CommandDomain["transform"]>
//   = (callback: (draft: CommandDraft) => void) => Promise<Registration>
//     where Registration is still the effect twin: { readonly dispose: Effect.Effect<void> }
//                                                ❌ wrong twice: dispose stays an Effect value
//                                                   because results are not recursed, and it must be
//                                                   a deferred thunk even if it were promisified
```

**Session hooks.** The hook callback stays a hand-written primitive (derivation would collapse
`<Name extends keyof Spec>` to `keyof Spec` and feed every hook the union of all payloads); the
`create` override — a hand-written 10-line input union duplicated on both sides today — derives:

```ts
// packages/plugin/src/promise/session.ts (after)
import type { SessionApi } from "@bymorning/client/promise/api"
import type { SessionDomain as EffectSessionDomain } from "../effect/session.js"
import type { ModelHooks } from "./registration.js"
import type { Promisify } from "./promisify.js"

export type {
  ModelRequestPurpose,
  SessionContext,
  SessionHooks,
  SessionHttpRequest,
  SessionHttpResponse,
  SessionModelRequest,
} from "../session-hooks.js"

export type SessionDomain = Pick<
  SessionApi,
  "get" | "switchAgent" | "switchModel" | "prompt" | "generate" | "command" | "synthetic" | "interrupt" | "rename" | "wait"
> & {
  readonly create: Promisify<EffectSessionDomain["create"]>
  readonly hook: ModelHooks<SessionHooks>
}
```

`Promisify<EffectSessionDomain["create"]>` is
`(input: Session.CreateInput | { readonly parentID: Session.ID; readonly title?: Session.Title; readonly agent?: Agent.ID; readonly model?: Model.Ref }) => Promise<Session.Info>`
— exactly today's `promise/session.ts:30-39`, derived from the effect twin. Why the hook primitive
cannot derive (the TypeScript limit, demonstrated):

```ts
type DerivedHooks = Promisify<import("../effect/registration.js").Hooks<import("../session-hooks.js").SessionHooks>>
// = (name: "context" | "model.request" | "http.request" | "http.response",
//    callback: (input: SessionHooks[keyof SessionHooks]) => Promise<void>) => Promise<Registration>
```

`context.session.hook("model.request", (event) => …)` would infer `event` as the union of all four
payloads instead of `SessionModelRequest`. Generic method signatures do not survive reconstruction
through `infer Args`; the hand-written `ModelHooks<Spec>` (19 lines, unchanged) keeps per-name
inference. `transform` **does** derive cleanly — its callback returns `void` and it has no method
type parameters — but it is 3 lines and lives beside `Hooks`; keeping the primitives file whole is
cheaper than splitting it.

**Tool (override).** Derivation is wrong in three places — `execute` needs the Promise `ToolContext`
(not a mechanical wrapper: `progress`/`permission` become Promise-returning and the whole `Info`
union distinguishes sandbox passthrough), `add`'s parameter type changes from `Tool.Registration` to
`Info`, and `hook` needs overloads. So `promise/tool.ts` keeps its override layer and deletes only the
verbatim payload copy:

```ts
// packages/plugin/src/promise/tool.ts (after — override layer unchanged, payload shared)
import { Tool } from "@bymorning/schema/tool"
import type { Transform } from "./registration.js"

export { CallID, Error } from "@bymorning/schema/tool"
export type { Metadata, Options, Result } from "@bymorning/schema/tool"
export type { ToolHooks } from "../effect/tool.js"

// ToolContext, BaseInfo, Info, ToolDraft, ToolExecuteBefore/After, ToolBeforeResult, ToolHook:
// unchanged from today's promise/tool.ts:11-81 (Promise execute, sandbox passthrough, overloads).

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: ToolHook
}
```

The runtime bridge that makes this override honest stays as-is (`adapter.ts:345-359`,
`executePromiseTool` at `:436-447`): the adapter rewrites host-executed tools so the Promise `execute`
runs with Promise-returning `progress`/`permission`, and maps `Tool.Error`/`undefined` before-hook
results onto the Effect failure channel.

### The new `promise/plugin.ts` Context

Unchanged in shape — that is the point. Only the comment and the payload sources behind the domain
aliases change:

```ts
// packages/plugin/src/promise/plugin.ts (after)
import type { PluginApi } from "@bymorning/client/promise/api"
import type { PluginConfigurationDefinition, PluginOptions } from "../options.js"
import type { Location } from "../location.js"
import type { App } from "../app.js"
// Each domain below is either a thin interface over the promise client plus the hand-written
// registration primitives, or a `Promisify` derivation of its effect twin — see promise/*.ts.
import type { AgentDomain } from "./agent.js"
import type { AISDKDomain } from "./aisdk.js"
import type { CatalogDomain } from "./catalog.js"
import type { CommandDomain } from "./command.js"
import type { EventDomain } from "./event.js"
import type { GatewayDomain } from "./gateway.js"
import type { IntegrationDomain } from "./integration.js"
import type { InstructionDomain } from "./instruction.js"
import type { MCPDomain } from "./mcp.js"
import type { PolicyDomain } from "./policy.js"
import type { ReferenceDomain } from "./reference.js"
import type { SessionDomain } from "./session.js"
import type { ShellDomain } from "./shell.js"
import type { SkillDomain } from "./skill.js"
import type { StorageDomain } from "./storage.js"
import type { ToolDomain } from "./tool.js"
import type { WebSearchDomain } from "./websearch.js"

export interface Context {
  readonly app: App
  readonly location: Location
  readonly options: PluginOptions
  readonly agent: AgentDomain
  readonly aisdk: AISDKDomain
  readonly catalog: CatalogDomain
  readonly command: CommandDomain
  readonly event: EventDomain
  readonly gateway: GatewayDomain
  readonly integration: IntegrationDomain
  readonly instruction: InstructionDomain
  readonly mcp: MCPDomain
  readonly plugin: Pick<PluginApi, "list">
  readonly policy: PolicyDomain
  readonly reference: ReferenceDomain
  readonly session: SessionDomain
  readonly shell: ShellDomain
  readonly skill: SkillDomain
  readonly storage: StorageDomain
  readonly tool: ToolDomain
  readonly websearch: WebSearchDomain
}

export type Cleanup = () => Promise<void> | void

export interface Plugin {
  readonly id: string
  readonly tui?: boolean
  readonly configuration?: PluginConfigurationDefinition
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}

export function define(plugin: Plugin) {
  return plugin
}
```

`promise/index.ts` is unchanged: same named exports, same `fromPromise`, same schema namespaces. No
export changes means no docs changes and no author migration.

### Before/after: the author surface is identical

```ts
// Before (today) and after (this spec) — byte-for-byte the same plugin.
import { Plugin, Tool } from "@bymorning/plugin"

export default Plugin.define({
  id: "project.example",
  async setup(context) {
    await context.command.transform((draft) => draft.update("deploy", (command) => { command.description = "Ship it" }))
    await context.session.hook("model.request", (event) => { event.model = { provider: "anthropic", id: "claude-sonnet-4-5" } })
    await context.tool.hook("execute.before", (event) =>
      event.tool === "shell" ? new Tool.Error({ message: "blocked" }) : undefined,
    )
    const registration = await context.policy.add(policy)
    return () => registration.dispose()
  },
})
```

Every inferred type in that snippet — `CommandDraft` with its `Types.DeepMutable` payload,
`SessionModelRequest`, the `ToolHook` overload picking `Tool.Error | void` for `"execute.before"` —
is produced by the same named alias as today. Hover names are preserved because the aliases keep
their names and files; the *definitions* behind them are shared or derived.

### TypeScript limits, stated plainly, with mitigations

1. **Generic methods do not survive `Promisify`.** Reconstructing a function through
   `(...args: infer Args) => …` instantiates method type parameters to their constraints. Mitigation:
   the primitives (`Hooks`, `ModelHooks`, `Transform`) and `ToolHook` stay hand-written; the parity
   file carries the demonstrative `DerivedHooks` assertion above as a *negative* pin (documented, not
   compiled) so nobody "simplifies" them into derivations later.
2. **Mapped types flatten intersections-with-unions.** `IntegrationOAuthAuthorization`
   (`effect/integration.ts:60-73`) is `{ base } & ({ mode: "auto" … } | { mode: "code" … })`; any
   object-mapped derivation collapses the `mode`↔`callback` correlation. Mitigation: the OAuth trio
   stays hand-written in `promise/integration.ts` (already correct, ~27 lines).
3. **Hover fidelity of derived aliases.** `Promisify<EffectSessionDomain["create"]>` hovers as its
   expansion, not as a named interface. Mitigation: derivations are confined to named members of
   named domain aliases (`SessionDomain["create"]`), so an author hovering `context.session.create`
   still sees `SessionDomain` and the concrete expanded signature; nothing anonymous is exported.
4. **`Equal` strictness.** The `Equal` trick compares internal identity. The `HasEffect` guard makes
   derived members exact for Effect-free payloads, and the remaining derivations (`session.create`)
   produce the same shape the hand-written twin spells — so the pins are expected to hold as `Equal`.
   Residual risk: an Effect-holding payload whose mapped reconstruction differs internally from a
   hand-written twin (member-ordering edge cases). Mitigation: if a pin false-negatives, degrade that
   one pin to mutual assignability with a comment saying why; never loosen the re-export pins.
5. **Compile cost.** `Promisify` instantiations are bounded: no endpoint payload unions flow through
   it (client members are not derived), and the recursion is shallow (payload depth ≤ 3). The package
   typechecks under `@effect/tsgo` (`bun typecheck` in `packages/plugin`), which absorbs this easily.

## Implementation sketch

`promise/adapter.ts` keeps its architecture — captured fiber context, `Scope.provide` registrations,
`adaptApiMethod` schema bridge — and folds six hand-rolled hook adaptations (aisdk, session, shell,
and both arms of gateway and tool) into two named helpers, deleting the duplicated before-hook
classification. Real TypeScript, following the repo style (early returns, no `try`/`catch`, inlined
single-use logic):

```ts
// packages/plugin/src/promise/adapter.ts — replacements for adapter.ts:154-158, 184-205, 360-380, 400-404, 417-420

type HostHook<Event, Failure = never> = (
  callback: (event: Event) => Effect.Effect<void, Failure>,
) => Effect.Effect<HostRegistration, never, Scope.Scope>

/** Runs one plain Promise hook callback on the plugin scope. Plain hooks have no typed failure
 * channel, so a rejecting callback surfaces as a plugin defect. */
const adaptHook = <Event>(
  register: HostHook<Event>,
  callback: (event: Event) => void | Promise<void>,
): Promise<Registration> => register((event) => Effect.promise(() => Promise.resolve(callback(event))))

/** Classifies one execute.before result: undefined passes, Tool.Error fails, anything else is a defect. */
const beforeHookResult =
  (source: string) =>
  (result: unknown): Effect.Effect<void, Tool.Error> => {
    if (result === undefined) return Effect.void
    if (result instanceof Tool.Error) return Effect.fail(result)
    return Effect.die(new TypeError(`Promise ${source} must return Tool.Error or undefined`))
  }

/** Runs one execute.before Promise hook callback, mapping its result onto the Effect failure channel. */
const adaptBeforeHook = <Event>(
  register: HostHook<Event, Tool.Error>,
  callback: (event: Event) => unknown,
  source: string,
): Promise<Registration> =>
  register((event) =>
    Effect.flatMap(Effect.promise(() => Promise.resolve(callback(event))), beforeHookResult(source)),
  )
```

The context literal then reads:

```ts
aisdk: {
  hook: (name, callback, options) => adaptHook((run) => host.aisdk.hook(name, run, options), callback),
},
gateway: {
  hook: (name, callback) =>
    name === "tool.execute.before"
      ? adaptBeforeHook((run) => host.gateway.hook(name, run), callback, "gateway tool.execute.before")
      : adaptHook((run) => host.gateway.hook(name, run), callback),
},
session: {
  hook: (name, callback, options) => adaptHook((run) => host.session.hook(name, run, options), callback),
  create: adaptApiMethod(SessionEndpoints["session.create"], host.session.create, ChildSessionCreateInput),
  // …remaining adaptApiMethod bindings unchanged (adapter.ts:406-415)
},
shell: {
  hook: (name, callback) => adaptHook((run) => host.shell.hook(name, run), callback),
},
tool: {
  transform: (callback) =>
    register(
      host.tool.transform((draft) =>
        callback({
          add: (tool: Info) => {
            if (tool.execution === "sandbox") return draft.add(tool)
            draft.add({ ...tool, execute: (input, context) => executePromiseTool(tool, input, context) })
          },
        }),
      ),
    ),
  hook: (name, callback) =>
    name === "execute.before"
      ? adaptBeforeHook((run) => host.tool.hook(name, run), callback, "execute.before")
      : adaptHook((run) => host.tool.hook(name, run), callback),
},
```

Unchanged, with their reasons: `compileEndpoint`/`adaptApiMethod` (the in-process schema bridge that
makes promise plugins observe what they would observe over HTTP), `transform` (scope + registration
thunk), the Integration `transform`/`oauth` block (`AsyncLocalStorage` capture, `adapter.ts:252-303`),
`event.subscribe` (Stream→`AsyncIterable` with `WorkspaceEvent.Item` encoding, `adapter.ts:174-182`),
the WebSearch transform (`attempt` signal bridge, `adapter.ts:385-398`), and the setup/cleanup
finalizer (`adapter.ts:423-425`). The only behavior-adjacent simplification: `callback(event)`
replaces `Reflect.apply(callback, undefined, [event])` — identical for the function callbacks the
interfaces require.

One typing note: `adaptBeforeHook`'s `register` parameter is `HostHook<Event, Tool.Error>` so the
helper composes with `host.gateway.hook`/`host.tool.hook`, whose callbacks must return
`Effect.Effect<void, Tool.Error>` for the before-name; `adaptHook` stays `Failure = never`, matching
every plain hook (`aisdk`, `session`, `shell`, and the after-names).

## Caller migration

- **`packages/core/src/plugin/host.ts` — unchanged.** `PluginHost.make` implements the Effect
  `Context`; the Effect tree is untouched, so the 514-line host and its tests stand as-is.
- **`packages/core/src/plugin/supervisor.ts` — unchanged.** `fromPromise(candidate)` at
  `supervisor.ts:291` and the structural `isEffectPlugin`/`isPromisePlugin` checks at
  `:345-352` keep working: `Plugin.define`'s shape is identical.
- **`packages/client` — untouched by this spec.** Both clients stay codegen outputs of the one
  contract (`contract.ts`). Whether the promise projection should converge on the effect projection's
  type spellings is an open decision below, not part of this change.
- **`packages/docs` — no required changes.** The Promise examples in
  `06-developer-reference/03-plugins.mdx`, `04-provider-integration-plugins.mdx`,
  `02-policy-language.mdx`, and `07-configure/06-plugins.mdx` compile against identical types. The
  existing warning that wildcard subpaths are not a stable public contract
  (`07-configure/06-plugins.mdx:1216`) already covers the new `promise/promisify.ts`. Optional
  follow-up: one sentence in the plugins reference noting that Promise types are projections of the
  Effect definitions.
- **Author migration: none.** No import path, export name, or inferred type changes. The `.type-test.ts`
  files on both sides compile unchanged, which is the regression proof.

## Tests

**Deleted: nothing.** The per-side type tests stay — each pins a public surface, and both surfaces
remain public ("the interface is the test surface"). What gets deleted is the duplicated *definition*
text behind them. The parity file adds the cross-tree guarantee that does not exist today.

**New — `packages/plugin/src/promise/parity.type-test.ts`** (compile-time, run by `bun typecheck` in
`packages/plugin`):

```ts
import type { CommandDraft as EffectCommandDraft, CommandDomain as EffectCommandDomain } from "../effect/command.js"
import type { SessionDomain as EffectSessionDomain } from "../effect/session.js"
import type { CommandDomain, CommandDraft } from "./command.js"
import type { SessionDomain } from "./session.js"
import type { Promisify } from "./promisify.js"

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
type Expect<T extends true> = T

// Tier 1: every re-exported payload is its effect twin, not a copy.
export const commandDraftIsShared: Expect<Equal<CommandDraft, EffectCommandDraft>> = true

// Tier 2: derived members match their effect origins.
export const sessionCreateIsDerived: Expect<Equal<SessionDomain["create"], Promisify<EffectSessionDomain["create"]>>> = true
export const commandReloadIsPromisified: Expect<Equal<CommandDomain["reload"], Promisify<EffectCommandDomain["reload"]>>> = true

// Tier 3 guards: the things that must NOT be derived, pinned so a future "simplification" fails here.
export const transformReturnsThunkDispose: Expect<
  Equal<ReturnType<CommandDomain["transform"]> extends Promise<{ readonly dispose: () => Promise<void> }> ? true : false, true>
> = true
// Documented negative pin (kept as a comment — compiling it would fail, which is the point):
// type DerivedHooks = Promisify<EffectHooks<SessionHooks>> loses <Name extends keyof Spec> literal
// correlation and infers the union of all hook payloads; Hooks/ModelHooks stay hand-written.
```

During migration, before each promise copy is deleted, the same file temporarily asserts
`Expect<Equal<NewAlias, OldHandWrittenAlias>>` for that domain's payloads; the assertion is removed
together with the copy it retired.

**New — behavioral adapter tests in `packages/core/test/plugin-host.test.ts`** (that file already owns
`fromPromise` coverage; existing cases already cover Tool.Error→typed denial at `:736`, unexpected
rejection→defect at `:745`, invalid resolved value→defect at `:753`, and OAuth scope capture at
`:523` with attempt-cancelled cleanup at `:805`). Missing coverage to add:

1. `compileEndpoint` rejects multi-schema endpoints (`adapter.ts:17-18`) — feed an endpoint whose
   payload or success has two schemas and expect the `Unsupported API schema cardinality` error.
   Requires exporting `compileEndpoint` (or moving it beside the adapter) since no real endpoint
   triggers it today.
2. Setup cleanup failure surfaces through scope close — a plugin whose returned cleanup rejects makes
   the plugin scope close exit defective (`adapter.ts:425` wraps the rejection via `Effect.promise`).
3. Promise plugin `event.subscribe` terminates — the existing event test (`:1079`) drives the Effect
   host path only; with a finite bus `Stream`, the Promise `AsyncIterable` should complete and not
   hold the registration scope open.

Two of them, in the file's existing style:

```ts
it.effect("surfaces a rejecting setup cleanup as a defect on scope close", () =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* fromPromise({
          id: "promise-cleanup-failure",
          setup: async () => async () => {
            throw new Error("cleanup exploded")
          },
        }).effect(PluginHost.make(services(workspaceA, storage), "promise-cleanup-failure"))
      }),
    )
    return yield* Effect.die(new Error("scope close should have defected before this line"))
  }).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)),
    ),
    Effect.provide(Storage.layer),
  ),
)

it("rejects multi-schema endpoints at compile time", () => {
  const endpoint = {
    identifier: "test.multi",
    payload: new Map([["union", { schemas: [Schema.String, Schema.Number] }]]),
    success: new Set([Schema.String]),
  } as unknown as HttpApiEndpoint.Top
  expect(() => compileEndpoint(endpoint)).toThrow("Unsupported API schema cardinality: test.multi")
})
```

## Preserved behavior

- **Promise-first public contract.** `Plugin.define({ id, setup(context), tui?, configuration? })`,
  awaited registrations returning `dispose()`, sync-or-Promise cleanup — unchanged verbatim
  (`promise/plugin.ts:47-58`); `packages/plugin/AGENTS.md`'s recommended authoring mode is the
  package's default export before and after.
- **`AsyncLocalStorage` OAuth callback scoping** (`promise/adapter.ts:105`, `:219-226`, `:262-293`).
  Registrations made during `setup` attach to the plugin scope; `oauth.callback.register()` called
  inside an `authorize` callback attaches to that attempt's authorization scope instead, so late
  callback deliveries die with the attempt, not the plugin. The helper extraction does not touch this
  block.
- **Cleanup-as-finalizer** (`promise/adapter.ts:423-425`): a returned cleanup runs when the plugin's
  activation scope closes (replacement, reload, removal, shutdown), after the host's own finalizers;
  new test #2 pins the failure path.
- **Boot-time batching**: registrations run on the captured fiber context, so Promise-plugin
  transforms still coalesce into one reload per domain (`adapter.ts:28-36` doc comment holds).
- **Tool execution semantics**: sandbox passthrough, Promise `progress`/`permission`, `Tool.Error`
  before-hook denial, fail-closed `ask` for inbound MCP — all unchanged; the override layer is
  moved, not redesigned.
- **Event encoding**: `subscribe` still re-encodes through `WorkspaceEvent.Item` so Promise plugins
  observe the same event shapes as HTTP clients (`adapter.ts:174-182`).

## Open decisions

1. **`any` in `AISDKHooks`** (`effect/aisdk.ts:9,10,14,15`, byte-identical in the promise twin): the
   repo style guide forbids `any`, but `sdk`/`options` carry untyped provider SDK surfaces and
   tightening them is a behavior question (what may plugins pass?), not a mirroring one. Recommendation:
   fix in a separate change — at minimum `Record<string, unknown>` for `options`; leave as-is in this
   migration so the re-export is a pure move.
2. **Converge the two client projections.** The promise client emits mutable shapes plus a
   `requestOptions` parameter the in-process adapter silently drops (`adapter.ts:121`); the effect
   client emits `readonly`/`ReadonlyArray` shapes without it. If the promise client's generated types
   were derived from the effect projection (both already come from one contract in
   `packages/client/src/contract.ts`), the plugin domain shells could bind to one spelling and the
   `requestOptions` illusion disappears. That is a `packages/client` codegen decision with
   author-visible hover changes across every consumer — deliberately out of scope here, but it is the
   gate for deleting the remaining ~120 lines of domain shells.
3. **Session `create`'s extra input union** (`effect/session.ts:30-39`) duplicates the child-session
   fields that `adapter.ts:24-29` also encodes as `ChildSessionCreateInput` for schema decoding. Three
   copies of one fact (type-level twice, runtime once). Deriving the schema struct from the type, or
   vice versa, is possible but couples `packages/plugin` to `@bymorning/schema` internals; recommend
   leaving it and noting it here.
4. **Should `Promisify` also derive `Transform`?** It derives cleanly (no method type parameters), but
   splitting the three-line primitives file to gain one derivation fails the deletion test. Keep the
   primitives whole; revisit only if a fourth primitive appears.
5. **`GatewayToolBeforeResult`/`ToolBeforeResult` naming**: the promise tree names the before-result
   union; the effect tree encodes it as `GatewayFailures["tool.execute.before"]`. The parity file
   could pin `Equal<GatewayToolBeforeResult, Tool.Error | void>` against the effect twin's failure
   channel so the two encodings cannot drift. Cheap; recommend adopting with the parity file.

## Sequencing

1. **Add `promise/promisify.ts` + `promise/parity.type-test.ts`** with `Equal`/`Expect` and the
   first pins (`commandDraftIsShared` against the still-present copy). `bun typecheck` in
   `packages/plugin` green. No behavior change.
2. **Tier 1 deletions, one domain per commit** (aisdk, shell, command, agent, mcp, catalog, skill,
   reference, policy draft, instruction, event, gateway payloads, tool payloads, integration method
   payloads): replace each promise copy with a re-export of the effect twin, prove
   `Equal<New, Old>` in the parity file, delete the copy, delete `promise/types.ts` when the last
   copied `DeepMutable` import goes. Both `.type-test.ts` suites stay green throughout.
3. **Tier 2**: derive `SessionDomain["create"]`; add the `Equal` pin; hand the next payload author
   the transformer instead of a copy template.
4. **Adapter consolidation**: introduce `adaptHook`/`adaptBeforeHook`/`beforeHookResult`, rewrite the
   six hook sites, keep the failure messages byte-identical; run `packages/core` `bun test` (adapter
   tests live there, never at the repo root) and add the three new behavioral tests.
5. **Type-test sweep**: confirm `promise/{policy,gateway,integration,tool}.type-test.ts` and their
   effect twins pass unchanged; adopt open decision #5's failure-channel pin.
6. **Finish with** `bun typecheck` in `packages/plugin` and `packages/core`, `git diff --check`, and
   the docs link check only if the optional docs sentence from Caller migration was added.
