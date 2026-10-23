# Unified Tool authority

> **Superseded proposal — historical context only:** [Tool registration](tool-registration.md) is the canonical
> approved contract. The subsequent prepared-snapshot correction explicitly authorizes shared direct/CodeMode
> presentation for Session and inbound MCP, an intentional breaking wire change. One Tool registry belongs to each
> member graph. Last-valid-wins/log-skip replaces batch rollback/collision rejection, and builtin **winning**
> registrations are excluded only by the gateway preparation prefilter. Caller-specific projections, raw metadata
> or Binding exports, Session selected-model/tool/combine admission, and settings Tool diagnostics below are not
> implementation requirements and must not be restored. Public Mcp owns remote lifecycle/auth with direct member
> dependencies; private Tool discovery consumes it. Plugin OpenAPI registration is `context.tool.openapi` over
> existing Integrations. Gateway package extraction and the context-requirement DSL remain out of scope.
> The published Code Mode [provenance](../../references/codemode.md) records the upstream pin and compatibility
> changes. This marker claims no completed migration verification, startup/auth success, or passing application suite.

**Confirmed:** one Tool authority consumed by the agent harness and Tool Gateway; breaking changes may simplify the design. The unified Tool meaning is recorded in `CONTEXT.md`.

**Proposed for approval:** requirements, interfaces, composition, and migration below. This is not implemented architecture.

This proposes replacing the dual-registry and `Tool.code` contracts in `gateway.md`. It preserves that document's approved gateway ownership and package placement: Gateway owns its protocol server, Core owns Tools, and Server composes them.

## 1. Requirements

### Shared

1. Register each Tool once in one canonical `Tool.Service` instance per authenticated runtime. Harness and gateway leases of the same runtime reuse that instance. Member-bound catalogs and credentials must not be pooled across members.
2. Built-ins, plugin callbacks, sandbox implementations, and imported MCP Tools use the same definition and execution contract. Provenance is diagnostic information, not a second exposure mechanism.
3. One definition owns identity, namespace, description, input/output schemas, required context, execution callback, permission action, and Code Mode preference.
4. Tool registration supports scoped, ordered, replayable transforms. Refreshing an earlier MCP contribution does not move it above a later plugin override. Publish a new validated catalog atomically.
5. A request captures one immutable definition/executor snapshot. Catalog, search, direct definitions, and Code Mode bindings derive from that snapshot. Invocation cannot look up an arbitrary name in the live registry.
6. Registration changes affect future snapshots. Permissions and credentials remain execution-time authorities. A captured executor whose source is no longer usable returns an availability error rather than executing a different Tool or identity.
7. Every local invocation, including each nested Code Mode call, uses the same hook, schema, policy, permission, result, progress, and cancellation machinery.
8. Preserve structured output and media. A missing output schema means an unknown JSON-compatible result, never `string | null`. Use the upstream schema-adapter behavior consistently in every presentation, including its documented raw-JSON-Schema validation limits.
9. Cancellation reaches execution and scoped resources. Each nested call receives its own CallID and its parent's CallID. Calling the same Tool twice with different inputs must execute twice; a Tool name or parent CallID is not a deduplication key.
10. Common `tool.execute`, `tool.input`, and `tool.output` policies apply to both consumers. Session/model-specific policy adds to that common path.

### Consumer requirements

| Concern | Agent harness | Tool Gateway |
|---|---|---|
| Identity | Authenticated member and real Session/Message/Agent | Authenticated member and external request |
| Project | Session's explicit Project, when present | Explicit authorized Project selection, when supplied |
| Session capability | Real Session services | Absent |
| Permission `ask` | Existing interactive Permission flow | Typed approval-required failure |
| Session admission | Model/tool checks, durable combination admission | Absent; no invented Model or Session |
| Results | Transcript, progress, bounded output retrieval | MCP content, structured content, progress, `isError` |
| Context delivery | Existing durable Instruction sources | MCP tool definitions and server guidance |
| Presentation | Direct Tools plus Code Mode according to registration | Same default; raw Tools when `codemode=false` |
| Lifetime | One snapshot per model request | One snapshot per incoming MCP request/execution |

