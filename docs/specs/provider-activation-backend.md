# Provider Activation — backend interface

**Status: approved and implemented in this worktree.** The domain is approved in `CONTEXT.md:173–177`. This design deepens Core Catalog, keeps Integration generic, and uses existing Workspace Config persistence. Sessions and LLM Gateway continue to receive execution decisions exclusively from Core Catalog.

The worktree does not contain `references/domain-design.md` or `references/service-design.md`, despite the root guide linking them. This design used the copies at a separate checkout. Those process documents do not override this worktree's current glossary. Read guides: root, Core, Protocol, Plugin; testing runbook: `packages/testing/src/README.md`. Skills: `design`, `coding-standards`.

## 1. Exact public contract

These are proposed additions/replacements, not claims about existing APIs. Existing operations not shown remain supported. Names intentionally retain the existing `Provider.Status`, `Provider.Info.status`, and nested Catalog shape; widening status is a deliberate contract migration.

### Schema: Provider and Config

```ts
// packages/schema/src/provider.ts — replace Status; add UpdateInput
import { Schema } from "effect"
// Name, Info, Integration, NonNegativeInt already exist in this module.

/** Requested participation policy, distinct from its current result. */
export const Status = Schema.Literals(["auto", "enabled", "disabled"])
export type Status = typeof Status.Type

/** Replace the activation policy of one existing Catalog Provider. */
export const UpdateInput = Schema.Struct({
  provider: Name,
  status: Status,
}).annotate({ identifier: "Provider.UpdateInput" })
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

/** Discovery and current participation; contains no credential values. */
export const DirectoryEntry = Schema.Struct({
  info: Info,
  integration: Schema.optionalKey(Integration.Info),
  active: Schema.Boolean,
  connected: Schema.Boolean,
  connectionCount: NonNegativeInt,
  modelCount: NonNegativeInt,
}).annotate({ identifier: "Provider.DirectoryEntry" })
export interface DirectoryEntry extends Schema.Schema.Type<typeof DirectoryEntry> {}
```

`Provider.Info.status` uses the widened schema. It is the **effective requested mode**, not a computed boolean. `DirectoryEntry.active` is the computed participation result. `connected` remains authentication availability, including an explicitly permitted deployment source; it is not proof of successful authentication. A disabled Provider can remain connected. An enabled Provider can be active but disconnected.

```ts
// packages/schema/src/config.ts — replace Providers
import * as Provider from "./provider.js"
import { Schema } from "effect"
import { optional } from "./schema.js"

/** Independent Provider admission and activation settings. */
export const Providers = Schema.Struct({
  allow: Schema.Array(Provider.Name).pipe(optional),
  activation: Schema.Record(Provider.Name, Provider.Status).pipe(optional),
})
export interface Providers extends Schema.Schema.Type<typeof Providers> {}
```

No default `{}` is injected into persisted documents. Missing activation entry means inherit. An explicit `"auto"` entry overrides an installation or Plugin `"enabled"` declaration; deleting an entry means inherit, not auto. The dedicated update operation writes all three values literally. Removal/inheritance can use the existing whole-document Config update; a separate reset operation is unnecessary for this scope.

Example installation declaration or persisted Workspace JSON:

```json
{
  "providers": {
    "activation": { "amazon-bedrock": "enabled", "openai": "auto" }
  }
}
```

`providers.allow` is unchanged: absent admits all active Providers; present is an allowlist. Adding a name to `allow` does not activate it. Plugin selectors such as `core.provider.amazon-bedrock` register authentication methods; selecting that Plugin does not itself enable inference.

### Core Catalog

```ts
// packages/core/src/catalog.ts — new error and replacement provider member
import { Context, Effect, Schema } from "effect"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Config } from "./config.js"

/** No effective Provider exists for the requested update. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "Catalog.NotFoundError",
  { provider: ProviderSchema.Name },
) {}

// Replacement provider member; retain existing model and State members.
export interface Interface {
  readonly provider: {
    readonly get: (providerID: string) => Effect.Effect<ProviderSchema.Info | undefined>
    readonly all: () => Effect.Effect<ProviderSchema.Info[]>
    readonly available: () => Effect.Effect<ProviderSchema.Info[]>
    readonly directory: () => Effect.Effect<ProviderSchema.DirectoryEntry[]>
    readonly update: (input: ProviderSchema.UpdateInput) => Effect.Effect<
      ProviderSchema.Info, NotFoundError | Config.StorageError
    >
  }
}

/** Existing tag and authority are retained. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Catalog") {}
```

