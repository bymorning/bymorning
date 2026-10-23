# Plugin-owned policy

Status: approved for implementation on 2026-09-09. Execution is tracked in [plugin-policy-plan.md](plugin-policy-plan.md).

## Direction

Use the existing Plugin system for policy behavior. Session, LLM Gateway, and inbound
MCP invoke Plugins at their own execution points. They share Plugin mechanisms and
the existing accounting authorities without sending Session requests through LLM Gateway.

Policy ceases to be an independently managed record or Core service. Budget, Limiter,
Usage, Permission, Catalog, and Instruction retain their existing authority.

The confirmed domain direction is recorded in `CONTEXT.md`. The interfaces, Plugin
hosting extension, and migration below describe the approved target; implementation
and verification status are tracked separately.

## Evidence

| Existing code | Reuse |
| --- | --- |
| `packages/core/src/plugin/hooks.ts` | Ordered callbacks, scoped registrations, disposal, provider filtering |
| `packages/core/src/plugin.ts` | Activation, configuration normalization, inventory, readiness, reload |
| `packages/plugin/src/session-hooks.ts` | Prompt, context, routing, HTTP, and retry hooks |
| `packages/plugin/src/promise/gateway.ts` | Inbound MCP before/after hooks and typed rejection results |
| `packages/core/src/mcp-gateway.ts:259` | Gateway Tool hook execution |
| `packages/core/src/usage.ts:143` | Session physical-call admission, observation, and reservation lifecycle |
| `packages/core/src/llm-gateway.ts:101` | Gateway admission and caller-protocol error rendering |
| `packages/core/src/llm-gateway/exchange.ts:105` | Native Gateway usage observation and settlement |
| `packages/core/src/llm-gateway/translation/exchange.ts` | Translated Gateway usage observation and settlement |
| `packages/core/src/plugin/internal.ts:109` | Explicitly injected dependencies for internal Effect Plugins |
| `packages/server/src/llm-gateway-lease.ts:56` | Workspace-only Gateway composition; currently has no Plugin activation |

The existing member Plugin graph depends on `Actor.Binding`. Reusing that graph for
Gateway would require an identity Gateway does not have. The hosting extension below
addresses this explicitly.

## 1. Public hook inputs

Add these contracts under `packages/schema/src/plugin-model.ts`. These are hook data,
not another Core domain or independently persisted invocation.

```ts
import { Agent } from "./agent.js"
import { MessageID } from "./identifier.js"
import { LLMGateway } from "./llm-gateway.js"
import { Model } from "./model.js"
import { Session } from "./session.js"
import { Workspace } from "./workspace.js"
import { Schema } from "effect"

/** Expected inference-hook refusal or dependency failure. */
export class ModelError extends Schema.TaggedError<ModelError>()("Plugin.ModelError", {
  reason: Schema.Literals(["denied", "model", "budget", "rate", "unavailable"]),
  message: Schema.String,
  retryAfter: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}

/** Physical Session inference purpose. */
export const ModelPurpose = Schema.Literals(["assistant", "generate", "compaction", "title"])

/** Final, immutable selection presented to inference admission hooks. */
export const ModelInput = Schema.Struct({
  id: Schema.NonEmptyString,
  workspaceID: Workspace.ID,
  model: Model.Ref,
  publicModel: Schema.NonEmptyString,
  stream: Schema.Boolean,
})
export interface ModelInput extends Schema.Schema.Type<typeof ModelInput> {}

/** Session facts supplied by the Session execution owner. */
export const SessionInput = Schema.Struct({
  ...ModelInput.fields,
  sessionID: Session.ID,
  messageID: Schema.optionalKey(MessageID),
  agent: Agent.ID,
  purpose: ModelPurpose,
})
export interface SessionInput extends Schema.Schema.Type<typeof SessionInput> {}

/** Gateway facts; deliberately contains no caller or Session identity. */
export const GatewayInput = Schema.Struct({
  ...ModelInput.fields,
  protocol: LLMGateway.Protocol,
})
export interface GatewayInput extends Schema.Schema.Type<typeof GatewayInput> {}
```