**Exposure rule:** a Tool is eligible when its context requirements are met and caller selection/policy permits it. Actual resources are authorized at invocation. There is no `exported` registry or built-in-versus-plugin exposure rule.

This deliberately permits a project file Tool through the gateway when an authorized Project is explicitly supplied and permission allows it. A Session-dependent Tool remains unavailable without a Session. Existing grants must be reviewed as part of migrating from provenance-based gateway exposure.

An `ask` Tool may remain in the catalog when resource-specific authorization cannot be determined until input is supplied. Advertising a Tool is not approval to execute it.

## 2. Ownership

```text
Built-in / Plugin / Outbound MCP adapter
                    |
                    | register once
                    v
              Tool.Service
          transforms + definitions
          request snapshot + execution
                    |
          +---------+---------+
          |                   |
     Session binding     Gateway binding
     real Session        external request
     Project capability  optional Project capability
     interactive auth    non-interactive auth
     durable admission   external selection
          |                   |
          +---------+---------+
                    v
             Tool.Snapshot
       definitions + catalog + execute
                    |
          direct / Code Mode dispatch
                    |
             common leaf execution
                    |
             registered callback
```

`Tool.Service` owns registration, normalization, names, transforms, snapshots, dispatch, common policies, hook sequencing, and result normalization.

Session owns conversation state, model-specific restrictions, durable admission, interactive permission binding, and recording. Its private binding supplies those behaviors to Tool; it does not implement another executor.

Tool Gateway owns authentication orchestration, external selection, non-interactive permission binding, MCP transport, and MCP result encoding. It consumes the supported `Tool` entrypoint and has no dependency on private Code Mode files.

Outbound MCP owns remote connection/discovery lifecycle and uses Integration/Credential for authentication. Its private Tool adapter registers ordinary callbacks through one stable transform. It preserves tool schemas, namespace guidance, text, structured values, and supported media; responds to tool-list changes; and requests raw upstream Tools when wrapping a remote Code Mode server. A real Session ID is forwarded only for a Session invocation; untrusted external metadata cannot establish an internal Session identity.

The registry accepts one callback execution shape. Plugin's private sandbox adapter converts a sandbox implementation descriptor to that shape, closing over CodeInterpreter and Storage. Built-in factories close over their stable dependencies, including ProjectDirectory acquisition where needed. Authorized Project identity and real Session identity arrive through Tool.Context. This removes the large ambient service injection performed by current ToolExecution.

## 3. Context requirements

Keep this small and concrete:

- `requires: []`: usable without a Project or Session, for example an MCP ticket lookup.
- `requires: ["project"]`: needs the explicitly selected Project, for example project file reading.
- `requires: ["session"]`: needs a real Session, for example question, subagent orchestration, or Session-owned output retrieval.
- Both may be required.

Snapshot construction checks requirements for visibility; execution checks them again defensively. The declaration is availability metadata. Resource permission is still enforced by the callback's `context.permission` checks before side effects.

No separate `sessionOnly`, `gatewayOnly`, `exported`, or `interactive` flags. A genuinely new capability requirement would need its own justified domain decision.

## 4. Proposed Tool interface

Declarations below are the supported service contract, not implementation pseudocode. Existing owned types (`ToolSchema.Info`, `Result`, `ValueSchema`, `PermissionRequest`, and schema IDs) retain their meanings except for the explicit schema amendments below. Shared callback data contracts live in Schema and are re-exported by Core; Schema and Plugin do not import Core services.