The interface excerpts in this document show exact changed members to merge into their existing owning declarations; they are not new partial-interface services. All existing Catalog `model` signatures and `Execution` fields remain. Extend the existing `Catalog.ModelUnavailableError.reason` union with `"provider-inactive"`. Extend shared and Protocol `Model.Management.unavailableReason` with the same literal. Keep `"provider-disabled"` for explicit disablement. `ModelResolver.ResolutionError` continues translating either participation refusal to its existing `"unavailable"` reason; Gateway continues mapping them to its existing `NotFoundError`.

`provider.update` persists only activation for an already discovered effective Provider, then returns its `Provider.Info` with the new status. It does not probe authentication or invoke a model. Unknown Provider yields `Catalog.NotFoundError` without persistence. A source-only Provider may be explicitly enabled; this does not install a transport or invent authentication. The update is idempotent. Config storage failure is typed and no success is returned.

`provider.get/all` return discovery with effective status overlays, including inactive/disabled Providers. `provider.available` returns active Providers, even when explicit enablement lacks authentication. `model.available/default/requireAvailable/requireExecution` additionally require supported execution and a usable authentication projection. Provider activation is therefore deliberately weaker than model executability.

### Core Config

```ts
// packages/core/src/config.ts — add error and provider member
import { Effect, Schema } from "effect"
import { Config } from "@bymorning/schema/config"
import { Provider } from "@bymorning/schema/provider"

/** Safe failure to persist one Provider activation change. */
export class StorageError extends Schema.TaggedError<StorageError>()(
  "Config.StorageError",
  {
    operation: Schema.Literal("provider.update"),
    message: Schema.String,
  },
) {}

// Additional member of existing Interface.
export interface Interface {
  readonly provider: {
    readonly update: (input: Provider.UpdateInput) => Effect.Effect<Config.Info, StorageError>
  }
}
```

Config owns atomic storage and default resolution, not the participation decision or Provider-existence validation. Use the existing row-lock/transaction and active-state publication pattern for the new narrow mutation. Unlike current unrelated Config methods, its known SQL/decode failures must not become defects: preserve them through the new mutation path and translate to this safe error. Do not wrap the existing `patch` after it has already used `Effect.orDie` and claim typed storage coverage. Existing generic `Config.update` retains its compatibility behavior, including replacing client-owned fields; activation is client-owned there.

### Core Integration: generic deployment opt-in

```ts
// packages/core/src/integration.ts — add Selection; change get and active only
import { Effect } from "effect"
import { Connection } from "@bymorning/schema/connection"

/** Whether this consumer permits deployment authentication to participate. */
export interface Selection {
  readonly deployment?: "allow" | "omit"
}

// Changed members of existing Interface; retain existing connection mutations.
export interface Interface {
  readonly get: (id: ID, selection?: Selection) => Effect.Effect<
    Info | undefined, OAuthClientConfigurationStorageError
  >
  readonly connection: {
    readonly active: (id: ID, selection?: Selection) => Effect.Effect<Connection.Info | undefined>
    readonly resolve: (connection: Connection.Info) => Effect.Effect<
      Credential.Value | undefined, AuthorizationError
    >
  }
}
```

`get` and `active` default to `{ deployment: "omit" }`. `list()` keeps its signature and always uses that default. No provider name, activation mode, Catalog callback, or Config service enters Integration. Public Plugin calls and Integration HTTP inventory remain conservative; Catalog's Provider directory is the contextual view which can include deployment authentication. The new Core-only argument need not be exposed through the public Plugin or Integration HTTP APIs.

`"allow"` means a supported registered deployment method can be projected, not that credentials exist. It cannot create a method or bypass `member-only`. Existing selection priority remains active member credential, permitted shared credential, complete environment method in declaration order, deployment last. The retained `AuthorizationError` and storage-error aliases keep existing tags for compatibility; no new error is needed for the selection option.

## 2. Activation decision and selection invariants