`id` is correlation for one physical inference attempt. Retries receive another ID;
it is not a durable Run or Session identity. `publicModel` uses the same canonical
identifier supplied to the existing Limiter. The host constructs and freezes these
inputs after all routing and destination validation.

## 2. Invocation-scoped hooks

Extend `session.hook` and `gateway.hook` with `model.invoke`. Keep the existing
registration/disposal contract. Public Plugins remain Promise-first.

The new Promise contract, in `packages/plugin/src/promise/model.ts`:

```ts
import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import type { Registration } from "./registration.js"

/** An expected callback result, following the existing Tool hook convention. */
export type HookResult = void | ModelError

/** One invocation's observation and cleanup registration capabilities. */
export interface ModelScope {
  readonly signal: AbortSignal
  readonly onUsage: (
    callback: (tokens: Tokens) => HookResult | Promise<HookResult>,
  ) => void
  readonly onClose: (callback: () => void | Promise<void>) => void
}

/** Session-specific invocation callback input. */
export type SessionInvocation = SessionInput & ModelScope

/** Gateway-specific invocation callback input. */
export type GatewayInvocation = GatewayInput & ModelScope

/** Additional overload on SessionDomain.hook. */
export type SessionHook = (
  name: "model.invoke",
  callback: (input: SessionInvocation) => HookResult | Promise<HookResult>,
) => Promise<Registration>

/** Additional overload on GatewayDomain.hook. */
export type GatewayHook = (
  name: "model.invoke",
  callback: (input: GatewayInvocation) => HookResult | Promise<HookResult>,
) => Promise<Registration>
```

These call signatures are intersected with the existing hook signatures; they do
not replace `session.prompt`, `session.model.request`, or MCP Tool hooks.

The equivalent Effect contract, in `packages/plugin/src/effect/model.ts`:

```ts
import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

/** One physical inference attempt's resources and usage observation. */
export interface ModelScope {
  readonly onUsage: (callback: (tokens: Tokens) => Effect.Effect<void, ModelError>) => void
  readonly onClose: (finalizer: Effect.Effect<void>) => void
}

/** Session-specific invocation callback input. */
export type SessionInvocation = SessionInput & ModelScope

/** Gateway-specific invocation callback input. */
export type GatewayInvocation = GatewayInput & ModelScope

/** Additional overload on the Effect Session hook interface. */
export type SessionHook = (
  name: "model.invoke",
  callback: (input: SessionInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
) => Effect.Effect<Registration, never, Scope.Scope>

/** Additional overload on the Effect Gateway hook interface. */
export type GatewayHook = (
  name: "model.invoke",
  callback: (input: GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
) => Effect.Effect<Registration, never, Scope.Scope>
```

The Scope used to register a callback is the Plugin activation. The Scope supplied
when executing the callback is the physical inference attempt. The Promise adapter
must preserve that distinction instead of running invocation work in its captured
setup Scope. `Budget.reserve` uses the invocation Scope directly.

### Lifecycle guarantees

1. Wait for Plugin readiness, capture the applicable ordered callbacks, then admit
   one physical attempt. A refusal stops before the Provider exchange.
2. Routing finishes before admission. Admission receives frozen final selection;
   subsequent hooks cannot redirect to another Model without fresh resolution and admission.
3. `onUsage` receives a frozen normalized `Tokens` value at most once, after the
   owning path successfully records authoritative Usage. Missing usage is unknown,
   not a synthetic zero-token record.
4. Every registered usage observer runs even if an earlier observer fails. Report
   failure after observers have run; one Limiter refusal must not skip Budget settlement.
5. `onClose` runs once on completion, failed admission, upstream error, cancellation,
   or body abandonment when the owning request Scope closes. Run all finalizers in
   reverse registration order even when one fails. Scope closure also releases
   resources acquired by Effect-native callbacks.
6. Streaming keeps the invocation Scope alive until body consumption ends. Returning
   HTTP headers does not close the invocation. Preserve backpressure and cancellation.
7. Usage recording errors remain visible to the owning executor; do not notify
   observers that accounting succeeded. Scoped reservation cleanup still runs.