```ts
// packages/core/src/tool.ts -- namespace Tool
export type Requirement = "project" | "session"
export type Presentation = "auto" | "direct"

export type Origin =
  | {
      readonly type: "session"
      readonly sessionID: Session.ID
      readonly messageID: Message.ID
      readonly agent: Agent.ID
      readonly model: Model.Ref
    }
  | { readonly type: "external"; readonly requestID: string }

export interface Call {
  readonly id: CallID
  readonly name: string
  readonly input: unknown
  readonly parentID?: CallID
}

// Definition information only; no executable callbacks exposed in catalog entries.
export interface Entry {
  readonly id: string
  readonly path: string
  readonly description: string
  readonly input: JsonSchema.JsonSchema
  readonly output?: JsonSchema.JsonSchema
  readonly action: string
  readonly requires: ReadonlyArray<Requirement>
  readonly codemode: boolean
  readonly pinned: boolean
}

export interface Namespace {
  readonly name: string
  readonly description?: string
}

export interface Catalog {
  readonly entries: ReadonlyArray<Entry>
  readonly namespaces: ReadonlyArray<Namespace>
}

export interface Context {
  readonly userID: User.ID
  readonly origin: Origin
  readonly call: Call
  readonly projectID?: Project.ID
  readonly permission: (
    request: PermissionRequest,
  ) => Effect.Effect<void, Error>
  readonly progress: (metadata: Metadata) => Effect.Effect<void>
}

// A trusted host-created value, not a registry or a public configuration DSL.
export interface Binding {
  readonly origin: Origin
  readonly projectID?: Project.ID
  readonly presentation: Presentation
  readonly visible: (tool: Entry) => Effect.Effect<boolean, Error>
  readonly admit: (tool: Entry, call: Call) => Effect.Effect<void, Error>
  readonly permission: (
    request: PermissionRequest,
    call: Call,
  ) => Effect.Effect<void, Error>
  readonly progress: (call: Call, metadata: Metadata) => Effect.Effect<void>
}

export interface Editor {
  readonly list: () => ReadonlyArray<ToolSchema.Info>
  readonly get: (id: string) => ToolSchema.Info | undefined
  readonly namespace: (namespace: Namespace) => void
  readonly add: (tool: ToolSchema.Info) => void
  readonly update: (
    id: string,
    update: (tool: ToolSchema.Info) => ToolSchema.Info,
  ) => void
  readonly remove: (id: string) => void
}

export interface Snapshot {
  readonly catalog: Catalog
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly instructions: ReadonlyArray<string>
  readonly execute: (call: Call) => Effect.Effect<NormalizedResult, Error>
  // Restrict by canonical Tool ID; cannot introduce a definition or executor.
  readonly select: (ids: ReadonlySet<string>) => Snapshot
}

export interface Interface {
  readonly transform: (
    edit: (draft: Editor) => void,
  ) => Effect.Effect<{ readonly dispose: Effect.Effect<void> }, RegistrationError, Scope.Scope>
  readonly reload: () => Effect.Effect<void, RegistrationError>
  readonly snapshot: (
    binding: Binding,
  ) => Effect.Effect<Snapshot, Error, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()(
  "@bymorning/core/Tool",
) {}

export declare const layer: (
  userID: User.ID,
) => Layer.Layer<Service, never, Policy.Service | PluginHooks.Service>
```

### Schema amendments

`ToolSchema.Info` becomes the canonical callback definition: name, namespace/options, input/output codecs, `requires`, and `execute(input, context): Effect<Result, Tool.Error>`. Its callback has no unfulfilled Effect requirements. Existing schema-inferred authoring through `Tool.define` is retained; legacy implicit execution modes and sandbox descriptors are normalized by their supplying adapter before registration. Promise plugins keep the public `context.tool.transform` registration shape and Promise cleanup handle; the existing loader converts their callbacks into this common Effect contract. Plugin authors do not construct Tool.Binding values.

`ToolSchema.Context` becomes the context declared above. `NormalizedResult` retains `output`, normalized `content: ReadonlyArray<Content>`, and `metadata`. Codecs and wire-schema rendering remain private Tool implementation details.