Resolve requested status in this order, per Provider key:

1. Persisted Workspace `providers.activation` entry.
2. Last installation Config document declaring that key.
3. Effective Plugin-contributed `Provider.Info.status`.
4. Bundled/default `auto`.

Explicit configuration overlays the replayed Catalog on read/execution; it is not an early transform that a later Plugin can accidentally overwrite. Bundled registry and source discovery records change from `enabled` to `auto`. Existing anonymous parent construction remains `disabled` until a Plugin explicitly configures the Provider. Existing Plugin-authored `enabled` or `disabled` is deliberate and retains its literal meaning. A Plugin that previously used enabled to mean discoverable should migrate to auto.

| Effective status | Configured supported source | `active` | Deployment projection |
| --- | --- | --- | --- |
| auto | none | false | omitted |
| auto | unrelated Tool/MCP Connection only | false | omitted |
| auto | permitted saved Provider Connection | true | omitted |
| auto | complete supported env method | true | omitted |
| auto | explicit `execution.authentication.type: "none"` | true | omitted |
| enabled | none | true | allowed only on a registered deployment method |
| disabled | any | false | omitted |

Catalog follows only the effective `execution.authentication.integration` reference. Remove the current fallback that treats a same-named Integration as Provider authentication when execution/authentication is absent. A Provider referencing a shared generic Integration deliberately may use it; an unrelated Integration with saved credentials may not activate that Provider. No iteration over all Integrations is evidence of inference availability. Source environment/package hints never register methods or supply execution.

Bedrock automatic environment activation retains the existing supported groups: bearer requires nonempty `AWS_BEARER_TOKEN_BEDROCK` **and** valid `AWS_REGION`; SigV4 requires nonempty `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and valid `AWS_REGION`, with optional `AWS_SESSION_TOKEN`. `AWS_PROFILE`, `AWS_DEFAULT_REGION`, `AWS_REGION` alone, a shared credentials file, ECS/EC2 role availability, and a default region do not meet auto activation. No chain call occurs while evaluating this table.

For explicit enablement, the existing deployment projection uses validated `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1`; its presence is permission to attempt late resolution. Preserve the current region validation and AWS account/region eligibility semantics. This change does not add model/region allowlists or rewrite upstream model IDs.

For automatic Bedrock activation, only regional saved/environment Connections count as supported authentication; a plain key with no required regional configuration must not mark Bedrock active. Existing active identity priority must not be bypassed by searching for a lower-priority credential after failure. For ordinary key authentication, use its registered Integration's supported saved/environment projection. Activation establishes configured authentication, not upstream token validity.

`DirectoryEntry.connectionCount` counts the contextual Integration projection (saved/env and only explicitly permitted deployment), not successful upstream logins. With explicit no-auth, `connected=true`, `connectionCount=0`, and `integration` is absent. With absent execution/authentication, `connected=false`; enabling still sets `active=true`, while execution fails `transport-unsupported`.

`model.visible()` without a Provider filter should use participation rather than the old connected set. `model.visible(provider)` continues showing that Provider's full management inventory, including inactive and disabled models. Explicitly enabled but disconnected Providers can thus expose model management with `connection-unavailable`, while usable/default lists stay executable. Model enablement, default preference, admission hooks, and picker visibility remain separate inputs.

## 3. Call graph, including the chain gate

### Concrete current leak

```text
GET /api/providers
  server/handlers/provider.ts → Catalog.provider.directory()
    core/catalog.ts → Integration.get("amazon-bedrock")
      core/integration.ts → resolveConnections
        registered aws-sigv4 method + default us-east-1
        → regional-deployment Connection
    connections.length > 0 → connected=true
```

`core/provider/registry.ts` currently marks Bedrock enabled; `Catalog.requireExecution` therefore also admits that deployment selection. These are the two independent defaults this design changes.

### Proposed mutation and happy execution

```text
PUT /api/providers/activation { provider: "amazon-bedrock", status: "enabled" }
  server/handlers/provider.ts
    requireAdmin → CurrentActor (edge only)
    Catalog.provider.update(input)
      Catalog confirms Provider exists
      Config.provider.update(input)
        workspace_config row lock → merge one activation entry → commit
        Config.Event.Updated after commit
      → Provider.Info with status="enabled"
    LLMGateway.Lease.invalidate(workspaceID) (existing Config handler pattern)
    → HTTP 200 ProviderInfo projection