8. For the first implementation, reload closes admission, drains active invocation
   scopes, then closes/replaces the Plugin activation. Reuse readiness and Scope
   mechanisms; long streams can delay reload. Do not close Plugin-owned resources
   underneath an active callback.
9. A rejected Promise or invalid callback result becomes an unavailable ModelError
   at the adapter. Preserve interruption. Internal diagnostics identify Plugin and
   hook without copying raw inputs, credentials, or arbitrary thrown messages.

The host owns sequencing and cleanup. Plugins own the actual admission rules.

## 3. Gateway request customization

Add `model.request` to `GatewayDomain.hook` before final catalog resolution. It
supplies the caller-native body; Plugins do not force all formats into Chat Completions.

In `packages/plugin/src/gateway-hooks.ts`:

```ts
import type { LLMGateway } from "@bymorning/schema/llm-gateway"

/** Mutable native request before destination resolution. */
export interface GatewayRequest {
  readonly protocol: LLMGateway.Protocol
  readonly requestedModel: string
  readonly stream: boolean
  model: string
  body: LLMGateway.Body
}
```

The additional registration signatures are:

```ts
// packages/plugin/src/promise/gateway.ts: merge with existing GatewayHook
export interface GatewayHook {
  (
    name: "model.request",
    callback: (input: GatewayRequest) => void | ModelError | Promise<void | ModelError>,
  ): Promise<Registration>
}

// packages/plugin/src/effect/gateway.ts: additional GatewayDomain.hook overload
export interface RequestHook {
  (
    name: "model.request",
    callback: (input: GatewayRequest) => Effect.Effect<void, ModelError>,
  ): Effect.Effect<Registration, never, Scope.Scope>
}
```

`GatewayRequest` is imported from `../gateway-hooks.js`, `ModelError` from
`@bymorning/schema/plugin-model`, and Registration from each surface's existing
`./registration.js`; the Effect form imports Effect and Scope from `effect`.
A common routing function can be registered with Session's existing `model.request`
hook and this Gateway hook using their actual input representations.

`model` is authoritative for routing; the existing protocol adapter rewrites the
native body's Model selector from the resolved destination. `protocol` and `stream`
are fixed for the invocation. Reparse the resulting native body with the owning
adapter, reject inconsistent stream settings or invalid hook output, and recheck
destination compatibility. A hook defect is a server failure; it is not blamed on
the authenticated caller. Endpoint and authentication configuration belongs to
Catalog/Provider/Integration; the existing Session transport hooks retain their
per-request role.

Native response-stream transformation is a separate extension from these admission
and request hooks. This proposal does not claim that `onUsage` can rewrite output.

## 4. Workspace Plugin hosting

Express the existing Workspace and Member distinction in Plugin activation. Add an
explicit `scope: "workspace"` option. Omission retains the current member-bound host.

In `packages/plugin/src/promise/plugin.ts`, retain the current Context minus Policy,
and add these signatures:

```ts
import type { Workspace } from "@bymorning/schema/workspace"

/** Workspace-only capabilities available without selecting a member. */
export interface WorkspaceContext {
  readonly app: Context["app"]
  readonly options: Context["options"]
  readonly location: { readonly workspaceID: Workspace.ID }
  readonly catalog: Context["catalog"]
  readonly gateway: Context["gateway"]
  readonly session: Pick<Context["session"], "hook">
  readonly tool: Pick<Context["tool"], "hook">
  readonly storage: Context["storage"]
}

/** Common Plugin declaration fields. */
export interface PluginFields {
  readonly id: string
  readonly tui?: boolean
  readonly configuration?: PluginConfigurationDefinition
}

/** One declared activation scope with its corresponding capability surface. */
export type Plugin = PluginFields & (
  | {
      readonly scope: "workspace"
      readonly setup: (context: WorkspaceContext) => Promise<Cleanup | void> | Cleanup | void
    }
  | {
      readonly scope?: "member"
      readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
    }
)

/** Preserve the selected Plugin declaration. */
export declare function define<P extends Plugin>(plugin: P): P
```