`Tool.Error` retains its tagged class, message, cause, and metadata and gains a required `reason` union:

```ts
type Reason =
  | "unavailable" | "input" | "output" | "denied"
  | "approval" | "policy" | "execution" | "timeout"
```

`Tool.RegistrationError` identifies an invalid name, schema, context declaration, or conflicting normalized identity. Invalid transform/reload candidates do not replace the last valid catalog. Intentional same-ID overrides follow transform order; distinct paths that flatten to the same external name are registration errors.

These are the expected typed failure channels. Cancellation remains Effect interruption. Tool failures do not imply that external side effects were rolled back, and the execution path does not automatically retry mutations.

### Interface invariants

- `Binding` callbacks supply consumer-specific decisions; Tool fixes when they run. There is no arbitrary execution middleware chain.
- `visible` is a non-mutating filter, applied in addition to required-context and common policy filtering.
- `admit` is called once per invocation with the final decoded input, after common input checks. Session serializes its model/combination check and durable admission here, releasing its lock before executing the Tool.
- `permission` handles actual resource checks invoked by registered callbacks. For the gateway it uses shared pure evaluation and maps `ask` to `reason: "approval"`.
- The runtime binds `userID`; model arguments and external headers cannot substitute another member. The consumer authorizes the selected Project before snapshot construction. A built-in factory resolves its bound ProjectDirectory from that identity using captured services; it does not receive services through a schema-to-Core dependency.
- Scoped transforms are replayed in registration order; scope disposal removes that contribution. `reload` reevaluates the existing transforms without changing their order.
- `select` only narrows the current snapshot, recomputes direct/Code Mode presentation, and shares its execution machinery. Its returned view is not another registry.
- Request hooks may narrow selection. They cannot replace schemas or attach unregistered callbacks. This is an intentional simplification of the request Tool hook contract.
- The synthetic Code Mode `execute` is derived after selection and is subject to its own permission/policy check. It is never registered back into the registry or included as a callable inside itself.
- Snapshot execution is scoped to the request. Closing its scope interrupts owned work; attempts to reuse a closed snapshot fail as unavailable.

## 5. Execution sequence

```text
Captured Tool lookup + context eligibility
    -> common before hook (may transform arguments)
    -> decode final arguments
    -> common tool.execute / tool.input policy
    -> binding.admit (Session model/combinations/history, where applicable)
    -> callback
         -> context.permission(actual resources) before side effects
         -> host / outbound MCP / sandbox operation
    -> encode result against the registered codec
    -> common after hook
    -> common tool.output policy
    -> validate final result + normalize content/media
    -> return to direct adapter or Code Mode
```

Hooks carry `origin`, member, CallID, and parentID in one event shape. Gateway and Session hook domains converge on this event shape. Result transformations cannot silently invalidate the advertised output contract; invalid transformed results fail with `reason: "output"`.

Every Code Mode leaf follows that sequence. Code Mode owns local search, evaluation, Promise composition, and diagnostic rendering. Tool owns leaf execution. The outer dispatcher has its own CallID; repeated nested invocations always have distinct child IDs.

Common execution does not claim admission control over tools executed remotely by an inference provider before Core receives their result. Those provider-hosted operations must remain explicitly identified in the harness.

## 6. Presentation and MCP compatibility

| Mode | Native definitions | Code Mode catalog |
|---|---|---|
| `auto` | `codemode: false` Tools plus derived `execute` when permitted | Remaining eligible Tools |
| `direct` | All eligible Tools | None |

Both consumers use this table. Gateway's `?codemode=false` selects `direct`; otherwise it uses `auto`. It no longer unconditionally nests every registration in Code Mode. This also lets upstream OpenCode request raw Tools and perform its own orchestration.

Gateway encodes the shared result into MCP content and structuredContent, preserving supported media. Non-object machine values use one documented MCP-compatible envelope with a matching outputSchema; object outputs retain their object schema and structured shape. Domain/execution failures become `isError`; malformed protocol requests remain protocol errors. No schema decisions live in a second gateway registry.