Session → ModelResolver.resolve(model)
  Core Catalog.model.requireExecution(model)
    Config.get → effective status="enabled"
    Integration.get(auth.integration, { deployment: "allow" })
    Integration.connection.active(auth.integration, { deployment: "allow" })
      → regional-deployment { region: "us-east-1", authKind: "sigv4" }
    → Catalog.Execution { routing: { type: "aws-bedrock", connection: deployment, ... } }
  ModelResolver.prepare(execution)
    → physical request auth middleware in core/provider/bedrock-auth.ts
      Integration.connection.active(id, { deployment: "allow" })
      confirm selected identity and region still match
      Integration.connection.resolve(selected)
        BedrockAuth.defaultChain({ region }) NOW
        → fresh Credential.AwsSigV4 → sign final request → provider exchange

LLMGateway private Catalog.list/resolve
  gateway/src/llm-gateway/catalog.ts
    → same Core Catalog.model.requireExecution
    → Gateway caller-format compatibility and exchange
```

The middleware derives its generic selection option from the already captured `Catalog.Execution.routing.connection.type`: only a captured deployment identity uses `allow`. Saved/env executions use `omit`. This prevents a lost env/saved Connection from silently turning into a deployment identity. Preserve the existing exact region/identity check before resolution. Integration still owns credential refresh and selection; no chain credentials enter Catalog state or public response.

A prepared execution retains its selected identity; changing activation applies to subsequent execution selections, rather than cancelling an already admitted in-flight request. Existing Gateway lease invalidation/drain handles retained graph generations. Explicit re-selection must never be smuggled into a refresh.

### Failure traces

```text
Bedrock status=auto, AWS_REGION=us-east-1, no complete credentials
  Catalog sees no supported non-deployment source
  → provider-inactive ModelUnavailableError; no chain invocation
  Session ModelResolver → ResolutionError(reason="unavailable")
  Gateway resolve → existing Gateway NotFoundError

Bedrock status=enabled, missing deployment credentials
  Catalog returns execution (no credential validity promise)
  physical request → Integration.resolve → AuthorizationError
  Bedrock middleware → Provider.FailureError("Provider credential could not be resolved")
  existing Session/Gateway failure translation; no alternate identity or destination

Unknown Provider update → Catalog.NotFoundError → Protocol.InputError (400)
Config write failure → Config.StorageError → Protocol.ServiceUnavailableError (503)
Nonadmin update → Protocol.ForbiddenError (403), before Core mutation
Malformed status/provider payload → existing HTTP schema decode refusal (400)
```

## 4. Dependency and Layer graphs

```text
Provider.node [global discovery + physical inference]
Model.node
Config.node ───────────────→ Database, Bus
Integration.node ──────────→ Credential, Bus, AppProcess, State
Catalog.node ──────────────→ Provider, Model, Config, Integration, State
ModelResolver.node ────────→ Catalog, Integration
Gateway Catalog.layer ────→ Core Catalog

Config declarations → Config.layer(workspaceID, defaults)
Credential/Bus/AppProcess/State layers → Integration.layerWith(...)
Provider/Model/Config/Integration/State layers → Catalog.layerWith(coordinator)
Catalog/Integration layers → ModelResolver.layer
workspace/member composition → existing Session and Gateway lifetimes
```

Keep `Catalog.node`, `Catalog.layer`, `Integration.node`, and current deprecated compatibility constructors. No new global service or Layer is needed. `Integration` **never depends on Catalog or Core Config**. The generic selection option is a value carried down an already existing call edge. It neither reads back into Catalog nor installs a provider-aware transform in Integration. Multiple Providers sharing one Integration cannot globally turn its deployment source on for each other.

Private work stays in `catalog.ts` or, if cohesion warrants it, `catalog/activation.ts`; private selection/projection mechanics remain inside Integration. Do not expose these internals merely to test them.

### Deletion rationale

Catalog already earns this authority: deleting its activation decision spreads authentication-source filtering and three-state precedence across Session, Gateway, and Provider management. A separate Activation service would duplicate Catalog ownership and add a second source of truth; reject it. A provider-aware Integration configuration transform either introduces a cycle or a global shared-Integration flag; reject it. Checking `connections.length` in each caller preserves the original bug; reject it. Reuse Config's durable document rather than introduce an activation table, cache, or independent aggregate.

## 5. HTTP/SDK contract

`packages/protocol/src/groups/provider.ts` keeps `provider.list` / `GET /api/providers`, widens its private `ProviderInfo.status`, and adds `active: Schema.Boolean` to its private directory projection. The public projection deliberately continues omitting execution secrets/settings. Add exactly:

```ts
import * as Provider from "@bymorning/schema/provider"
import { HttpApiEndpoint } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, ServiceUnavailableError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