`PluginConfigurationDefinition` and `Cleanup` use the existing imports and
declarations in this file. The Effect surface mirrors this discriminated declaration
with `effect` and `Effect<void, never, R>` rather than Promise `setup`.

Workspace Plugins are selected through Workspace configuration and activated once
per Workspace. Project-discovered Plugins retain the existing member host. This is
an explicit scope migration for Plugins that need to affect caller-less Gateway
inference, not implicit selection of a member to host them.

Both Session and MCP compose Workspace hooks first and member hooks second.
LLM Gateway consumes Workspace hooks only. Inference admission is conjunctive:
any callback may refuse, and no later callback turns a refusal into allowance.

Implement Workspace hosting inside Plugin's existing loader, registry, source,
configuration, supervisor, and host modules. Extend `Plugin.layer` with a typed
Workspace-host construction overload, supplied by the application composition root.
The overload constructs the same Plugin service over the reduced host capabilities;
it must not instantiate `Actor.Binding` or member services. Inventory and reload
operate on the actual owning activation, rather than reporting separate copies of
one Workspace activation for each member.

Workspace and member contributions to Catalog use the same effective Catalog rules.
Gateway and Session must receive the shared Workspace Catalog contribution before
destination resolution. Registration order remains configured Plugin order; changing
a display name does not reorder declarations.

Catalog transforms from either host register with the shared Workspace Catalog;
their registrations still belong to the contributing activation and disappear on
disposal. Connection resolution remains caller-specific through Integration. A
member-local copy of Catalog would fail the glossary's shared availability contract.

The construction overloads in `packages/core/src/plugin.ts` are:

```ts
import type { App } from "@bymorning/plugin/app"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Layer } from "effect"
import type { Bus } from "./bus.js"
import type { Catalog } from "./catalog.js"
import type { State } from "./state.js"
import type { Storage } from "./storage.js"
import type { PluginHooks } from "./plugin/hooks.js"
import type { HostServices } from "./plugin/host.js"
import type { Service } from "./plugin/registry-service.js"

/** Construction inputs for a Workspace-only Plugin host. */
export interface WorkspaceHost {
  readonly scope: "workspace"
  readonly workspaceID: Workspace.ID
  readonly app: App
  readonly catalog: Catalog.Interface
  readonly shellHooks: PluginHooks.Interface
  readonly storage: Storage.Interface
}

/** Construct the shared Workspace Plugin activation runtime. */
export declare function layer(
  services: WorkspaceHost,
  coordinator?: State.Coordinator,
  options?: ActivationOptions,
): Layer.Layer<Service, never, Bus.Service>

/** Construct the existing full member-bound Plugin activation runtime. */
export declare function layer(
  services: Omit<HostServices, "bus" | "plugin">,
  coordinator?: State.Coordinator,
  options?: ActivationOptions,
): Layer.Layer<Service, never, Bus.Service>
```

`ActivationOptions` is declared in section 5. `shellHooks` preserves the current
host field spelling. The member factory supplies the shared Catalog plus its local
hook contribution view, with Workspace callbacks composed first. Context construction
does not start inference or activate Plugins recursively.

## 5. Budget and Limiter become internal Plugins

Use ordinary internal Effect Plugins, following `PluginInternal.list` dependency
injection. Keep the public Plugin API free of Core service imports.

| Plugin | Dependencies | Invocation behavior |
| --- | --- | --- |
| `bymorning.limiter` | Limiter, Config | Consume request/model allowance; register actual-token charge with `onUsage` |
| `bymorning.budget` | Budget, Config, Usage | Reserve in the invocation Scope; register settlement with `onUsage`; Budget already owns release |
| `bymorning.model-routing` | Effective Catalog and Plugin options | Register Session and Gateway request transforms |

Each limits Plugin declares Workspace scope and registers its callback for both
`session.model.invoke` and `gateway.model.invoke`. The default order is Limiter then
Budget, preserving the existing admission sequence. Capture only stable service
interfaces during activation; read current Config when admitting each invocation.

Existing public service contracts are sufficient:

```ts
import type { Budget } from "@bymorning/core/budget"
import type { Config } from "@bymorning/core/config"
import type { Limiter } from "@bymorning/core/limiter"
import type { Usage } from "@bymorning/core/usage"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Effect, Scope } from "effect"

// Exact dependency projections; these are not new services.
type BudgetAccess = {
  readonly reserve: (input: { readonly workspaceID: Workspace.ID }) => Effect.Effect<
    Budget.Reservation,
    Budget.ExceededError | Usage.StoreError,
    Scope.Scope | Config.Service | Usage.Service
  >
}

type LimiterAccess = {
  readonly consume: (input: {
    readonly workspaceID: Workspace.ID
    readonly model: string
  }) => Effect.Effect<void, Limiter.LimitError | Limiter.StoreError, Config.Service>

  readonly charge: (input: {
    readonly workspaceID: Workspace.ID
    readonly tokens: number
  }) => Effect.Effect<void, Limiter.LimitError | Limiter.StoreError, Config.Service>
}
```

These are quoted operations, not new services. Configured hard caps remain in
`Config.gateway`, including the existing budget controls. Do not duplicate these
fields in Plugin options. Policy-specific routing/redaction options use the existing
Plugin `configuration` forms.

The application declares the built-in limits Plugins as required for the configured
hard-cap capability. Plugin readiness must report an activation failure when that
required contribution is absent; an empty hook list is not successful activation.
Represent that failure as `Plugin.ActivationError` with the failing Plugin ID and a
safe message. Require it through Plugin composition/readiness, not a second limit
check in the executor. With no caps configured, the built-in callbacks succeed without
creating additional restrictions.

The readiness contract changes explicitly:

```ts
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Schema } from "effect"
import type { Effect } from "effect"

/** A required Plugin contribution could not be activated. */
export class ActivationError extends Schema.TaggedError<ActivationError>()("Plugin.ActivationError", {
  pluginID: PluginSchema.ID,
  message: Schema.String,
}) {}

/** Construction-time Plugin requirements declared by the owning Application. */
export interface ActivationOptions {
  readonly required?: ReadonlyArray<PluginSchema.ID>
}

// Replacement for the existing readiness field in Plugin.Interface.
type Readiness = {
  readonly awaitActivation: Effect.Effect<void, ActivationError>
}
```

Required IDs default to an empty list at the reusable Plugin layer; production
composition supplies the configured capability's required IDs. They are host
construction data, not something a third-party Plugin can declare for itself.

## 6. Core Plugin hook interface

Keep `PluginHooks.Service`; add scoped invocation support behind the existing Plugin
public entrypoint. The additional operation has this signature:

```ts
import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import type { Effect, Scope } from "effect"

/** Input for one owner-specific invocation hook execution. */
export type InvocationInput =
  | { readonly domain: "session"; readonly event: SessionInput }
  | { readonly domain: "gateway"; readonly event: GatewayInput }

/** The executor's usage-observation capability for an admitted invocation. */
export interface Invocation {
  readonly usage: (tokens: Tokens) => Effect.Effect<void, ModelError>
}

/** Additional operation intersected into PluginHooks.Interface. */
export interface InvocationAccess {
  readonly open: (input: InvocationInput) => Effect.Effect<Invocation, ModelError, Scope.Scope>
}
```

`register` gains the two invocation-specific callback overloads, accepting
Effect callbacks requiring the invocation Scope. `trigger` continues to execute
ordinary transform hooks, including the new Gateway request hook; invocation hooks
execute only through `open`. `has` includes both kinds. `open` owns callback collection,
invocation-scoped execution, usage notification, and finalization; it knows neither
rates nor money. The executor calls `usage` only with recorded accounting facts and
does not carry Budget reservations through its private exchange interfaces.

Private implementation belongs under `packages/core/src/plugin/`. Consumers use the
supported `Plugin.Hooks` projection rather than a new cross-domain private import.

## 7. Call and dependency graphs

