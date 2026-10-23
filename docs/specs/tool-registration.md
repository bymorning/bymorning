# Tool registration — approved migration contract

**Status:** implementation complete; security gates, final published-artifact backend/Application suites, full
Application browser suite, and documentation/protocol checks pass within the recorded scope. The user's subsequent
prepared-snapshot correction explicitly supersedes outward caller projection: copy upstream's prepared snapshot
and use its same direct/CodeMode presentation for Session and inbound MCP. This file remains the canonical durable
contract; `/tmp/opencode/opencode-tool-plan.md` is the original approval record. Source now implements the shared
registry/snapshot path, public Mcp/private discovery split, and plugin OpenAPI surface. See the verification
gates below. Existing source is not proof that the safety contract or application verification is satisfied.
Integration questions explicitly listed below are not new approved interfaces.

**Dependency upgrade:** the current root catalog pins Effect to `4.0.0-rc.112` and both
`@opencode-ai/ai` and `@opencode-ai/codemode` to `0.0.0-beta-19192`. Code Mode no longer needs the
beta.102 compatibility patch. The [rc.112 checkpoint](#rc112-upgrade-checkpoint) records current upgrade evidence;
the later implementation checkpoint retains the earlier installation's verification counts. See
[Code Mode provenance](../../references/codemode.md) for artifact identity and separately labeled historical results.

**Source pin:** sibling `opencode`, Git HEAD `4cfca7ab68293f8757f944f0c3953f91f1e03b0b`, inspected for this checkpoint. Source locations are sibling Core `tool.ts`, `tool/runtime.ts`, `tool/mcp.ts`, `mcp/index.ts` and the existing `@opencode-ai/codemode` OpenAPI converter (`openapi/index.ts`, `spec.ts`, `runtime.ts`, `types.ts`). Source-faithful means the registration/lifecycle behavior below, not byte-for-byte copying.

This supersedes conflicting registration, execution, publication, interface, placement, and verification proposals in [Unified Tool authority](unified-tool.md), including the former dual-registry/public compiler proposals in `gateway.md` and this document's former outward-projection contract. Shared direct/CodeMode inbound MCP presentation is explicitly authorized, an intentional breaking wire change. The broader gateway package extraction, context-requirement DSL, common hook redesign, and external Project-selection API remain out of scope. Existing inbound `mcp-gateway.ts` retains its distinct authority.

## rc.112 upgrade checkpoint

The migration implementation is complete. Runtime Effect packages use `4.0.0-rc.112`;
`@opencode-ai/ai`, its `@opencode-ai/schema` dependency, and Code Mode use `0.0.0-beta-19192`.
Drizzle ORM and Kit use `1.0.0-rc.5-ab785fc`; Vitest uses `4.1.0`.

- **Code Mode remains unpatched.** All 74 installed published files match the tarball byte-for-byte.
  All 1,140 original upstream tests passed without source or test adaptations.
- **AI retains only its existing behavior patch.** The patch was ported with the same prior logic
  (77 added lines, 29 removed lines); 10 installed-artifact regressions passed. This is not a new
  compatibility patch, global shim, or replacement client.
- **Provider owns diagnostic safety.** The new upstream client no longer supplies the previous redaction.
  ByMorning captures credential-bearing request values per stream after hooks and authentication, sanitizes
  typed errors and provider-error messages, removes native transport causes from typed AI errors, and caps
  persisted response bodies at 16,384 characters. Safe request IDs remain available. The independent
  12-test Provider security review passed. Streaming bodies are not consumed for diagnostic capture.
- **Model and stream behavior remain explicit.** Provider options are flat, not nested in vendor wrappers.
  ByMorning supplies its selected Anthropic output limit through `generation.maxTokens`. A terminal text
  event's text is authoritative when present; otherwise the recorder retains accumulated deltas.
- **OpenAI Chat keeps the previous incomplete-stream behavior.** The published compatibility option
  `requireFinishReason: false` permits a stream to close without a finish reason. Only OpenAI Chat
  `step-finish` and `finish` events with normalized `stop` and undefined `raw` become `unknown`.
  Explicit `stop` and other protocols are unchanged.
- **Schema diagnostics stay input-safe by default.** rc.112 omits issue input unless `reportInput` is
  enabled. Do not enable it globally to restore old diagnostic strings. Current examples use
  `Schema.TaggedError` and `Schema.fromJsonString(Schema.Unknown)`; `Effect.catch` remains unchanged.

Final rc.112 verification is complete within the recorded scope:

- Core default: **613 tests / 106 files**, **0 skips**; Core integration: **200 tests / 17 files**, **0 skips**.
- Server: **121** tests passed, including all **4** Docker-profile tests. Application: **46** tests passed,
  including all **5** Docker tests.
- Web unit: **1,112** tests passed; Application browser: **8** tests passed. The focused security run passed **137** tests.
- All **14** package typechecks exited **0**: schema, plugin, plugin-google, core, server, app, web,
  protocol, client, docs, util, auth, models, and httpapi-codegen. Web Application fixture types are included.
  The root all-package typecheck also exited **0**.

Evidence is retained under `/tmp/opencode/effect-rc112/`: `final-core-summary.txt`,
`final-core-default.log`, `final-core-integration.log`, `final-app-owned.log`, and `final-server.log`.
Code Mode's original upstream test and byte-identity evidence is in `codemode-unpatched-tests.log` and
`codemode-unpatched-integrity.log`. Its patch remains absent; the existing AI behavior patch retains
its 10 passing artifact regressions. These results do not claim coverage of every possible legacy suite.
The implementation checkpoint below retains the earlier installation's counts, not current rc.112 results.

The rc.112 documentation pass completed `bun typecheck` and `bun run build -- --isolated` from
`packages/docs`. The isolated build produced 162 HTML pages; all 18,951 checked local links and
fragments resolved. Current spec/provenance links and the targeted whitespace diff check also passed.
This verifies the documentation build and links, not compilation of every fenced example or a visual browser review.

## Implementation checkpoint — verification gates

### Inbound MCP wire adaptation

The prepared Tool snapshot remains the sole source of definitions and execution. At the Server MCP boundary only,
the advertised input schema makes an object root explicit when the prepared schema is an object schema without a
`type` (notably an empty `Schema.Struct`). Scalar and array input schemas are not silently coerced. For output,
MCP's object-only `outputSchema` and `structuredContent` are satisfied by wrapping any declared non-object output
schema and result as `{ output: value }`; object-shaped outputs remain unchanged. A declared unconstrained (`{}`) output
uses the same object wrapper schema (`output` unconstrained). An absent output schema instead remains absent, and
content-only Tools return no `structuredContent`. Tool validation, execution, content, metadata, permissions, and hooks remain unchanged; this is transport
serialization at the SDK edge, not a second registry or projection framework.

The requirements and approved interfaces below remain normative. This checkpoint records completed implementation
and bounded verification evidence, including final browser/documentation checks; it introduces no replacement APIs.

- **Member registry isolation — verified for the recorded regression:** `packages/server/src/workspace-map.ts`
  hoists global dependencies and applies `Layer.fresh` around the complete compiled member graph before supplying
  it to `LayerMap`. Its shared memo map previously reused static Tool Layers across member keys, causing the real
  credential reproduction. The graph-level boundary retains same-member registry/dependency identity and shared
  globals while isolating member-owned mutable services and captured executors. The regression in
  `packages/server/src/workspace-map.test.ts`, “production keyed compilation isolates static Tool Layers while
  retaining one registry and shared globals”, covers those identities and unaffected sibling invalidation.
  `app/test/tool-auth.test.ts`, “real member OAuth stays isolated through direct/CodeMode Tools, refresh and
  revocation”, passed **1/1** (about 8 seconds); app typecheck exited **0**. The scenario verifies 12 direct/CodeMode
  calls, 10 protected HTTP calls, two real authorization-code flows, and one member-only refresh. Each member uses
  their own credential; member revocation causes two denials with zero protected HTTP calls and no owner/legacy
  shared fallback, and owner execution remains unaffected. This closes the member-registry gate, not builtin
  caller resource binding or other concurrency/transport gates.
- **Builtin caller binding — independently verified:** plugin-private
  `packages/core/src/plugin/internal/tool/binding.ts` captures typed registration-time dependencies, resolves the
  real member-filtered `Session.get`, rejects a mismatched Session/Project pair, and supplies the validated Project's
  directory. It uses no `any`, environment erasure, or execution-fiber context lookup. The original caller-A /
  ambient-directory-B reproduction independently reran using A; success and defect finalizers were also checked.
  Evidence includes the direct/CodeMode caller-binding regressions in `packages/core/test/integration/session.test.ts`
  and focused Tool tests. The implementation owner reported 84 PostgreSQL Session tests and 61 focused tests;
  independent review reran 3 targeted PostgreSQL tests and all 61 focused tests. No public Binding API is introduced.
- **MCP same-provider race — independently verified:** `mcp/oauth.ts` uses send-local provider state and scoped
  `FiberSet` runtimes, and `mcp/client.ts` binds that state around the actual SDK `transport.send`. The original stale
  save/invalidate reproduction in `packages/core/test/mcp-auth.test.ts` preserves the winning credential even when
  the same provider has a parallel header read. Independent and full-default runs passed 26 auth/transport/adapter
  tests (`mcp-auth.test.ts`, `mcp-transport.test.ts`, `tool-mcp.test.ts`) with stable source hashes. The 15 PostgreSQL
  Integration tests in `packages/core/test/integration/integration.test.ts` passed, including one dynamic client
  registration and automatic reconnect. Earlier broad MCP
  failures predate the client-hook checkpoint at 10:47:11Z and are not results for the current source.
- **Public helper cleanup — implemented:** `packages/core/src/tool.ts` no longer exports transitional
  `normalizeName`, `effectiveName`, `modelDefinition`, or `decodeInput`. Host inventory observes admitted editor
  values instead of computing registration IDs; Tool supplies its private definition renderer to Code Mode
  preparation, and MCP guidance uses Code Mode's callable path. Input decoding tests execute prepared snapshots.
  Host provenance remains internal; the `@internal` `withSource` bridge is not a plugin capability. The focused
  Tool/CodeMode/host/gateway suite passed 86 tests across 14 files. The earlier Core typecheck blocker in the
  concurrent OpenAPI Span assertion is superseded by the reported Core/Server/app/web typechecks exiting 0 below;
  helper removal and the internal provenance boundary are unchanged.
- **OpenAPI production redirect/telemetry safety — independently verified:** independent review passed **55/55**
  focused tests, including **13** production-host cases in `packages/core/test/tool-openapi-host.test.ts`.
  `packages/core/src/plugin/host.ts` pins `redirect: "manual"` and `credentials: "omit"` at execution on the same
  Promise host path used in production; malicious invocation `RequestInit` cannot override that policy and
  redirect destinations receive zero requests. Effect-internals review confirmed the transport policy and that
  `tool/openapi.ts` disables transport tracing locally before client spans/attributes are created, retaining only
  sanitized namespace/origin instrumentation and errors. Observed attribute writes, events, and failure causes
  contain no query/custom-header/basic/bearer secrets, including reflected failures. Actual socket tests cover
  timeout before headers and during body reading, caller interruption, and unread oversized-response cleanup;
  no test-only transport injection establishes these guarantees. Setup validation and name admission reject
  invalid options, overlong names, and normalized collisions with typed atomic errors before registration;
  operation names are not truncated. The member graph's `Layer.fresh` boundary is unchanged.
  Separately, the source owner reported **57** focused tests including Gmail, **607** Core tests, and Core/Server/app/web
  typechecks exiting **0**. These are broader reported results, not the independent review's 55-test run.
- **Docker Application execution — verified for the recorded scenarios:** `app/test/execution.test.ts` passed
  **5** real Application tests for Python/JavaScript, permission approval, persisted ToolOutput text artifacts and
  retrieval, exit-code 7 stdout/stderr, SDK interruption/container cleanup, and background Shell Job
  lifetime/cancellation. `packages/server/src/adapters/docker.test.ts` also passed **4** real adapter tests.
  `run` exports no binary/media artifacts; these scenarios prove its text output and existing structured result,
  not a new artifact-export capability.
- **Published Code Mode dependency — pre-rc.112 checkpoint:** the root catalog pinned
  `@opencode-ai/codemode` exactly to `0.0.0-beta-19192`. Its 36 runtime modules match the audited source pin after
  emission; stable `latest` 1.18.4 lacks the required `Namespace` API. The switch removes the 75-file, 49,905-line
  interpreter workspace and retained a 61-line dependency patch (24 additions, 3 removals) touching only
  `dist/tool-error.js` and `dist/tool-schema.js` for Effect beta.102 compatibility. A frozen-lockfile install worked,
  and consumers resolve installed `dist`, not a local workspace symlink. The installed artifact passed all **1,140**
  upstream tests, **607** Core default tests, consumer typechecks, **2** real Application Tool/auth tests, and **2**
  focused browser tests. See the provenance reference for integrity, MIT notice, historical patch rationale, and the initial
  browser-run caveat. These are artifact-specific results, not results inherited from the former vendored source.
- **Final published-artifact suites — verified from retained logs:** Core integration passed **200 tests in 17
  files**, Server with `LOCAL_EXECUTION_IMAGE` passed **121 tests in 24 files** (including 4 Docker tests), and the
  Application passed **45 tests in 12 files** (including 5 real Docker tests and member OAuth/permission scenarios).
  Each run had **0 skipped tests** and exit **0**. Evidence:
  `/tmp/opencode/final-published/{core-integration.log,server.log,app.log}`. Core/Server/app/web typechecks exited 0;
  installed-artifact resolution and the two dependency patches were independently verified. These logged runs are
  distinct from the source owner's 607 Core-default/1,140 upstream-artifact results and the independent focused
  security reviews above.
- **Final browser and contract/docs checks — verified:** the full Application browser suite passed **8 tests**,
  **0 skips**, exit **0** against the installed artifact (`/tmp/opencode/final-published/browser.log`). Protocol passed
  **60 tests / 24 files** after correcting two obsolete test expectations against existing account-bound OAuth and
  Usage source contracts; no auth, policy, or API behavior changed. Protocol and Client generated checks and
  typechecks exited **0**. The generated OpenAPI artifact matches **125** source operations, including **6** MCP
  management operations, with no retired catalog endpoint. The isolated docs build passed **162 pages**, and docs
  typecheck plus internal/anchor/asset link validation exited **0**. Cleanup logs are
  `/tmp/opencode/final-published/{protocol-cleanup.log,docs-cleanup.log,docs-links-cleanup.log}`.
  Core guidance checks passed **25 tests / 5 files**; Core and Web/fixture typechecks exited **0**. A separate
  supplemental legacy mock-gateway smoke attempt found stale account-menu and policy-heading expectations and was
  terminated at the command timeout; it is not the passing real Application browser suite. These overlapping
  results are not additive, and none broadens the independent security or Docker artifact-export signoffs above.
  The supplemental command, run from `packages/web`, was
  `PLAYWRIGHT_PORT=4287 bun run test:e2e -- e2e/smoke/home.spec.ts e2e/smoke/policies.spec.ts e2e/smoke/session-active.spec.ts --workers=1`.
  Its 120-second command limit terminated the attempt before a complete suite result; the recorded failures were
  the missing **Open account menu** button and **Safe Tools** policy heading. Evidence is
  `/tmp/opencode/final-published/mock-gateway-cleanup.log`. Those legacy UI expectations remain unchanged.

The exact published Code Mode dependency and two Effect compatibility patches are recorded in
[dependency provenance](../../references/codemode.md), matching the source pin above. The approved dependency
switch removes the local interpreter workspace without changing required safety, interfaces, or verification scope.
The audit confirmed that the beta artifact already contains the required Namespace API.

## Authority and replay semantics

- Tool is a registered callable operation, with no mandatory source aggregate and no replacement domain for the removed glossary concept. There is no speculative source database migration: no such implementation was found in inspected package source.
- One Tool registry belongs to each **existing member-bound runtime graph**, shared by Session and inbound gateway. Nothing becomes process-global; authenticated MCP clients and credentials are never pooled across members. No second gateway/fallback registry, `registerBoth`, or add-only compatibility facade survives migration.
- Port upstream replayable `State` editors: list/get/namespace/add/update/remove, transform and reload. Replay transforms in registration order against a fresh editor. Preserve upstream name normalization/validation, namespace descriptions, last-valid-wins and invalid-registration log/skip. Invalid changes retain prior valid values; normalized duplicate names follow upstream precedence, not suppression, batch rejection, or whole-catalog rollback. Update cannot rename a Tool or move its namespace.
- Reload does not change registration precedence. Scoped, idempotent disposal removes a transform and reveals earlier active definitions. PluginHost supplies activation identity/provenance and delegates registration/reload; it has no MCP/OpenAPI protocol logic. Recompute each registration's admitted contribution inventory on replay and remove disposed contributions. Inventory is diagnostic, not a catalog/executor store. Overrides carry the modifying registration's provenance.
- Retain gateway builtin exclusion solely as a trusted provenance prefilter of **winning registrations**, inside the same snapshot preparation algorithm. A builtin winner hides an earlier externally published definition: never walk history for a fallback. Custom-plugin/MCP winners are eligible subject to permissions. Publication is host-owned, not a plugin-supplied authorization flag; losing contributions may remain in inventory but are never executable gateway fallbacks.
- Tool.snapshot performs upstream preparation: whole-tool permission filtering, direct/CodeMode partition, namespace/pinning catalog generation and captured execution. Both callers consume definitions/codeModeCatalog/execute from that one algorithm. `codemode: false` is direct in both Session and gateway; all other Tools are behind `execute` in both. There is no gateway-specific CodeMode wrapping, raw public registration map, separate preparation path, or Binding service. Session retains upstream context hooks and the surviving-name map. No execution re-looks up a Tool in the live registry.
- Private shared runtime owns input/output validation, host/sandbox dispatch, normalization and typed-error settlement. Keep upstream hooks and gateway instrumentation in caller adapters. Leaf `permission(...)` remains mandatory: Session can ask; gateway rejects ask and deny. Session-only leaves narrow caller context and reject gateway invocation. Preserve sandbox/project execution; gateway sandbox calls use a genuine invocation identifier, never a forged Session ID.

## Placement and compatibility adaptations

```text
packages/core/src/tool.ts          public Tool interface and composition
packages/core/src/tool/runtime.ts  private shared runtime
packages/core/src/tool/mcp.ts      private McpTool adapter
packages/core/src/tool/openapi.ts  NEW private BM adapter, not an upstream port
packages/core/src/mcp.ts           public Mcp interface/service/Layer
packages/core/src/mcp/index.ts     private MCP implementation
```

Retain these private upstream filenames, but use BM's mandatory top-level-domain seam. All other domains import only `tool.ts` or `mcp.ts`; Tool's top-level composition privately installs McpTool. `mcp.ts` delegates to private `mcp/index.ts`; private implementation may use type-only entrypoint references to avoid initialization cycles. This is a minimal file-boundary adaptation, not permission for cross-domain deep imports.

Other intentional adaptations are BM sandbox registration admission, host-owned provenance/publication, the non-Session-specific Snapshot/discriminated caller, member-only remote MCP authentication, and new OpenAPI plugin glue. Do not port upstream global credential selection, local MCP transports, prompts or resources. Existing plugin hooks retain their signatures.

## Approved public interfaces

Existing branded IDs, `Tool.ValueSchema`, `Tool.Result`, `Tool.Content`, `Tool.Metadata`, `Tool.Error`, sandbox `Tool.Implementation`, `Plugin.Source`, `State.Registration`, `ConfigMCP.Remote`, and upstream hook payloads retain their types unless explicitly changed here. The removed settings diagnostic and BM Session policy/admission payloads are not retained. Preserve schema-derived input/output inference at the schema Tool boundary; heterogeneous storage uses upstream's erased Info.

### Tool (Core and schema boundary)

```ts
type Caller =
  | { readonly type: "session"; readonly sessionID: Session.ID;
      readonly messageID: Message.ID; readonly agent: Agent.ID;
      readonly projectID: Project.ID }
  | { readonly type: "gateway"; readonly userID: User.ID;
      readonly projectID?: Project.ID }

interface Context {
  readonly caller: Caller
  readonly id: Tool.CallID
  readonly progress: (value: Tool.Metadata) => Effect.Effect<void>
  readonly permission: (request: Tool.PermissionRequest) => Effect.Effect<void, Tool.Error>
}
interface Namespace { readonly name: string; readonly description?: string }
interface Info {
  readonly name: string
  readonly description: string
  readonly input: Tool.ValueSchema
  readonly output?: Tool.ValueSchema
  readonly options?: Tool.Options
  readonly execute: (input: any, context: Context) => Effect.Effect<Tool.Result, Tool.Error>
}
type Registration = Info | {
  readonly name: string; readonly description: string
  readonly input: Tool.ValueSchema; readonly output?: Tool.ValueSchema
  readonly options?: Tool.Options
  readonly execution: "sandbox"; readonly implementation: Tool.Implementation
}
interface Editor {
  readonly list: () => readonly (Info & { readonly id: string })[]
  readonly get: (id: string) => (Info & { readonly id: string }) | undefined
  readonly namespace: (value: Namespace) => void
  readonly add: (value: Registration) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Info>) => void) => void
  readonly remove: (id: string) => void
}
interface Interface extends State.Transformable<Editor> {
  readonly snapshot: (
    permissions?: Permission.Ruleset,
    caller?: Caller["type"],
  ) => Effect.Effect<Snapshot>
}
interface NormalizedResult extends Tool.Result {
  readonly content: ReadonlyArray<Tool.Content>
}
interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly call: ToolCall
    readonly context: Context
    /** Surviving advertised names mapped to definitions retaining canonical names. */
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<NormalizedResult, Tool.Error>
}
```

`PermissionRequest` retains action/resources/save?/metadata?. Options are unchanged; provenance/publication is not an Options field. Sandbox Registration is BM admission only; store executable Info, not sandbox variants. Remove the legacy host discriminator and `LegacyHostRegistration`.

Snapshot now matches upstream's prepared output: definitions, optional CodeMode catalog, and paired execution. Options, namespace maps and executor maps remain closure-private; namespace descriptions and pinning appear only in the prepared CodeMode catalog. No `namespaces` or `exposed` field survives on Snapshot. Unknown names fail with `Tool.Error`. Keep upstream repaired-name resolution and surviving-definition removal/alias handling; derive each model request and its executable from the same capture.

The optional second `snapshot` argument is the minimal trusted-provenance compatibility adjustment: default `"session"`, `"gateway"` applies builtin exclusion before the same permission/partition algorithm. It is supplied by Core callers, never model arguments or plugin options. The captured audience must match invocation `context.caller.type`; reject mismatch. It is not execution authorization and does not provide a second registry or snapshot path. Session/gateway credentials still belong to the member-bound graph.

### Exact upstream comparison

At the pinned revision, `core/src/tool.ts:41–62` declares `snapshot(permissions?: Permission.Ruleset)` and the same Snapshot output fields. Its execute input is `{ sessionID, agent, messageID, call, progress?, definitions? }`. BM replaces only those Session-only invocation fields with the already approved `context: Context`, preserving `call` and `definitions`; `context.id` is the canonical `Tool.CallID` made from `call.id` and must agree with it. BM's provenance-only audience argument above is additional. Port upstream `NormalizedResult` and `CodeModeCatalog.Inventory` rather than inventing new catalog metadata.

Upstream `tool.ts:220–278` filters `options.permission ?? effectiveName` with the last matching action rule, omitting whole-tool `resource: "*"` deny; then partitions on `codemode === false` and separately filters `execute`. Ask and resource-specific permission checks remain leaf responsibilities. Gateway must reject both ask and deny for the actual resources, including the outer `execute` call, without requiring or manufacturing a Session. Direct Tools are not hidden merely because `execute` is denied. `codemode/tool.ts` captures Info objects in its runtime, renders namespace descriptions, and carries pinning into catalog instructions. `plugin/host.ts:422–425` simply delegates transform/reload/hook; do not introduce a generalized host binding framework.

Declared-output mismatches fail with `Tool.Error`; machine output without a declared schema follows upstream's programmer-defect contract. Foreign typed failures normalize to `Tool.Error`; defects/interruption survive. `RegistrationError { name, message }` is a logged diagnostic, not a transform failure. `transform(callback)` returns `Effect<State.Registration, never, Scope>` and `reload()` returns `Effect<void>`, exactly `State.Transformable`.

Core composition binds provenance through a private scoped host binding, not a public source parameter. Sandbox project-file admission uses that binding's Project ID. Remove `Tool.define` after migrating callers to complete executable objects; do not hide request services behind its cast. Move `normalizeName/effectiveName/modelDefinition/decodeInput` behind the private runtime after migrating callers.

### Mcp

```ts
interface Editor {
  readonly list: () => readonly [string, Types.DeepMutable<ConfigMCP.Remote>][]
  readonly get: (server: string) => Types.DeepMutable<ConfigMCP.Remote> | undefined
  readonly set: (server: string, config: ConfigMCP.Remote) => void
  readonly update: (server: string, update: (config: Types.DeepMutable<ConfigMCP.Remote>) => void) => void
  readonly remove: (server: string) => void
}
interface RemoteTool {
  readonly server: string; readonly name: string; readonly description?: string
  readonly inputSchema?: unknown; readonly outputSchema?: unknown; readonly codemode?: boolean
}
interface ToolResult {
  readonly isError?: boolean; readonly structured?: unknown
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly mimeType: string; readonly data: string }
  >
}
interface Interface extends State.Transformable<Editor> {
  readonly servers: () => Effect.Effect<ReadonlyArray<Server>>
  readonly connect: (server: string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (server: string) => Effect.Effect<void, NotFoundError>
  readonly test: (server: string) => Effect.Effect<void, NotFoundError | RequestError | NeedsAuthError>
  readonly tools: () => Effect.Effect<ReadonlyArray<RemoteTool>>
  readonly callTool: (input: {
    readonly server: string; readonly name: string
    readonly args?: Record<string, unknown>; readonly sessionID?: Session.ID
  }) => Effect.Effect<ToolResult, NotFoundError | ToolCallError>
  readonly instructions: () => Effect.Effect<ReadonlyArray<{
    readonly server: string; readonly instructions: string; readonly codemode: boolean
  }>>
}
```

`Server` retains current outbound name/url?/status/integrationID? and statuses. Preserve `NotFoundError { server }`, `ToolCallError { server, message }`, and current RequestError/NeedsAuthError payloads with migrated MCP tags. Re-export private client errors through `mcp.ts`. Instructions do not own registered Tool names: Session guidance joins the captured effective catalog. Scoped editor set/remove configures servers; connect/disconnect retains operational overrides, not new operational add/remove APIs.

Mcp owns remote configuration, connection scopes, authentication, discovery, status and calls. Its Layer acquires Integration, member-bound Credential, OAuth callback capability and Bus **directly**; OAuth helpers accept those dependencies, never PluginContext. Preserve member-only policy and `mcp-<sha256(name + NUL + url)>` OAuth identities. Configuration is a scoped MCP transform, not a priority-based source mechanism.

Private `McpTool.Interface = { readonly flush: Effect.Effect<void> }` is not a supported public service. It acquires Mcp, Tool and Bus, installs one stable discovery transform, publishes tool-list changes, debounces subsequent refresh by 100ms, and refreshes schemas/descriptions/outputs even when names are unchanged. Tool composition awaits initial flush; do not advertise a silently partial catalog. Expected per-server failures appear in status rather than hanging readiness. Scope closure cancels refresh and disposes the transform. Leaf authorization uses actual caller context; calls resolve through Mcp, not a captured retired connection. Snapshots freeze definitions, not availability or credentials.

### OpenAPI registration — new BM glue

There is no upstream Core OpenAPI plugin adapter to transplant. Reuse the existing converter; replace duplicated ownership in `packages/plugin/src/effect/openapi.ts` and Gmail converter/registration glue in `plugins/google/src/gmail.ts`. Private `tool/openapi.ts` is Tool-owned glue, not a new Core service/tag. Both `@bymorning/plugin` and `@bymorning/plugin/effect` export the same `OpenAPI` namespace; distinguish the converter import as `CodeModeOpenAPI`.

```ts
import type { OpenAPI as CodeModeOpenAPI } from "@opencode-ai/codemode"

export declare namespace OpenAPI {
  export type Authentication =
    | { readonly type: "none" }
    | { readonly type: "integration"; readonly integrationID: string;
        readonly schemes: Readonly<Record<string,
          | { readonly type: "bearer" }
          | { readonly type: "apiKey" }
          | { readonly type: "basic"; readonly username: string }
        >> }
  export interface Options {
    readonly namespace: string
    readonly permissionPrefix: string
    readonly spec: CodeModeOpenAPI.Document
    readonly baseURL?: string
    readonly expectedOrigin: string
    readonly authentication: Authentication
  }
  export interface Summary {
    readonly operationNames: ReadonlyArray<string>
    readonly skipped: ReadonlyArray<CodeModeOpenAPI.Skipped>
  }
  export interface Error {
    readonly _tag: "Error"
    readonly message: string
  }
}
interface EffectTool {
  readonly transform: State.Transform<Editor>
  readonly reload: () => Effect.Effect<void>
  readonly openapi: (options: OpenAPI.Options) => Effect.Effect<
    OpenAPI.Summary & State.Registration, OpenAPI.Error, Scope.Scope>
  readonly hook: ExistingEffectToolHook
}
interface PromiseTool {
  readonly transform: (callback: (editor: PromiseEditor) => void) => Promise<{ dispose(): Promise<void> }>
  readonly reload: () => Promise<void>
  readonly openapi: (options: OpenAPI.Options) => Promise<OpenAPI.Summary & { dispose(): Promise<void> }>
  readonly hook: ExistingPromiseToolHook
}
```

Existing hooks are unchanged (`packages/plugin/src/effect/tool.ts` and Promise counterpart). PromiseEditor has the same synchronous editor operations, adapting Info.execute to existing Promise executors and preserving schema inference. Promise Context mirrors discriminated caller with Promise permission/progress. Promise and Effect registration have equivalent activation scope and disposal behavior.

`context.tool.openapi(options)` accepts an **existing Integration reference** and explicit scheme mappings; it never creates Integration, Credential or OAuth methods. Resolve the current member's Connection at invocation, not setup. Keep HTTP host-owned inside this adapter, not on PluginContext. Preserve expected-origin enforcement, redirect rejection, 30-second timeout and sanitized errors from the existing helper.

`OpenAPI.Error { message }`, tag `"Error"`, is a secret-free setup error for invalid origin/base URL/options. Unsupported operations are `skipped`; unsupported/missing auth fails closed, and absent invocation credentials yield sanitized `Tool.Error`. `basic.username` names an existing credential-configuration field, not a plaintext username. Bearer accepts current key or OAuth access material (including Gmail); apiKey/basic require key credentials. No identity fallback or automatic auth-method creation. Preserve existing API/Gmail operation names with explicit migration tests; never silently truncate new collisions away. Remove standalone Effect `OpenAPI.register({ context, ... })` after caller migration: `tool.openapi` is the single convenient registration surface.

### Session and gateway

`SessionTools.resolve` and its definitions/execution/context-hook coordination remain caller-facing; internally consume the exact prepared Snapshot with session permissions and `caller = "session"`. Do not rebuild direct/CodeMode projections or add BM selected-model/tool/combine policy and nested-call admission coordination. Preserve repaired-name resolution and upstream hook behavior.

Remove the former gateway-only `Executable { definition, run(code) }` (and current fake host Tool variant). Gateway supplies a prepared Tool Snapshot from the same registry, with gateway permissions and the trusted gateway audience. Its minimal execution surface becomes:

```ts
interface Interface {
  readonly snapshot: Effect.Effect<Tool.Snapshot>
}
```

Member-bound gateway composition creates real gateway invocation context, selects the current first Project as before, omits projectID when none exists, and uses a real invocation CallID. No fake Session/message/agent IDs. The server advertises every prepared `snapshot.definitions` entry and dispatches every admitted direct or `execute` call through that same snapshot's execute capability. It does not special-case CodeMode input validation: private Tool runtime validates the captured definition. Session-dependent leaves return a clear `Tool.Error`. Caller selection is trusted runtime data, never model arguments.

**Intentional breaking MCP wire behavior:** direct Tools previously reachable only via `tools.<path>` inside gateway `execute` are now individually listed/called by their effective names and absent from its CodeMode catalog. CodeMode Tools remain behind `execute`. Do not inject direct Tools back into gateway CodeMode, and do not concatenate a gateway-only catalog onto `execute`'s invariant description. CodeMode discovery uses the upstream catalog/search behavior. Permissions may produce different eligible sets across callers; the presentation algorithm is identical.

### Server evidence and resolved compatibility choices

`packages/server/src/handlers/mcp.ts` now lists prepared snapshot definitions using SDK `ListToolsRequestSchema`
and dispatches named direct or `execute` calls using `CallToolRequestSchema`. The former hardcoded `execute`
listing/decoding/dispatch is removed. Preserve the member-bound `WorkspaceMap` graph selected by resolved OAuth
authority and verify its runtime isolation: capture one prepared snapshot per request scope, not a new long-lived
registry. The member graph's fresh memoization boundary and its isolation regression are recorded above;
dispatch alone is not the isolation mechanism.

The result serializer now consumes normalized Tool content, optional object structuredContent, and typed error
settlement. Preserve text/files with supported MCP conversion; never treat an arbitrary direct result's `output`
property as the CodeMode envelope. This remains transport conversion, not gateway-specific execution wrapping,
and its full wire/media regression gates remain required.

The two former BM extras are intentionally removed. The settings endpoint no longer exposes Tool path/action/signature/effect/availability diagnostics or denied entries; remove that projection from the protocol, server, client, and web settings surface. Session no longer adds selected-model/tool/combine policy filtering or nested-call admission/exactly-once coordination. Use the exact upstream prepared Snapshot for both callers, retaining ordinary `Permission` checks, upstream Tool hooks, member isolation, and shared direct/CodeMode presentation. Do not add raw metadata, a second projection, a Binding callback, or a private adapter to restore either feature.

Foundation files: `packages/schema/src/tool.ts`, Core `tool.ts`/`tool/runtime.ts`, `codemode/tool.ts`/`catalog.ts`,
plugin Tool surfaces and Promise adaptation. Consumers include `session/tools.ts`, `mcp-gateway.ts`, Server's MCP
handler, their tests, and the application Tool scenario. The duplicate gateway registry and obsolete settings
diagnostic projection have been removed from source; remaining compatibility and verification gates are not waived.
This documentation update itself makes no runtime edits and does not claim a full migration test pass.

## Dependencies, composition and deletion test

Tool earns its seam by centralizing replay, identity, validation, captured execution and output settlement. Mcp earns its seam through remote lifecycle/auth/protocol semantics. McpTool/OpenAPI translate producers into Tool registrations and do not earn new domains. The duplicate gateway registry is removed; preserve Gateway publication/external policy and upstream Session request/execution hooks. Shared dispatch is private runtime plus sandbox helpers, not another public execution service.

```text
CALLS
Plugin setup → tool.transform / tool.openapi → Tool
Config/plugin MCP edits → Mcp.transform → remote discovery
Mcp ToolsChanged → McpTool → Tool.reload
Session → Tool.snapshot(permissions, "session") → context hooks → snapshot.execute
Gateway → Tool.snapshot(permissions, "gateway") → MCP definition listing / snapshot.execute
Tool.snapshot → winner provenance prefilter → permission filter → shared direct/CodeMode preparation
snapshot.execute → private runtime → leaf or sandbox → external capability

DEPENDENCIES / LAYERS (one existing member graph)
Credential(member) ─┬→ Integration
                   └→ Mcp ← Integration, OAuth callback, Bus, remote client
Tool ← private runtime construction dependencies
McpTool ← Mcp, Tool, Bus
Tool OpenAPI admission ← Integration, confined HTTP client
PluginHost ← Tool, Mcp, Integration, activation provenance binding
SessionTools ← Tool, existing hooks/session services
MCPGateway ← Tool, existing config/projects/member/hooks services
```

Retain the execution capabilities needed by each producer: CodeInterpreter, ProjectDirectory/Storage, Agent, Reference, Skill, WebSearch, Form, Database, Bus, Crypto. Resolve invocation-specific ProjectDirectory/SessionInstructions only for the appropriate caller; keep typed producer service capture local. Do not add Tool → Mcp → Tool cycles. Bind Integration/HTTP only in the OpenAPI producer adapter. Tool top-level composition installs its registry before producer transforms, privately starts McpTool once using public `Mcp.Service`, and awaits initial readiness before catalog admission. Never build another Tool registry in a gateway/fallback Layer.

## Migration sequence and verification gates

The sequence below is the approved migration plan, not a completed checklist. The checkpoint above records current
blockers; implementation exists for several steps, but acceptance requires their regression gates.

1. Record glossary removal, approved seam adaptation and source pin (recorded in the original approval checkpoint). Inventory affected exports/callers before breaking changes.
2. Port Tool editor/runtime and schema/Promise/Effect surfaces. Normalize sandbox admission, migrate builtins and remove legacy callbacks. Test precedence/output/disposal before consumers.
3. Move outbound MCP implementation to `mcp/index.ts` and private client/OAuth modules behind `mcp.ts`; compose stable `tool/mcp.ts`, readiness/events from Tool. Replace host/context plumbing while retaining remote-only member auth.
4. Migrate Session/gateway to the exact same prepared snapshot/caller contract and shared private runtime; migrate MCP listing/calling to direct plus CodeMode presentation. Remove the obsolete settings diagnostic projection and Session selected-model/tool/combine policy and nested-call admission code. Delete `mcp-gateway-tools.ts`, `registerBoth`, fallback registries, dual-registry nodes/tests and, after callers migrate, `tool-execution.ts`.
5. Add OpenAPI glue and both plugin surfaces; migrate existing helper and Gmail; remove duplicated flatten/dispatch and Integration creation from registration.
6. Migrate outbound imports/protocol handlers/events/composition before deleting the obsolete entrypoint. Update implemented architecture/docs, run verification and regenerate SDK if supported protocol contracts change.

Focused Core regressions: `tool`, `plugin-scoped`, `plugin-host`, `plugin-activation`, `plugin-supervisor`, `outbound-mcp` (rename with seam), `mcp-gateway`, `tool-execution` (move behind public tests), `google-gmail-plugin`. Replace `mcp-gateway-tools` tests with single-registry projection/override assertions. Cover replay/update/remove/namespace/disposal, invalid log-skip, normalized collisions, schema-only MCP refresh, late override precedence, snapshots across refresh/disconnect, output/media normalization, ask/deny and builtin exclusion, sandbox Project admission, OAuth IDs and two-member isolation. Add wire regressions for direct listing/calling, direct exclusion from CodeMode, namespace/pinning parity, deny-execute leaving direct Tools callable, caller-audience mismatch, and captured definitions/executors after override. Remove settings diagnostic and Session policy/admission assertions. Existing gateway-only `execute` expectations are intentionally obsolete.

Migrate `packages/plugin/src/effect/openapi.test.ts`; cover both Promise/Effect surfaces through activation, scoped disposal, current-Connection resolution, expected-origin, redirects, timeouts, sanitized failures, unsupported operations and Gmail output mapping. Assert registration creates no Integration.

Application verification follows `app/testing/README.md`: real `TestApp.make`, generated SDK, persisted setup and
public services. Tool scenarios and local fixtures now exist under `app/test/tool.test.ts`,
`app/testing/scenario/tool.ts`, and `app/testing/{identity,mcp,http,tool-plugin}.ts`; their existence is not proof
that plugin/MCP/Gmail and second-member coverage passes. Complete reusable scenarios through supported boundaries
and browser plugin setup **before activation**. Script actual next Tool results and background title requests in
TestLLM. Pass Vitest signal to Effect.runPromise; teardown verifies expectations and closes resources. No sleeps,
state-changing retries, replacement SDK, or fabricated API/event responses.

Run from owning packages (commands are planned gates, not results):

```sh
# packages/core; include other affected tests above at actual repository paths
bun run test -- test/tool.test.ts test/plugin-host.test.ts
bun run test:integration
bun typecheck
# packages/plugin; update test path after migration
bunx vitest run src/effect/openapi.test.ts
bun typecheck
# app; current Tool scenarios; tool-auth is the recorded member-isolation regression
bun run test -- test/tool.test.ts test/tool-auth.test.ts
bun typecheck
# packages/web
bun run test:application
bun run typecheck:application
```

Also typecheck schema, plugin-google and server when changed, following package generation conventions for SDK
updates. Finish with `git diff --check`. Implementation, the published dependency switch, security gates, and final
Server-with-Docker/Core integration/Application suites are complete as recorded above. The final full Application
browser suite and documentation/protocol checks also pass on their own retained evidence; the separate supplemental
legacy smoke attempt is qualified above. Do not infer broader coverage or sum overlapping runs.