// Added to existing ProviderGroup before .prefix("/api"):
HttpApiEndpoint.put("provider.update", "/providers/activation", {
  query: WorkspaceQuery,
  payload: Provider.UpdateInput,
  success: ProviderInfo,
  error: [InputError, ForbiddenError, ServiceUnavailableError],
})
```

The handler performs edge authorization using existing `requireAdmin`, calls Catalog, maps the two typed errors, and invalidates the existing Workspace Gateway lease after successful persistence. Recommend administrator-only activation mutation because it is shared inference configuration; this is part of the requested interface approval. It takes no Actor into Core.

Also protect changes to `providers.activation` through `config.update`; otherwise the new mutation's authorization is bypassable. Compare the submitted stored activation map to the stored document's map (from `Config.entries()`), not to the merged installation default. Unchanged maps need no extra role check. Add `ForbiddenError` to that Protocol endpoint's declared error contract, which already has a permission check in its handler. Unknown names remain permitted in file/whole-document configuration so declarations can precede Plugin discovery; only the targeted Catalog update requires present discovery.

Regenerate clients from Protocol, never hand-edit generated types:

```sh
bun run --filter @bymorning/client generate
bun run --filter @bymorning/protocol typecheck
bun run --filter @bymorning/client typecheck
bun run --filter @bymorning/client check:generated
```

## 6. Minimum happy path and exact output

Use the existing Catalog transform to register one explicit no-auth custom Provider, with zero Models, in an otherwise isolated Catalog fixture. The full contributed record is:

```ts
{
  name: Provider.Name.make("local"),
  displayName: "Local",
  api: Provider.API.make("http://127.0.0.1:11434/v1"),
  format: "oa-compat",
  status: "auto",
  execution: {
    package: "@opencode-ai/ai/providers/openai-compatible",
    authentication: { type: "none" },
  },
}
```

No environment, saved Credential, admission list, activation override, or Model is required. All optional settings/options are absent. `Catalog.provider.directory()` returns exactly one entry:

```ts
{
  info: {
    name: Provider.Name.make("local"),
    displayName: "Local",
    api: Provider.API.make("http://127.0.0.1:11434/v1"),
    format: "oa-compat",
    status: "auto",
    execution: {
      package: "@opencode-ai/ai/providers/openai-compatible",
      authentication: { type: "none" },
    },
  },
  active: true,
  connected: true,
  connectionCount: 0,
  modelCount: 0,
}
```

**No error.** `provider.update({ provider: Provider.Name.make("local"), status: "disabled" })` returns that exact `info` with only status changed. The next directory entry has `active=false`, `connected=true`, and both counts still zero. This is the first public-seam test and illustrates why participation is not authentication availability.

## 7. Persistence, configuration precedence, and migration

- Store `providers.activation` in existing `workspace_config.value` JSONB (`core/database/schema/config.sql.ts`); no table or column migration. Existing `{}` documents decode unchanged. No Credential values, deployment Connection rows, or temporary AWS values are persisted by activation.
- Extend `Config.layer` installation-default resolution specifically for this map: merge each installation declaration in order, then persisted entries. Today only plugin declarations and Code Interpreter defaults are merged there; adding a Schema field alone will not make installation activation work. Preserve admission `allow` semantics separately.
- Dedicated mutation locks the row, updates only one activation map entry, preserves every other Config field, publishes `config.updated` after commit, and makes `Config.get` immediately observe the merged result. No-op identical stored updates do not publish. Different Provider updates cannot overwrite one another. Whole-document Config replacement retains its existing replacement semantics and must be documented as such.
- Preserve server-owned Model policy/default in generic Config update. Keep models, saved Credentials, and activation preferences when a Provider disappears from a Plugin generation, so reappearance under the same key recovers configuration.
- Change both bundled registry and source-only statuses to auto. Existing deployment-only Bedrock installations must explicitly set `providers.activation["amazon-bedrock"]="enabled"`; never backfill enabled from old discovery status, infrastructure AWS environment, or role existence. Complete supported env groups and permitted saved Connections continue to activate automatically.
- Review every `status === "enabled"` consumer and generated enum match. Catalog uses the three-state rule; Provider management uses `active`; transport eligibility stays in execution checks. Existing explicit Plugin `status="enabled"` remains explicit enablement. No added `Provider.Info.activation` field or competing status boolean.
- Update configuration/operator examples and release migration notes with the one-entry Bedrock declaration. Configuration carries activation; an installation-specific `BEDROCK_ENABLED` environment variable is unnecessary.
- Config and Integration existing events invalidate client Provider/model views. Activation needs no new domain Event; ensure the frontend actually reloads both inventories on `config.updated`, and credential changes recompute auto activation. Retained Gateway contexts must refresh through the existing lease/config/connection invalidation wiring before subsequent selections.

## 8. Test plan through real seams

1. **Core Catalog table:** exercise every row above through `provider.directory`, `provider.available`, `model.visible`, `model.available`, `model.default`, and `model.requireExecution`. Cover unsupported discovery hints and a Tool-only Connection. Do not merely unit-test the predicate.
2. **Integration isolation:** real registration/credential services with controlled Effect ConfigProvider. Default `get/list/active` omit deployment; contextual allow projects it without resolving credentials. Member-only still refuses shared/env/deployment. Sharing an Integration does not let one explicitly enabled Provider activate another auto Provider.
3. **Environment completeness:** region-only, profile-only, access-key-only, token-without-region, invalid region, bearer+region, complete SigV4, and missing optional token. Missing required values do not fall through to chain in auto. Default region is allowed only in explicitly enabled deployment selection.
4. **Real persistence + SDK:** reusable scenario under `packages/testing/src/scenario/`; behavior tests under `packages/testing/test/provider-activation.test.ts` using `TestApp.make`, login, real generated SDK, public Catalog/Config/Integration services. Set enabled/disabled/auto, reload the retained graph, verify persistence, exact status/active distinction, model refusal, Config event, idempotence, same-row concurrent updates, and admin/nonadmin checks including `config.update` bypass. Use actual database failure/legacy-row tests for persistence contracts where appropriate.
5. **Late AWS identity:** test the real Bedrock middleware and a narrow external credential-provider boundary, not module mocks or Catalog fakes. Directory/model discovery must work with chain resolution unavailable. Resolve fresh credentials only for physical enabled execution; credential rotation retains identity; removal/reselection fails instead of switching source. Reuse existing Bedrock transport fixture and signature assertions; never require live AWS.
6. **Session/Gateway parity:** use `packages/testing/src/scenario/bedrock.ts` and scripted external TestBedrock/TestLLM. Same effective configuration yields same activation decision in both entrypoints. Gateway sees only permitted shared Connections; a member-only saved connection can activate a Session view without activating Gateway. Disabled Provider is absent/refused in both, with zero provider requests. Enabled invalid chain fails late with existing safe error mapping. Preserve Session title model expectations.
7. **Precedence and reload:** installation enabled → persisted auto must suppress chain; Plugin enabled → explicit disabled wins; removing override restores inheritance; removing and readding a Plugin retains map entry. Credential creation/removal recomputes auto without changing persisted status. No stale Config generation enables a newly selected Gateway execution after invalidation settles.
8. **Contract:** regenerate SDK; inspect both Promise/Effect provider methods, directory active field, widened status, model inactive reason, and Config schema. Existing clients need an explicit enum compatibility review.

Run package-owned focused tests and `bun typecheck` from the affected package directories; application tests from `packages/testing/` with cancellation `signal` passed to `Effect.runPromise`. Synchronize on events/model receipt/readiness, not sleeps. Do not run source tests for this design-only artifact. Finish implementation verification with `git diff --check`.

## 9. Scoped implementation tasks after approval

```text
packages/schema/src/provider.ts                 change  three-state Status, UpdateInput, directory active
packages/schema/src/config.ts                   change  sparse per-Provider activation map
packages/schema/src/model.ts                    change  provider-inactive management reason
packages/core/src/config.ts                     change  typed narrow mutation, installation-map resolution
packages/core/src/catalog.ts                    change  sole activation decision, overrides, mutation, model gate
packages/core/src/catalog/activation.ts          optional add  private cohesive projection only if needed
packages/core/src/integration.ts                change  contextual deployment projection; default omit
packages/core/src/provider/registry.ts           change  bundled auto defaults
packages/core/src/provider/source.ts             change  discovery auto defaults
packages/core/src/provider/bedrock-auth.ts        change  honor captured deployment selection on recheck
packages/core/src/model-resolver.ts              review  map inactive refusal; preserve selection semantics
packages/protocol/src/groups/provider.ts         change  inventory and provider.update contract
packages/protocol/src/groups/config.ts           change  activation schema propagation and declared ForbiddenError
packages/protocol/src/groups/model.ts            change  inactive reason projection
packages/server/src/handlers/provider.ts         change  mutation authorization/error mapping/lease invalidation
packages/server/src/handlers/config.ts           change  activation-map authorization on whole-document update
packages/gateway/src/llm-gateway/catalog.ts       review  remains Core Catalog consumer; no activation policy
packages/client/src/**/generated/**              regenerate  from Protocol
packages/client/src/effect/api/api.ts            regenerate  from Protocol
packages/testing/src/scenario/provider-activation.ts add  reusable public-service setup
packages/testing/test/provider-activation.test.ts add  persistence/SDK/entrypoint parity
packages/core/test/**                           change/add  focused selection and projection seam coverage
packages/docs/src/03-admin/02-workspace-configuration.mdx change  operator activation and migration guidance
```

Suggested task dependency order: Schema/contract → Config/Integration → Catalog/middleware → Protocol/server/generated SDK → full Application scenarios/UI consumers. Config and Integration implementation can proceed independently after shared contract approval. No subagent should implement while this document is still a proposal.

## 10. Evidence and material trade-offs

- `core/catalog.ts:230–244,245–334,335–410`: current connected set, status check, authentication lookup, Bedrock selection, and directory projection.
- `core/integration.ts:429–535,899–928,970–980`: complete env groups, unconditional deployment projection, inventory, active selection, and genuinely late default-chain resolution.
- `core/provider/bedrock-auth.ts:43–70`: current re-selection and identity guard must receive the same contextual deployment decision.
- `core/provider/registry.ts:29,103–125` and `core/provider/source.ts:20`: current blanket enabled defaults.
- `core/config.ts:114–121,143–172,175–212`: current narrow installation-default handling and transaction/update behavior.
- `core/plugin/internal/providers.ts`: existing independent Workspace admission hooks.
- `gateway/src/llm-gateway/catalog.ts:43–67`: both Gateway discovery and invocation already call Core `requireExecution`.
- `server/handlers/config.ts:26–32`: existing config reload/lease invalidation pattern; `server/middleware/admin.ts` supplies edge authorization.
- `opencode/packages/core/src/plugin/provider/amazon-bedrock.ts:82–95`: reference behavior supports SDK creation without explicit AWS env credentials and supplies a late provider chain. Reuse that execution principle, not its activation assumptions or hard-coded model-prefix policy; this worktree's glossary is authoritative.

Main trade-off: widening existing status and adding a contextual Integration argument is smaller than introducing an Activation service, but it requires auditing status consumers and deliberately changing Integration's default deployment inventory. Ordinary Integration inventory will no longer show an implicit chain; Provider directory can show one only when Catalog permits it. The update endpoint returns Provider configuration rather than an authentication snapshot, avoiding a post-commit OAuth inventory failure. A subsequent directory read supplies current activation/authentication state.

**Approval requested:** three-state existing status + directory active; sparse Config map with persisted-over-installation precedence; targeted admin-only `provider.update`; conservative default Integration projection with per-call deployment allowance; late, identity-preserving Bedrock resolution; no separate activation aggregate or service.