```text
Session request / title / compaction / generate
  -> Plugin readiness
  -> existing Session prompt/context/model hooks
  -> final ModelResolver selection
  -> Session physical Provider wrapper
       -> Plugin.Hooks.open(session)
            -> Limiter Plugin -> Limiter.consume
            -> Budget Plugin  -> Budget.reserve
       -> Provider.stream
       -> Usage-owned Session recording
       -> Invocation.usage
            -> Limiter Plugin -> Limiter.charge
            -> Budget Plugin  -> Reservation.settle
       -> invocation Scope closes

External inference HTTP
  -> authentication and authorization at server edge
  -> LLMGateway.invoke
       -> acquire Workspace Plugin/Catalog runtime and await readiness
       -> parse native request
       -> gateway.model.request
       -> final Catalog/ModelResolver selection and compatibility checks
       -> Plugin.Hooks.open(gateway)
            -> the same Limiter and Budget Plugin callbacks
       -> native or translated Provider exchange
       -> Usage.record
       -> Invocation.usage
       -> invocation Scope closes after body consumption

Inbound MCP
  -> authenticated member runtime and Plugin readiness
  -> gateway.tool.execute.before
  -> shared Tool execution and Permission checks
  -> gateway.tool.execute.after
```

MCP Tool execution does not consume inference allowance merely because it is a Tool
call. If a Tool invokes ByMorning inference, that invocation goes through its owning
inference hook lifecycle. Session Tool hooks and MCP hooks remain distinct callback
contracts; a Plugin can register one pure input/output function at both points.

```text
Application process Layer
  Database + Storage + HTTP + Crypto
  Budget.stateNode -> Budget.sharedLayer
  Limiter.stateNode -> Limiter.sharedLayer
  Workspace Plugin runtime (keyed by Workspace, retained)
    Config + Usage + Catalog + Plugin.Hooks + Plugin activation/supervision
    built-in limit Plugins capture process-shared Budget/Limiter services
    |
    +-- LLM Gateway lease
    |     Workspace configuration/catalog/authentication + shared hooks
    |
    +-- member runtime
          existing member Plugin host/hooks + Session + MCP + Permission
          Workspace hooks compose before member hooks
```

Construct process-owned Budget and Limiter state once. Never provide their isolated
memory Layers per Plugin activation or Gateway lease. Continue explicit Layer
composition through the existing Application/Workspace factories; do not construct
Layers inside hook callbacks.

The executor and Usage recording remain independent of admission Plugins. Move the
limit calls out of `Usage.sessionProviderLayer` and Gateway exchanges, retaining
Usage observation and membership verification in their existing owners. This also
breaks Usage's runtime dependency on Budget/Limiter for admission.

## 8. Inputs, outputs, and failures

| Operation | Input | Success | Expected failure |
| --- | --- | --- | --- |
| Hook registration | Literal event name and typed callback | Existing scoped Registration | No typed failure for valid registration; activation reports configuration/load failures |
| `gateway.model.request` | Parsed native request draft | Validated draft and resolved destination | ModelError; existing Gateway input/destination errors |
| `Plugin.Hooks.open` | Final SessionInput or GatewayInput | Invocation with usage notification | ModelError; failed admission closes acquired resources |
| `Invocation.usage` | Recorded normalized Tokens | Every registered observer has run | ModelError; all observers and finalizers still run |
| Invocation close | Owner Scope termination | Every finalizer attempted exactly once | Unexpected cleanup failures are diagnosed without skipping other cleanup |
| Required Plugin readiness | Selected generation and required built-in identities | Required contributions are active | Plugin.ActivationError |

| Source failure | Plugin result | Before Gateway commitment | Session mapping |
| --- | --- | --- | --- |
| Budget.ExceededError | ModelError budget + retryAfter | Existing native budget refusal, HTTP 429 | Provider.FailureError quota |
| Limiter model refusal | ModelError model | Existing model refusal, HTTP 403 | Provider.FailureError content-filter |
| Limiter request/token refusal | ModelError rate + retryAfter | Existing rate refusal, HTTP 429 | Provider.FailureError rate-limit |
| Budget/Usage/Limiter store failure | ModelError unavailable | HTTP 503 native error | Provider.FailureError internal |
| Custom admission refusal | ModelError denied | Native policy refusal, HTTP 403 | Provider.FailureError content-filter |
| Plugin activation/callback failure | unavailable | HTTP 503 native error | Provider.FailureError internal |

