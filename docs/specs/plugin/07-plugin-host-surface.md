# 07 — Shrink the public host adaptation knowledge surface

> **Speculative.** This spec argues itself into a narrow verdict: most of the proposed split is code-moving, and the honest recommendation is *don't do it unless host.ts stays a hotspot*. The counterpoint is stated first, and the Verdict section quantifies it.

> **Tool/Mcp reconciliation:** the historical measurements and Integration extraction sketches below are not current
> source contracts. [Tool registration](../tool-registration.md) supersedes the former dual-registry Tool adapter.
> No host split, new public adapter interface, or full migration pass is claimed here; verified gates are listed separately.

## Implemented Tool and Mcp relationships

**Member registry isolation verified:** `WorkspaceMap.node` now applies `Layer.fresh` around the complete compiled
member graph after hoisting globals, preventing static Tool Layers from sharing captured member services through
`LayerMap`'s memo map. The workspace-map regression and real `app/test/tool-auth.test.ts` (1/1 passed; app typecheck
exit 0) cover the recorded ownership/auth path. Builtin caller resource binding and the MCP same-provider race now
have independent regression verification. OpenAPI production-host safety is also independently verified (55 focused
tests, including 13 host cases). Final published-artifact suites passed: Core integration 200 tests/17 files, Server
with Docker 121/24, and Application 45/12, all with 0 skips and exit 0. The 5 real Application Docker scenarios add
no binary/media export from `run`. The full Application browser suite passed 8 tests/0 skips; Protocol passed 60 tests.
Generated contract checks and typechecks pass; the isolated docs build passed 162 pages and link validation passed.
These complete the recorded checks without expanding independent security/export scope. See the canonical
[verification checkpoint](../tool-registration.md#implementation-checkpoint--verification-gates).

`PluginHost.HostServices` captures one `Tool.Interface` and public `Mcp.Interface` from the existing member graph.
`context.tool.transform` delegates to that registry with host-owned activation provenance and replay-refreshed
contribution inventory; `reload` delegates to Tool, and hooks retain their existing signatures. Session and inbound
MCP consume the same prepared direct/CodeMode snapshot algorithm. Gateway publication excludes builtin winners
inside preparation, not by routing registrations to another store or recovering losing definitions.

The editor supports `list`, `get`, `namespace`, `add`, `update`, and `remove`. Ordered replay uses last-valid-wins
and invalid-registration log/skip; scoped disposal reveals earlier definitions. Inventory tracks admitted
contributions, not an executor catalog or authorization decision.

`context.tool.openapi` on Promise and Effect surfaces delegates to private `tool/openapi.ts` with the existing
Integration and host HTTP dependency. It resolves current Connections at invocation and does not create Integration,
Credential, or OAuth methods. Public PluginContext has no HTTP capability. The converter comes from the exactly
pinned published Code Mode package; [provenance](../../../references/codemode.md) records its upstream revision
and compatibility adaptations.

Mcp owns configuration, remote lifecycle, authentication, discovery, and calls, acquiring Integration, member-bound
Credential, OAuth callback, and Bus directly. PluginHost delegates MCP edits, not protocol or OAuth logic. Private
Tool discovery consumes public `Mcp.Service`, is installed once against the member's Tool registry, and is awaited
by workspace boot. Builtin caller binding in plugin-private `plugin/internal/tool/binding.ts` now captures typed
registration-time dependencies and validates the real member-filtered Session/Project pair. Its caller-A /
ambient-directory-B reproduction and mismatch rejection were independently verified. It is not a public Binding
capability or proof that the full Application execution profile passes.

## Summary

`PluginHost.make` (`packages/core/src/plugin/host.ts`, 514 lines) projects 22 captured Workspace inputs into the 18-domain public plugin Context. The conservative deepening proposed here: the two domains with real adaptation depth (Integration, Tool) own a `plugin.ts` Adapter next to their Core module — the pattern `PluginStorage.make` already established — while `make` becomes an assembler that only owns cross-cutting placement (Workspace/Project location), provenance (`admitPolicy`), and hook-registration wiring.

## Historical shape (before Tool migration)

**The counterpoint, stated first.** `PluginHost` is already a good Module by this vocabulary's own tests:

- **Deletion test: passes.** Delete it and every plugin loses all 18 capabilities at once; nothing reappears across callers because there is exactly one caller (`plugin.ts:79`).
- **Locality: strong.** Every public capability projection is in one readable function; a plugin-surface change touches one file.
- **The Seam is real, twice over.** Core→Effect host Adapter (`make`) and Effect→Promise Adapter (`fromPromise`, exercised at `plugin-host.test.ts:549-556,581-590`). One Adapter per Seam would be hypothetical; there are two.
- **The risk of splitting:** 14 of the 18 domains are one-to-five-line delegations (`host.ts:97-147,276-354,363-368`). An Adapter file per domain is a pass-through that fails the deletion test — the same complexity, spread across 18 files.

What actually strains the current shape:

- The historical `HostServices` flattened domain-specific inputs alongside shared host capabilities. The current Tool migration removed the second-registry input; these counts must be remeasured before proposing a split.
- Integration alone occupies `host.ts:148-275` plus `OAuthAuthorizationDetails` (`418-423`), `methodImplementation` (`425-502`), and `methodSelector` (`504-514`) — roughly 230 lines of schema decoding, credential redaction (`234-242`), and host-owned method gating (`263-269`) that every reader of the assembler must wade through.
- Tool's former dual-registration adaptation has been superseded by the single-registry delegation described above.
- The 22-field shape is re-stubbed by **four** hand-rolled test builders — `test/plugin-host.test.ts:1430-1458`, `test/policy-tool.test.ts:640-664`, `test/integration/integration.test.ts:1106-1128`, `test/plugin-internal.test.ts:586` — plus two `deepProxy` casts (`test/plugin-supervisor.test.ts:1069`, `test/plugin-scoped.test.ts:153`). Every one stubs 17+ fields with `{}` casts to reach the one domain it tests.
- `plugin-host.test.ts` is 1,458 lines / 34 cases (29 declared; the Tool-source loop expands to six); integration slices (`165-447`, `449-521`, `805-881`, `1098-1285`) dominate it.

The public Interface being projected is `packages/plugin/src/effect/plugin.ts:24-46` (18 domains + `app`/`location`/`options`/`plugin`). Production activation is a single call site: `plugin.ts:79`.

## Proposed interface

Two new internal Adapter files, following the `PluginStorage.make` precedent (`plugin-storage.ts:9-12` — a per-domain Adapter already living next to its Storage module). **Internal to `packages/core`; the public `PluginContext` shape is unchanged.**

```ts
// packages/core/src/plugin/host.ts (assembler)
export * as PluginHost from "./host.js"

/** Host-owned provenance and placement, stamped once per plugin activation. */
export interface Scope {
  readonly pluginID: string
  readonly workspaceID: Workspace.ID
  readonly projectID?: Project.ID
  readonly source?: Plugin.Source
}

/** Exact Workspace identities captured by one public plugin capability host. */
export interface HostServices {
  readonly workspaceID: Workspace.ID
  readonly app: App
  readonly bus: Bus.Interface
  readonly plugin: PluginRegistry
  readonly runtime: PluginRuntime.Interface
  readonly shellHooks: PluginHooks.Interface
  readonly storage: Storage.Interface
  /** Inputs consumed only by the Integration plugin domain. */
  readonly integration: {
    readonly integration: Integration.Interface
    readonly oauthCallback?: IntegrationOAuthCallback.Interface
    readonly accountID?: Account.ID
  }
   /** Current Tool dependency; the proposed nested dual-registry group is removed. */
   readonly tool: Tool.Interface
  // Unchanged one-projection domains — the assembler keeps these; adapters for them would be pass-throughs.
  readonly agent: Agent.Interface
  readonly aisdk: AISDK.Interface
  readonly catalog: Catalog.Interface
  readonly command: Command.Interface
  readonly instruction: InstructionDiscovery.Interface
   readonly mcp: Mcp.Interface
  readonly policy: Policy.Interface
  readonly reference: ReferenceInterface
  readonly skill: Skill.Interface
  readonly websearch: WebSearch.Interface
}

/** Adapt one permanently-bound Workspace graph into the public Plugin Context. */
export function make(
  services: HostServices,
  pluginID: string = "test",
  options: PluginOptions = {},
  source?: Plugin.Source,
): PluginContext
```

`make`'s signature is unchanged, so `plugin.ts:79` keeps compiling untouched.

```ts
// packages/core/src/integration/plugin.ts
export * as IntegrationPlugin from "./plugin.js"

import type { IntegrationDomain, IntegrationMethod, IntegrationMethodRegistration } from "@bymorning/plugin/effect/integration"
import type { Account } from "@bymorning/schema/account"
import { Credential } from "@bymorning/schema/credential"
import { AttemptID, ID, MethodID } from "@bymorning/schema/integration"
import type { Plugin } from "@bymorning/schema/plugin"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Option, Schema, Types } from "effect"
import { Integration } from "../integration.js"
import { IntegrationOAuthCallback } from "../integration-oauth-callback.js"
import { Form } from "../form.js"
import {
  AwsSigV4MethodDefinition,
  CommandMethodDefinition,
  EnvGroupMethodDefinition,
  EnvMethodDefinition,
  KeyMethodDefinition,
  type Implementation,
  type MethodSelector,
  OAuthMethodDefinition,
} from "../definition.js"

export interface Input {
  readonly integration: Integration.Interface
  readonly integrationOAuthCallback?: IntegrationOAuthCallback.Interface
  readonly accountID?: Account.ID
  readonly workspaceID: Workspace.ID
  readonly pluginID: string
  readonly source?: Plugin.Source
}

/**
 * Adapt one Workspace-bound Integration authority into the public plugin Integration domain.
 * Owns identifier branding, host-owned method gating, OAuth shape decoding, and the
 * display-only projection of regional connections (AWS credential material stays host-owned).
 */
export const domain = (input: Input): IntegrationDomain => {
  const mutable = <A>(value: A) => value as Types.DeepMutable<A>
  const allowHostOwned = input.pluginID === "core.provider" && (input.source === undefined || input.source.type === "builtin")
  return {
    list: () => input.integration.list(),
    get: (id) => input.integration.get(ID.make(id.integrationID)),
    connect: {
      key: (connect) => {
        if (connect.answer !== undefined && connect.configuration !== undefined) {
          return Effect.die(new Error("Specify either answer or configuration"))
        }
        return input.integration.connection.key({
          integrationID: ID.make(connect.integrationID),
          key: connect.key,
          label: connect.label,
          answer: connect.configuration === undefined ? connect.answer : { region: connect.configuration.region },
        })
      },
      awsSigV4: (connect) => {
        if (connect.methodID !== undefined && connect.methodID !== Integration.BedrockAwsSigV4MethodID) {
          return Effect.die(new Error("AWS SigV4 method not found"))
        }
        return input.integration.connection.awsSigV4({
          integrationID: ID.make(connect.integrationID),
          accessKeyId: connect.accessKeyId,
          secretAccessKey: connect.secretAccessKey,
          sessionToken: connect.sessionToken,
          region: connect.region,
          label: connect.label,
        })
      },
    },
    oauth: {
      callback: {
        register: () => {
          if (!input.accountID || !input.integrationOAuthCallback) {
            return Effect.die(new Error("Integration OAuth callbacks are unavailable"))
          }
          return input.integrationOAuthCallback.register({
            accountID: input.accountID,
            workspaceID: input.workspaceID,
            pluginID: input.pluginID,
          })
        },
      },
      connect: (connect) =>
        input.integration.oauth.connect({
          integrationID: Schema.decodeUnknownSync(ID)(connect.integrationID),
          methodID: Schema.decodeUnknownSync(MethodID)(connect.methodID),
          answer: connect.answer,
          label: connect.label,
        }),
      status: (status) =>
        input.integration.oauth.status({
          integrationID: Schema.decodeUnknownSync(ID)(status.integrationID),
          attemptID: Schema.decodeUnknownSync(AttemptID)(status.attemptID),
        }),
      complete: (complete) =>
        input.integration.oauth.complete({
          integrationID: Schema.decodeUnknownSync(ID)(complete.integrationID),
          attemptID: Schema.decodeUnknownSync(AttemptID)(complete.attemptID),
          code: complete.code,
        }),
      cancel: (cancel) =>
        input.integration.oauth.cancel({
          integrationID: Schema.decodeUnknownSync(ID)(cancel.integrationID),
          attemptID: Schema.decodeUnknownSync(AttemptID)(cancel.attemptID),
        }),
    },
    command: {
      connect: (connect) =>
        input.integration.command.connect({
          integrationID: Schema.decodeUnknownSync(ID)(connect.integrationID),
          methodID: Schema.decodeUnknownSync(MethodID)(connect.methodID),
          label: connect.label,
        }),
      status: (status) =>
        input.integration.command.status({
          integrationID: Schema.decodeUnknownSync(ID)(status.integrationID),
          attemptID: Schema.decodeUnknownSync(AttemptID)(status.attemptID),
        }),
      cancel: (cancel) =>
        input.integration.command.cancel({
          integrationID: Schema.decodeUnknownSync(ID)(cancel.integrationID),
          attemptID: Schema.decodeUnknownSync(AttemptID)(cancel.attemptID),
        }),
    },
    connection: {
      active: (id) => input.integration.connection.active(ID.make(id)),
      resolve: (connection) => {
        // Regional connections are display-only for external plugins; AWS credential material stays host-owned.
        if (connection.type === "regional-credential" || connection.type === "regional-env") {
          return Effect.succeed(Option.getOrUndefined(Option.none<Credential.Value>()))
        }
        return input.integration.connection.resolve(
          connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
        )
      },
    },
    transform: (callback) =>
      input.integration.transform((draft) =>
        callback({
          list: () => mutable(draft.list()),
          get: (id) => mutable(draft.get(ID.make(id))),
          update: (id, update) => draft.update(ID.make(id), update),
          remove: (id) => draft.remove(ID.make(id)),
          method: {
            list: (id) =>
              draft.method.list(ID.make(id)).map((method) =>
                method.type === "env-group"
                  ? { id: method.id, type: method.type, authKind: method.authKind, available: false }
                  : method,
              ),
            update: (registered) => draft.method.update(methodImplementation(registered, allowHostOwned)),
            remove: (id, method) => draft.method.remove(ID.make(id), methodSelector(method)),
          },
        }),
      ),
    reload: input.integration.reload,
  }
}
```

`methodImplementation`, `methodSelector`, and `OAuthAuthorizationDetails` move verbatim from `host.ts:418-514`. The OAuth callback registration reads the captured `workspaceID` from `Input` (`host.ts:180-188` reads it from `services.workspaceID`). Everything in this Adapter is moved code, not new behavior.

The former `ToolPlugin.domain` dual-registry sketch is removed. There is no implemented `tool/plugin.ts` adapter
or newly approved public host-binding interface. Keep the current host delegation and private Tool-owned OpenAPI
producer; refer to the canonical registration contract rather than restoring the obsolete add-only facade.

## Implementation sketch

The assembler keeps every one-line projection as today (`host.ts:97-147,276-354,363-368`) and owns the cross-cutting concerns. Only the changed parts are shown; the elided projections are literal copies of the current lines cited:

```ts
export function make(
  services: HostServices,
  pluginID: string = "test",
  options: PluginOptions = {},
  source?: Plugin.Source,
): PluginContext {
  const scope: Scope = {
    pluginID,
    workspaceID: services.workspaceID,
    ...(source?.type === "project" ? { projectID: source.projectID } : {}),
    ...(source === undefined ? {} : { source }),
  }
  const context: PluginContext = {
    app: services.app,
    location: {
      workspaceID: services.workspaceID,
      ...(scope.projectID === undefined ? {} : { projectID: scope.projectID }),
    },
    options,
    agent: /* unchanged projection, host.ts:97-122 */,
    aisdk: { hook: services.aisdk.hook },
    catalog: /* unchanged, host.ts:124-133 */,
    command: /* unchanged, host.ts:134-138 */,
    event: {
      subscribe: () =>
        services.bus.subscribe().pipe(
          Stream.map(projectEvent),
          Stream.filter(Option.isSome),
          Stream.map((event) => event.value),
        ),
    },
    gateway: { hook: (name, callback) => services.shellHooks.register("gateway", name, callback) },
    integration: IntegrationPlugin.domain({
      integration: services.integration.integration,
      ...(services.integration.oauthCallback === undefined
        ? {}
        : { integrationOAuthCallback: services.integration.oauthCallback }),
      ...(services.integration.accountID === undefined ? {} : { accountID: services.integration.accountID }),
      workspaceID: services.workspaceID,
      pluginID,
      ...(source === undefined ? {} : { source }),
    }),
    instruction: /* unchanged, host.ts:276-290 */,
    mcp: /* unchanged, host.ts:291-295 */,
    plugin: { list: () => services.plugin.list() },
    policy: {
      list: () => services.policy.list,
      add: (policy) => services.policy.transform((draft) => draft.add(admitPolicy(scope, policy))),
      remove: (id) => services.policy.transform((draft) => draft.remove(id)),
      transform: (callback) =>
        services.policy.transform((draft) =>
          callback({
            list: draft.list,
            add: (policy) => draft.add(admitPolicy(scope, policy)),
            remove: draft.remove,
          }),
        ),
      reload: services.policy.reload,
    },
    reference: /* unchanged, host.ts:311-321 */,
    session: /* unchanged, host.ts:323-336 */,
    shell: { hook: (name, callback) => services.shellHooks.register("shell", name, callback) },
    skill: /* unchanged, host.ts:338-354 */,
    storage: PluginStorage.make(services.workspaceID, services.storage, pluginID),
    tool: /* current host transform/reload/openapi/hook projection; not extracted by this proposal */,
    websearch: /* unchanged, host.ts:363-368 */,
  }
  return context
}

/** Strictly decode a plugin policy definition, default `enabled`, and stamp host-owned provenance. */
function admitPolicy(scope: Scope, policy: Definition) {
  /* body unchanged from host.ts:377-390, reading scope.pluginID / scope.source */
}
```

The historical estimate was ~190 assembler lines after extraction. This is not the implemented shape; Tool
publication now belongs to shared snapshot preparation and no longer motivates a two-registry host adapter.

## Caller migration

| Call site | Today | After |
| --- | --- | --- |
| `packages/core/src/plugin.ts:79` | `PluginHost.make({ ...services, bus, plugin: registry }, plugin.id, options, plugin.source)` | **unchanged** — `make` keeps its signature |
| `packages/core/src/plugin.ts:58` | `Omit<PluginHost.HostServices, "bus" \| "plugin">` | Historical Integration nesting proposal only; Tool remains one dependency |
| `test/plugin-host.test.ts:1430-1458` (`services()`) | 22-field flat builder, 17 `{}` casts | 19-key builder (nested groups); ~13 of 24 cases stop using it entirely |
| `test/policy-tool.test.ts:640-664` | second full 22-field builder | keeps only the policy/tool/storage fields it actually exercises |
| `test/integration/integration.test.ts:1106-1128` | third full builder | shrinks to the domains its plugin exercises |

## Tests

| Existing test slice | Verdict |
| --- | --- |
| `plugin-host.test.ts` Integration slices (`165-447`, `449-521`, `805-881`, `1098-1285` — 11 cases) | **move** → `test/integration/plugin.test.ts`, rebuilt on `IntegrationPlugin.domain({ integration: fake, ... })` — same assertions, one fake instead of a full `HostServices` |
| Historical Tool routing/rollback slices | **superseded** by single-registry replay/disposal, winner-provenance, prepared-snapshot, and Promise/Effect activation coverage; old line ranges are not current tests |
| `plugin-host.test.ts` assembler slices: location (`93-108`), catalog passthrough (`110-163`), policy provenance + lifecycle + tombstones (`565-666`), hook registration wiring (`668-734`, `761-803`), event projection (`1079-1096`), agent ID routing (`884-904`), runtime cell (`1287-1404`), instruction (`54-91`) — 11 cases | **keep** — these test the assembler's remaining knowledge |
| `policy-tool.test.ts`, `plugin-internal.test.ts`, `plugin-scoped.test.ts`, `plugin-supervisor.test.ts`, `integration/integration.test.ts` | **keep**, with their builders updated to the nested `HostServices` |

The former test constructing two Tool registries is removed. Current tests must exercise public registration and
prepared snapshots from one registry, including disposal, normalized overrides, invalid log/skip, builtin winner
exclusion, and direct/CodeMode parity. This is a verification requirement, not a test-result claim.

## Preserved behavior

- `make` signature, `PluginContext` shape, and every public domain method are unchanged (`plugin.ts:79`; `plugin/effect/plugin.ts:24-46`).
- Key connect rejects `answer` + `configuration` together (`host.ts:152-155`); AWS SigV4 rejects foreign `methodID` (`:163-166`); OAuth callback registration dies without account/callback authority (`:179-189`).
- Regional connections stay display-only — resolve returns `undefined` without touching AWS credential material (`host.ts:234-242`; test `:251-319` asserts redaction across `secretAccessKey`/`accessKeyId`/`AWS_`).
- Host-owned `aws-sigv4`/`env-group` methods remain registerable only by `core.provider` with a builtin/undefined source (`host.ts:263-269,434-445`; tests `:378-419`).
- Transport-safe removal selectors per method type (`host.ts:504-514`; test `:321-376`).
- Tool contributions register once in the member graph; gateway preparation excludes builtin winners without fallback. Failed registrations log/skip, rather than rolling back a second installation.
- Policy provenance stamping, `enabled` defaulting, and enforced-rule gating stay assembler-owned (`host.ts:376-390`; tests `:565-666`).
- Storage namespaces, event projection allowlist, and runtime cell behavior are untouched (`plugin-storage.ts:9-12`; `host.ts:392-416`).

## Open decisions

1. **Nest `HostServices.integration` vs. keep flat.** This historical proposal needs current measurements. Tool's former nested dual-registry group is superseded and is not an open decision.
2. **Which domains get adapters.** All 18 (uniform) vs. depth-graded (Integration, Tool, Storage-already-done). **Recommended: depth-graded.** A uniform split fails the deletion test for the 14 one-liner domains.
3. **Where `admitPolicy` lives.** Assembler (provenance is cross-cutting) vs. `policy/plugin.ts`. **Recommended: assembler** — it is the one place `Scope` is minted, and moving it would just relocate ownership of `Scope`.
4. **Whether `workspaceID` joins `IntegrationPlugin.Input`.** It must (OAuth callback ownership needs it, `host.ts:180-188`); the only question is whether the assembler passes it separately or as part of `Scope`. **Recommended: separate field on `Input`**, keeping domain inputs self-contained.

## Verdict

**Quantified:**

| Measure | Before | After |
| --- | --- | --- |
| `host.ts` lines | 514 | ~190 assembler + ~265 `integration/plugin.ts` + ~35 `tool/plugin.ts` ≈ 490 |
| Lines moved | — | ~250 (Integration block + method helpers + Tool routing) |
| Lines actually removed | — | ~25 (one `mutable` copy kept, duplicated `{}`-cast knowledge in test builders, two `services.`→`input.` glue layers net out) |
| Hand-rolled `HostServices` test builders | 4 full builders + 2 deepProxy casts, each stubbing 17–22 fields | 4 builders shrink to ~8–12 fields; 11 of 24 host-test cases leave the builder entirely (1–2 fakes each) |
| Files a plugin-surface Integration change touches | 1 (`host.ts`) | 1 (`integration/plugin.ts`) |
| Files a one-liner-domain change touches | 1 (`host.ts`) | 1 (`host.ts`) — unchanged |

**Honest answer: this was mostly moving code, not deepening it.** The historical Integration extraction argument
remains a proposal. The Tool routing argument no longer applies: publication is inside Tool snapshot preparation.
Historical counts in this table must be remeasured; they are not evidence for a current host split.

**Recommendation: do not do this now.** `PluginHost` already passes the deletion test, has one production caller, and has a real two-sided Seam; Candidates 4 and 5 (which shrink what the host must project) should land first. Execute this spec only if, after those candidates, the observable trigger conditions hold:

1. `host.ts` remains an edit hotspot — repeated merge friction or a plugin-surface change that requires editing the assembler itself (not just a domain's behavior) more than occasionally.
2. A change requires touching two or more domain projections plus their tests in the same commit — the signature of a Module that knows too much.
3. A second consumer of per-domain Adapters appears (e.g. a CLI or test harness building partial plugin contexts), making `IntegrationPlugin.domain` two real Adapters instead of one hypothetical one.
4. `plugin-host.test.ts` keeps growing past ~1,500 lines or its `services()` builder starts needing conditional fields per test.

If triggered, reassess the Integration-only proposal against current source and obtain approval. Do not execute the
superseded Tool adapter, dual-registration tests, or nested Tool group from this historical plan.

## Sequencing

1. Extract `integration/plugin.ts` with `IntegrationPlugin.domain`; `host.ts:148-275` and `418-514` delegate to it. No public change; host tests pass untouched.
2. Keep implemented Tool transform/reload/openapi/hook delegation; no Tool adapter extraction is approved here.
3. Reassess Integration nesting and current test builders only after confirmation.
4. Reassess Integration test locality; keep Tool tests on the current single-registry public registration boundary.
5. Re-run the deletion test per remaining domain; record the outcome in this spec and stop unless a trigger condition fired for more.