An MCP list request and a later call request may observe different registry revisions. The call takes a fresh snapshot and checks availability again. A Tool removed between requests fails explicitly; no indefinitely retained catalog grants execution authority.

Initially preserve the current stateless inbound transport. Outbound tool-list-change notifications refresh the canonical registry. Inbound persistent-session notifications are a separate transport lifecycle decision, not a prerequisite for the registry design.

Harness Code Mode catalog instructions still enter through `Instruction.make` at the existing position in `session/context.ts`. MCP guidance remains its separately owned durable source. Gateway consumes catalog guidance without creating conversation instruction state.

## 7. Dependencies, files, and Layers

```text
packages/core/src/
  tool.ts                     public authority
  tool/
    registry.ts               private transforms and snapshots
    runtime.ts                shared execution and codecs
    codemode.ts                adapter to @opencode-ai/codemode
    catalog.ts                namespace/signature/rendering
  outbound-mcp.ts             existing connection authority
  outbound-mcp/tool.ts        private import adapter
  plugin/sandbox.ts           private implementation-to-callback adapter
  session/tool-binding.ts     private Session Binding factory

packages/gateway/tool/src/
  tool-gateway.ts             public gateway entrypoint
  tool-gateway/
    binding.ts                external Tool.Binding
    server.ts                 MCP wire adapter
    result.ts                 MCP result encoding
```

### Layer construction

```text
Application selects Storage / CodeInterpreter / HTTP / Database
                          |
Server member-runtime composition (existing shared lease/cache)
  |
  +-- Policy + PluginHooks --> Tool.layer(memberID) ---- ONE INSTANCE
  |
  +-- Credential --> Integration --> OutboundMCP
  |                                    |
  |                          private MCP Tool adapter --> Tool.Service
  |
  +-- selected services --> built-in / plugin factories --> Tool.Service
  |
  +-- Session + Permission + Policy + admission + authorized Project
  |       --> Session binding --> shared Tool.Service.snapshot
  |
  +-- authorized external request + Config + optional authorized Project
          --> Gateway binding --> shared Tool.Service.snapshot
```

Producer activation waits for discovery readiness before the first consuming snapshot. Outbound MCP depends on Tool; Tool never depends on Outbound MCP, Session, Gateway, or the activation supervisor. Layer composition explicitly reuses the Tool instance; neither consumer constructs its own Tool Layer.

### Gateway public interface

The gateway extraction's `ToolGateway.layer(options, binding)`, `server`, and `handle(request)` contract remains. The acquired runtime supplies `Tool.Service`, Config, and authorized Project resolution instead of exposing Core's private project/storage graph. Specifically:

```ts
// Namespace ToolGateway; replaces the proposed binding in gateway.md.
export interface Runtime {
  readonly tool: Tool.Interface
  readonly config: Config.Interface
  readonly project: (
    id: Project.ID,
  ) => Effect.Effect<Project.Info, Tool.Error>
}

export interface Binding {
  readonly acquire: (
    owner: OAuth.Authority,
  ) => Effect.Effect<Runtime, UnavailableError, Scope.Scope>
}

export interface Selection {
  readonly projectID?: Project.ID
  readonly presentation: Tool.Presentation
}

export interface Interface {
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope>
  readonly catalog: (
    owner: OAuth.Authority,
    selection: Selection,
  ) => Effect.Effect<Tool.Catalog, UnavailableError | Tool.Error, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()(
  "@bymorning/gateway/ToolGateway",
) {}

export interface Options {
  readonly resourceMetadata: URL
}

export declare const layer: (
  options: Options,
  binding: Binding,
) => Layer.Layer<Service, never, OAuth.Service | Crypto.Crypto>

export declare const server: Layer.Layer<
  never,
  never,
  Service | HttpRouter.HttpRouter | Etag.Generator |
  FileSystem.FileSystem | HttpPlatform.HttpPlatform | Path.Path
>
```