Extend Gateway's private DeniedError reason union for custom policy refusal and its
native projections. After a streaming response is committed, a typed completion
failure terminates the stream using the existing stream-error path; it cannot replace
the response with a new HTTP status. Do not retry policy refusals as Provider outages.
Preserve existing Provider failure handling for actual upstream failures.

## 9. Worked examples

### Minimum happy path

Fixture: use the existing `Bedrock.make()` scenario's configured and available
`amazon-bedrock/amazon.nova-pro-v1:0` Model; no hard caps; default limit Plugins
active. The proposed script sends OpenAI Chat Completions input:

```json
{
  "model": "amazon.nova-pro-v1:0",
  "messages": [{ "role": "user", "content": "hello" }],
  "stream": false
}
```

The admission event is:

```text
id: request-generated correlation ID
workspaceID: fixture Workspace ID
model: { provider: amazon-bedrock, id: amazon.nova-pro-v1:0 }
publicModel: amazon.nova-pro-v1:0
stream: false
protocol: openai-chat
```

No routing change occurs. Limiter accepts; Budget creates its normal scoped
reservation. The scripted Provider returns text `hello` with input=3, output=2,
reasoning=0, cacheRead=0, cacheWrite=0. Usage records those values once. Each observer
receives exactly that Tokens value; settlement occurs; scope cleanup completes.
The caller receives HTTP 200 and the existing translated OpenAI reply containing
the scripted `hello` text, with the existing permitted response headers. No error.
Correlation headers are generated,
not fixed example literals.

### Budget refusal

Fixture: budget is $10 and authoritative monthly spend is $10. The same input
reaches the Budget Plugin, whose reserve fails. It returns ModelError budget with
the existing period retryAfter. Gateway renders its native HTTP 429 error. The
Provider receives no request, no usage observer runs, and acquired resources close.
The same Plugin callback on a Session attempt produces its quota failure through
Provider.FailureError, including background purposes.

### Cancellation and reload

Open a streamed call, then request Plugin reload. New admissions wait. Cancel the
stream before usage is observed: its reservation releases, cleanup runs once, and
reload completes after the invocation drains. The next call uses the new Plugin
configuration; counters still use the same process-owned stores.

## 10. Deletion test and migration

Removing Policy/ManagedPolicy eliminates the separate rule registry, CRUD, suppression,
simulation, and eight-kind interpreter. The retained behavior belongs to Plugins
and existing owning capabilities. Removing Plugin invocation support instead would
spread callback lifetime and cancellation machinery across Session and Gateway;
that support earns its place inside Plugin.

Migrate existing definitions deliberately:

| Current rule | Destination |
| --- | --- |
| Model/Provider guardrails | Model invocation callback |
| Permanent Tool permissions | Existing Permission configuration and admin authority |
| Model routing | Session/Gateway model-request callbacks |
| Static endpoint/authentication | Catalog/Provider/Integration configuration |
| Conditional Session endpoint | Existing Session model-request hook |
| Tool input/output transforms | Session Tool and MCP gateway callbacks |
| Prompt rewrite | Existing Session prompt hook; Gateway native request callback where applicable |
| Per-request instructions | Existing Session context hook |
| Durable company guidance | Instruction-owned source through the existing composition point |
| Escalation | Plugin callback with Session-scoped state and explicit disposal; not inferred from gateway calls |

Export retained managed definitions and produce an ID-by-ID conversion report before
removing their storage reader. The existing inactive Tool/escalation kinds are not
treated as proven enforcement. Remove the authoring endpoints only after their
replacement Plugin configuration has been installed and verified. Archive exported
definitions for migration evidence; do not silently delete user-authored content.

`ModelPolicy` is Catalog reconciliation, not the rule service being removed.

## 11. File layout