`ToolGateway.UnavailableError` retains the proposed workspace ID and runtime/activation reason. `handle` maps expected errors into protocol responses. Trusted `catalog` callers supply verified authority; HTTP callers acquire authority only through authentication. Proposed external Project selection is an optional `projectID` URL parameter; absence supplies no Project capability.

The catalog endpoint now returns the canonical catalog rather than a separate gateway-only diagnostic schema. If permission diagnostics are needed later, derive them from the same snapshot rather than storing another inventory.

### Deletion test

| Candidate | Result |
|---|---|
| Tool.Service | Keep: deleting it distributes schema, lifecycle, snapshot, dispatch, and normalization behavior across both consumers. |
| MCPGatewayTools / proposed Tool.Export | Delete: their only authority is a duplicate registration store. |
| registerBoth | Delete: complexity disappears with the second registry. |
| ToolExecution public service | Delete: callback execution belongs to Tool; sandbox adaptation belongs to its producer. |
| SessionTools execution service | Reduce to private binding: retain admission state under Session, remove generic execution machinery. |
| Tool Gateway | Keep: protocol, authentication orchestration, and external invocation policy remain distinct authority. |
| Generic middleware/pipeline service | Do not add: fixed sequencing plus a small Binding value covers the actual variation. |

## 8. Worked acceptance example

One `tickets.get-ticket` definition is registered from MCP, with object input/output schemas.

1. Harness, `auto`: model invokes `execute`; its program calls `tools.tickets["get-ticket"]({ id: "BUG-42" })`. Session admission runs, then the shared executor returns the object.
2. Gateway, `auto`: external caller invokes `execute` with the same program. Gateway permission evaluation runs, then the same executor returns the same object.
3. Gateway, `codemode=false`: caller invokes native `tickets_get-ticket`. The shared executor returns the same object encoded as MCP structuredContent.
4. A ticket resource requires approval: harness can ask; gateway returns approval-required before the remote mutation.
5. A project read Tool is registered alongside it. Without a selected Project it is absent; with an authorized Project and an allow rule it is usable through either consumer.
6. A question Tool is registered alongside it. Its Session requirement makes it absent from an external request.

Only the binding and outer representation differ. The definition, member credential authority, leaf executor, and common policies are shared.

## 9. Verification and migration

Public Tool tests cover transform ordering, disposal, invalid reload rollback, snapshot isolation, subset-only selection, context requirements, schema/output parity, common policy enforcement, hooks, and nested-call identity/cancellation.

Use a local real MCP SDK server to verify pagination, output schemas, text/media, error results, tool-list-change refresh, raw-tool preference, and session metadata. Test two same-name concurrent calls with different inputs, and configuration/credential changes while a captured call is pending.

Application scenarios use `TestApp.make`, public services, the generated SDK for harness/control-plane flows, a real MCP SDK client for gateway traffic, and scripted TestLLM requests. Exercise one imported Tool through harness direct/Code Mode and gateway direct/Code Mode. Verify persisted Session admission, interactive approval versus external refusal, member isolation, explicit Project selection, and real structured results. Use model/event gates and test cancellation signals as described in `app/testing/README.md`.

Migration order:

1. Approve the requirements and interfaces, pin the upstream reference revision, and record intentional differences as acceptance cases.
2. Build the unified Tool authority and migrate producers to one callback definition/registration path.
3. Bind Session and Tool Gateway to the same runtime instance; migrate hook contracts and Project requirements.
4. Replace MCP adaptation with the upstream-shaped schema/media/refresh path.
5. Remove duplicate services and legacy exports; update SDK/protocol generation for changed catalog and gateway presentation contracts.
6. Run affected package checks and application scenarios.

The main trade-off is deliberate: upstream's Tool structure remains the reference, but its Session-bound invocation context becomes a small host binding so the same authority also works for external callers. The proposal adds no new registry and no new general-purpose execution framework.