```text
packages/schema/src/plugin-model.ts               add     inference hook inputs/errors
packages/schema/src/plugin.ts                     change  activation scope in inventory
packages/plugin/src/gateway-hooks.ts              add     native Gateway request draft
packages/plugin/src/promise/model.ts              add     Promise invocation lifecycle
packages/plugin/src/effect/model.ts               add     Effect invocation lifecycle
packages/plugin/src/promise/{plugin,session,gateway}.ts
packages/plugin/src/effect/{plugin,session,gateway}.ts
                                                  change  scope-aware hosts and hook overloads
packages/plugin/src/promise/adapter.ts             change  typed results and invocation lifetime
packages/core/src/plugin.ts                       change  Workspace host construction/reload
packages/core/src/plugin/{host,hooks,supervisor,source,registry-service}.ts
                                                  change  shared activation and scoped hook execution
packages/core/src/plugin/internal.ts              change  inject existing limit authorities
packages/core/src/plugin/internal/limiter.ts       add     Limiter Plugin
packages/core/src/plugin/internal/budget.ts        add     Budget Plugin
packages/core/src/plugin/internal/policy/model-routing.ts
                                                  move    direct hook-based routing Plugin
packages/core/src/usage.ts                        change  observation without embedded limit calls
packages/core/src/llm-gateway.ts                  change  native draft and invocation hooks
packages/core/src/llm-gateway/{lease,exchange}.ts  change  hook capability and observation
packages/core/src/llm-gateway/translation/exchange.ts
                                                  change  same invocation lifecycle
packages/server/src/{llm-gateway-lease,workspace-map/graph}.ts
                                                  change  explicit shared Workspace Plugin Layer
packages/core/src/session/{model-request,context-policy,inbox}.ts
                                                  change  retire Policy evaluation after migration
packages/core/src/policy.ts                       delete  after migration
packages/core/src/policy/**                       delete  after migration
packages/core/src/managed-policy.ts               delete  after migration
packages/schema/src/policy.ts                     delete  after transport/Plugin migration
packages/plugin/src/{promise,effect}/policy.ts    delete  after Plugin migration
packages/protocol/src/groups/policy.ts            delete  after authoring migration
packages/server/src/handlers/policy.ts            delete  after authoring migration
packages/web/src/gateway/policies/**              change  replace authoring with Plugin configuration
packages/testing/src/scenario/plugin.ts           add     reusable real Plugin scenarios
packages/testing/test/plugin-inference.test.ts    add     end-to-end hook/enforcement scenarios
```

Protocol/OpenAPI/generated clients, exports, Plugin events, docs, and consumers of
PolicyEnforced traces must migrate together. Use Plugin/hook provenance in traces
instead of inventing replacement Policy IDs. Schema/Protocol compatibility review
precedes removal of the generated public surface.

## 12. Verification

Use `TestApp.make`, real generated SDK calls, disposable PostgreSQL, configured
Plugins, and scripted external Providers. Extend existing Gateway/Bedrock scenarios
for external inference. Exercise MCP through the real MCP endpoint. Do not fabricate
Workspace graphs, SDK responses, or accounting events.

Required scenarios:

- One routing Plugin affects Session and Gateway with the correct protocol-specific input.
- Shared Workspace limits cover Gateway, assistant, generate, title, and compaction.
- Concurrent Gateway and Session attempts see one shared budget/rate store.
- Budget refusal prevents upstream receipt; request rate and model refusals map correctly.
- Actual tokens and spend are recorded once; observers run once; retries have distinct attempt lifetimes.
- Non-stream, SSE, native, and translated/Bedrock responses share cleanup semantics.
- Failed admission after reservation, upstream error, cancellation, and unconsumed body release resources.
- A failing usage observer does not skip other observers or finalizers.
- A Usage write failure is visible and never reported to Plugins as committed accounting.
- Required Plugin failure prevents admission; no inference occurs through an empty registry.
- Reload drains an active invocation without resetting counters or changing its callbacks.
- A cold Gateway request activates Workspace Plugins without selecting or fabricating a member.
- Plugin configuration and inventory refer to one Workspace activation across member/Gateway views.
- MCP and Session Tool checks/redaction use their respective hooks and preserve Permission behavior.
- Native request transformations are revalidated; unsupported destination features remain explicit failures.

Use focused Plugin tests for callback order, typed errors, and Scope behavior. Run
package-local typechecks, regeneration checks, and the relevant Application scenarios
after implementation. This design document itself makes no runtime verification claim.
