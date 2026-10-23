# Provider Activation — web proposal

Status: approved and implemented in this worktree. Read against the worktree on 2026-09-14. Provider Activation is the approved meaning in `CONTEXT.md`; Catalog owns automatic/enabled/disabled authority.

## Summary

Show a clear setup panel on New session when a successful Provider directory read reports no activated inference Provider. Reuse Add provider and open the existing Integration connection dialog directly. Show activation separately from Connections in Models → Providers, including explicit Bedrock enablement for deployment authentication. Catalog decides activation; Model availability still decides whether a conversation can be submitted. Keep the draft composer mounted so refreshes and setup do not erase text, project selection, or focus.

Minimum product scope is New session onboarding plus Models/Providers management. The shared Provider directory projection also serves existing Sessions, so its semantic change requires existing-Session regression coverage and a production benchmark. Do not add onboarding to the timeline or global shell.

## Actual proposed local interfaces

These declarations belong beside the existing functions in `integration/providers/model.ts` and `new-session/controller.ts`, using their current direct type imports and accessor conventions. Imports shown resolve today. There is no new public Core service, Effect Layer, global context, or second request cache in this proposal.

```ts
// packages/web/src/integration/providers/model.ts
import type { ProviderDirectoryEntry } from "@bymorning/client"

// Private UI vocabulary. Adapt from the approved generated response;
// never derive active from connected, connectionCount, region, or models.
type ProviderActivation = {
  readonly mode: "auto" | "enabled" | "disabled"
  readonly active: boolean
}

type ProviderEntry = {
  readonly directory: ProviderDirectoryEntry
  readonly activation: ProviderActivation
}

type ProviderSnapshot =
  | { readonly state: "empty" }
  | { readonly state: "ready"; readonly count: number }

type ProviderState =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | (ProviderSnapshot & {
      readonly refresh:
        | { readonly state: "idle" }
        | { readonly state: "loading" }
        | { readonly state: "error"; readonly message: string }
    })

// Add to createProviderCatalog's existing inferred return object:
// activation: () => ProviderState
// Keep directory/state/sync/invalidate and the existing ProviderInfo list.
// list() selects entries by authoritative activation instead of
// entry.connected && entry.info.status === "enabled".
```

`ProviderEntry` describes an adapter-local paired projection, not a replacement response type to put in the client. Prefer direct access to generated activation fields after approval if the adapter adds no translation. `ProviderState` is derived from the existing store's `DataState` and last successful directory; do not store a second copy of the directory/count. `count` is the positive number of activated Providers, independent of selectable Model count. The readiness boundary is a successful read (`refreshedAt`), not `items.length`.

```ts
// packages/web/src/new-session/controller.ts
import type { ProviderCatalog } from "../integration/providers/model"

type ProviderAccess = "admin" | "member"

type ProviderSetup = {
  readonly catalog: ProviderCatalog
  readonly access: () => ProviderAccess
  readonly retry: () => Promise<void>
}

// Add to createNewSessionDraftController's inferred result:
// provider: ProviderSetup
// `catalog.activation()` supplies setup state; composer/selection continue
// to own agent, selectable Model, draft, and submission readiness.
```

`access` comes reactively from `useWorkspace().current().role`, already used by `ConsoleGate`. It controls presentation only. Initial proposal: admin sees Add provider and Models management actions; member sees “Ask a workspace administrator to activate a provider.” This matches the existing admin Console and the connection editor's default shared `workspace` scope. Member-owned connection setup is a separate authorization question for API approval; do not silently route a member into the shared setup form or imply that an admin-only Console link will work.

Provisional activation editor contract, local to `integration/providers/management.ts`:

```ts
import type { ProviderDirectoryEntry } from "@bymorning/client"

type ActivationInput = {
  readonly provider: ProviderDirectoryEntry["info"]["name"]
  readonly mode: "auto" | "enabled" | "disabled"
}

type ActivationResult =
  | { readonly state: "ready" }
  | { readonly state: "forbidden" }
  | { readonly state: "invalid"; readonly message: string }
  | { readonly state: "unconfirmed" }
  | { readonly state: "refresh-error" }

type ActivationEditor = {
  readonly pending: () => boolean
  readonly update: (input: ActivationInput) => Promise<ActivationResult>
}
```

This is a feature operation, not an invented `client.provider.update` endpoint. Backend approval must supply the exact mutation, generated types, and error tags before wiring it. Existing TanStack mutation conventions (`retry: false`) and a small `createStore` own pending/outcome state. Deduplicate by provider while pending. `ready` means the write was acknowledged and both Provider and Model revalidation succeeded. A known refusal maps to `forbidden`/`invalid`; uncertain transport failure maps to `unconfirmed`; an acknowledged write followed by a failed read maps to `refresh-error`. Unexpected defects go through existing diagnostic/error handling, with fixed safe UI copy. Never display raw response bodies or credentials. This local result vocabulary is exhaustive for the proposed UI, not an assertion of backend tagged errors.

### Backend facts required before implementation

1. Per-directory-entry effective activation for the requesting member, plus configured mode. Return inactive entries too. Absence from discovery or a failed read cannot prove zero activation. Explicit enablement is independent of authentication discovery; disablement wins over saved Connections.
2. Existing identity/display metadata, Integration reference, connection count, and model count remain useful discovery facts. Connection count is not activation and may be zero for an active Provider.
3. A supported deployment-authentication choice for Bedrock, discoverable before activation without probing AWS credentials. Prefer a backend capability description over frontend inference from default region or `regional-deployment` presence. A confirmed built-in Bedrock identity is sufficient only if backend explicitly guarantees this action for it.
4. Mutation authority/permission, validation/not-found/refusal errors, and confirmed write response. Proposal is admin-only shared Catalog configuration; backend must confirm. Existing `provider.list` has no mutation companion today.
5. Invalidation notifications and scope: activation can change after Catalog configuration, Integration connection changes, or reconnect. Confirm the actual event names and whether they carry a revision. Model availability/unavailable reason remains authoritative; no credential checks in browser code.
6. When active Provider count is positive but no Model is usable, model management must still explain the Model's unavailable reason. Confirm whether current reason values need expansion for inactive automatic Providers.

Protocol is authoritative and clients are regenerated from it. Final implementation must replace provisional pairing with approved generated fields, not hand-author a duplicate transport DTO. Missing backend facts are approval blockers, not optional defaults to `false`.

## State and presentation

| State | New session | Models / Providers |
| --- | --- | --- |
| Initial idle/loading, no successful read | Small `role="status"`: “Checking providers…”; no setup claim | Loading state, no “No providers” claim |
| Initial read error | “Could not load providers.” with Retry; composer retains draft | Inline error and Retry, not a discovery-empty fallback |
| Successful directory, zero active | Visible heading “Activate a provider to start chatting”; “Add a provider connection or enable a configured provider.” Admin: Add provider; member: administrator guidance | “No providers activated.” Add provider; keep discoverable inactive Providers accessible |
| One or more active | Normal composer; setup panel absent | Activation status and Connections shown separately |
| Active Providers, Models still loading/error | Existing selection pending/error; never show provider setup | Model loading/error independent of activation |
| Active Providers, successful usable Model set empty | “No models available.” Admin: Manage models; member: administrator guidance | Preserve unavailable/disabled Model rows and reasons |
| Background refresh | Preserve last successful empty/ready presentation, label “Refreshing providers…” | Preserve rows, including a previously successful empty result |
| Refresh error after success | Preserve snapshot, label “Could not refresh providers.” and Retry | Same; do not turn retained data into a fresh success or clear rows |

New-session setup is a persistent corrective panel, not a 30-day dismissible promotional tip. Place it adjacent to the composer inside `new-session/view.tsx`; use existing Button, Dialog, and semantic CSS tokens. Preserve composer mounting, draft text, current project, browser-local Model visibility, and current explicit selection. Keep keyboard focus in the initiating flow; after successful setup closes, restore composer focus only when that flow owned focus. Background SSE updates must not steal focus. No motion is necessary for this minimal state change.

Submission is gated on the existing valid agent/Model selection plus known Provider readiness; after a known activation-affecting invalidation, wait for Provider and Model refresh to settle successfully before admitting a new-session prompt. Show stale data while this happens. The UI is not execution authorization: an upstream refusal after activation still follows normal prompt failure handling. Picker Visibility, zero-cost Models, unknown pricing, and no-auth Providers never count as missing activation.

## Ownership and traced flows

Existing read path:

```text
new-session/controller.ts: createNewSessionDraftController
  → integration/providers/model.ts: createProviderCatalog.sync
    → generated SDK provider.list({ workspace }, { signal })
      → protocol/groups/provider.ts: GET /api/providers
        → server/handlers/provider.ts: Catalog.Service.provider.directory()
  → context/data/workspace-catalog.ts: workspace.model.list()
    → shared generated Data.model.list()
    → filter enabled && unavailableReason === undefined
  → utils/model-option.ts: modelOptions(provider infos, model infos)
  → composer selection → session.create → session.prompt
```

Catalog owns policy and authentication-source meaning. Protocol/SDK owns transport shape. Feature-local `createProviderCatalog` owns Provider read identity, deduplication, stale data, and retry; generated Data plus `workspace-catalog.ts` owns Models. New-session controller owns composition; view owns copy and actions. Existing AbortControllers scope each resource and event subscription to the feature. Use the same catalog instance in the panel's AddProviderButton, its directory, and management operation.

Existing and proposed happy path:

```text
NewSessionView: AddProviderButton({ catalog: controller.provider.catalog })
  → integration/providers/view.tsx: ProviderDirectory (search/focus)
    → management.ts: useProviderManagement(entry, false)
      → IntegrationDialog(providerOnly: true, initialManagement: false)
        → dialog/controller.ts → context/integration.tsx → real Integration SDK
          → acknowledged Connection change
            → catalog.invalidate/sync + workspace.model.invalidate/sync
              → auto activation observed → setup panel disappears
                → selected usable Model permits ordinary session creation
```

Minimum demonstration: blank `TestApp.make()` plus real `app.login()`, no inference Connections and no explicit enablement. Directory contains bundled discoverable Providers, but local output is `{ state: "empty", refresh: { state: "idle" } }`, no error. Admin uses existing key flow with the fixture's ByMorning Integration and dummy credential; successful revalidation yields `{ state: "ready", count: 1, refresh: { state: "idle" } }`, no error. Only the scripted external model receives inference when the user submits.

Failure trace:

```text
Provider directory SDK read rejects
  → createProviderCatalog retains items and records DataState.error
    → activation() inspects prior successful-read marker
      → no prior success: initial error + Retry
      → prior success: retained empty/ready + refresh error + Retry
Retry
  → explicit invalidate + sync (Provider and Model when refresh affects both)
    → read succeeds → remove error and re-enable valid submission
```

### Freshness and races

Preserve in-flight/settled request deduplication. Invalidation must not fetch until a consumer explicitly synchronizes. After a confirmed activation or Connection change, invalidate and synchronize both directory and Models; repaint authoritative state after reads complete, with no optimistic “Activated” badge. A committed mutation whose refresh fails offers **Refresh**, not automatic mutation retry. For uncertain write outcome, first re-read the configuration and let the user reconcile; never replay the mutation automatically.

Two current behaviors need correction in this feature path:

- `watchProviderDirectory` skips Integration events while the directory is loading and assumes timestamps inside a request window prove coverage. A response may have snapshotted before such an event. Queue one invalidation/follow-up read for events during a request unless a backend revision proves coverage. Coalesce bursts; avoid self-triggered endless refreshes.
- New-session reconnect calls `providers.sync()` without invalidation, but a settled local directory returns immediately. Reconnect must invalidate and re-read current Providers and Models because Bus events have no replay. A disposed scope must abort subscriptions and ignore late completions.

`useProviderManagement` currently treats `ChangeReason === "activate"` as **Connection selection**, and skips model refresh for it. Do not reuse that label for Catalog Provider Activation. Introduce the feature's separate activation operation. Conservatively refresh Models for Connection selection too unless backend evidence guarantees it cannot affect availability (region-dependent Bedrock is relevant); a rename alone still needs only the directory.

## Deployment Bedrock enablement

In Add provider → Bedrock, offer **Use deployment AWS credentials** alongside the advertised connection methods in the Integration dialog when the backend advertises support and the caller has authority. Copy: “Enable Bedrock using this deployment's AWS credential chain. Credentials are resolved when a model is invoked.” This action makes the explicit Catalog choice `enabled`; it does not ask for or persist access keys, call `integration.connect.awsSigV4`, synthesize a Connection, or claim AWS authorization succeeded.

After acknowledged enablement, refresh Providers and Models. Show active/enabled even if authentication cannot yet resolve; show each Model's actual availability separately. Model readiness and first invocation determine whether chatting can proceed. Existing manual AWS key entry remains in IntegrationDialog.

In Models → Providers, use the shared **Enabled** switch plus effective **Active/Inactive** status. The switch writes explicit `enabled` or `disabled`; configuration and the activation API retain the full `auto | enabled | disabled` contract and can restore Automatic mode. Disabled preserves Connections and Model settings. Returning to Automatic re-evaluates supported configured authentication sources; bundled AWS support or region alone leaves Bedrock inactive. Show activated Providers and explicitly configured inactive Providers in the management list, as well as connected Providers, so disabling does not make a row vanish. Full discovery stays in Add provider.

## Evidence and scope decisions

- `integration/providers/model.ts:16–101`: feature-local `createStore`; directory-only read; retained successful items; `list()` currently filters `connected && status === "enabled"` and returns `[]` during first load. Add a successful-read-aware activation projection here rather than moving Provider state back into Data.
- `context/data/workspace-catalog.ts:68–90`: Model `rows()` preserves management facts; `list()` filters execution availability. Do not derive onboarding from either array's length.
- `new-session/view.tsx`: currently just backdrop and composer/project picker. Controller already constructs and watches one Provider directory. Pass it down; do not allocate another from the onboarding view.
- `integration/providers/view.tsx`: Add provider already shares its catalog and manages search/focus. The provider table currently filters `connected`, labels “Connected providers”, and conflates initial errors with empty fallback. Update these activation-related states together.
- `integration/dialog/`: provider setup opens this existing connection workflow directly. Provider-only setup fixes Connection scope to `workspace`, omits manual labels, and keeps only method-required fields. Generic member-only Integration setup remains personal.
- `gateway/models/{route,model,view}.tsx`: Models and Providers share one directory. Model rows, hidden/disabled models, unavailable reasons and Picker Visibility retain separate meanings. Replace generic “Connect provider” empty messaging based on actual Provider and Model read states.
- `shell/routes/routes.tsx`, `console/gate.tsx`: Models is under admin-only Console. `integration/dialog/controller.ts` defaults scope to `workspace` and forces member scope only for `member-only` Integrations. New-session onboarding bypasses the Console navigation boundary, so it must make authority explicit.
- `server/handlers/provider.ts` and `protocol/groups/provider.ts`: current public operation is discovery only. Existing Model handlers do not themselves demonstrate an admin check; UI gating is not proof of backend mutation authorization. Backend proposal must settle this.
- `opencode/packages/app/src/providers/catalog/providers.ts`: readiness explicitly waits for both Provider and Model reads; connectable discovery is distinct from available Providers. Its `paid()` special-cases the `opencode` Provider and input cost.
- `opencode/packages/app/src/new-session/view.tsx:116–181`: `ProviderTip` waits for readiness/persistence, opens the existing connection dialog, and dismisses for 30 days. Reuse the readiness/action principle only. ByMorning activation has no paid-model predicate, vendor pricing exception, persistence timer, or promotional dismissal.

## Verification after approval

### Mandatory production benchmark before any session-path source change

`packages/web/AGENTS.md` requires a production baseline before session/timeline edits and comparison afterward. The shared directory affects `features/session/session-context.tsx` too. Record baseline **before** changing new-session, shared directory selection, or session source. This design pass has not run the benchmark.

From `packages/web/`, choose an unused port (example 4189 only after checking availability):

```sh
PLAYWRIGHT_PORT=4189 TRANSCRIPT_RESULT=/tmp/opencode/provider-activation-before.json bun run benchmark:transcript
```

After implementation, same machine/browser/transport/viewport/fixture:

```sh
PLAYWRIGHT_PORT=4189 TRANSCRIPT_RESULT=/tmp/opencode/provider-activation-after.json bun run benchmark:transcript
```

The config builds `TRANSCRIPT_BENCHMARK=1` production assets and starts its own strict-port preview; it must never restart or reuse an existing application/server. Record the commit and source diff with each artifact. Compare checksums, row/markdown identity, mounted rows, paced/burst event counts, task/script/layout/style duration, latency p50/p95/max, and long tasks. Investigate a regression before completion.

Important existing harness constraint: `TRANSCRIPT_BASELINE` currently asserts a **65% burst CPU improvement and 75% long-task improvement**, not general non-regression (`transcript-performance.spec.ts:145–148`). Do not pass the fresh baseline to that historical optimization target and call its failure an activation regression. Preserve both artifacts and report their measured deltas; agree any new numerical non-regression threshold separately. Existing correctness assertions still run. The transcript benchmark does not itself measure onboarding layout; also inspect the new-session desktop/narrow-screen states and focus behavior.

### Meaningful local tests

Extend current provider/new-session tests for first-load error vs empty, stale ready and stale empty refresh failure, authoritative active-with-zero-connections, connected-but-explicitly-disabled, no-auth, zero-priced/unknown-priced Models, active-with-zero-usable-Models, draft preservation, and pending submit guard. Existing examples are `integration/catalog.test.tsx` (including stale-empty tests), `integration/providers/management.test.ts`, `new-session/controller.test.tsx`, `new-session/route.test.tsx`, and `gateway/models/route.test.tsx`. Add controlled-promise resource tests for in-flight invalidation, reconnect, and disposal. Fakes here establish presentation/concurrency behavior only.

### Real Application, SDK, and browser scenarios

Use `TestApp.make`, public Core/SDK seeding, and a reusable `packages/testing/src/scenario/provider-activation.ts`. Put SDK behavior in `packages/testing/test/provider-activation.test.ts` and real frontend behavior in `packages/web/e2e/application/provider-activation.spec.ts`.

1. Blank installation: login with empty ConfigProvider and no inference Connection; default Bedrock region and bundled definitions leave onboarding visible. An unrelated Tool Integration Connection also leaves it visible.
2. Admin Add provider: exercise the existing real connection dialog with fixture credential, await actual mutation and subsequent reads, assert setup disappears and exact Model identity is selectable. Submit one real conversation with TestLLM, including background title and actual Tool result expectations; assert persisted answer after reload.
3. Explicit disable/enable/automatic: use approved real mutation, assert preserved Connection identity and Model settings, activation status and new-session availability after events and reload. Connection presence cannot override disabled.
4. Deployment Bedrock: exercise explicit enable without secret input or Connection creation; default region alone is inactive and enabled participates without claiming invocation success. Use the existing `scenario/bedrock.ts`/TestBedrock external adapter for invocation coverage where needed. Never use ambient AWS credentials.
5. Member: read real directory, see administrator guidance and no shared activation action; direct real SDK mutation is refused according to the approved authorization contract. Use real membership/account setup and separate authenticated browser contexts.
6. Reconnect and external changes: second actor/SDK changes activation; assert first UI re-reads current state after reconnect and updates only the affected Provider/Model state. Preserve draft text/project and no duplicate session creation.
7. Loading and transient transport failure: gate/abort the actual Provider request at the browser network boundary, then allow the real server response for recovery. Never fulfill fabricated `/api` responses. Assert no false “No providers” message, stale display, actionable Retry, and successful recovery. Most precise request-race permutations remain focused resource tests.

Fixture constraint: `e2e/fixtures/app.ts` is currently typed to `Chat.Data`, defaults to `Chat.make`, and always navigates to a pre-created ready Session. `Chat.make` creates an inference Connection. A genuine blank-onboarding test cannot simply use the default fixture. Minimally extend the real fixture's typed scenario/start-location options or extract its Application/browser acquisition for a dedicated onboarding fixture, with its own concrete data type (no giant optional bag). Reuse its real login, isolated database/storage/cookies, Vite proxy, cleanup, and page-error checks. Do not manufacture `Chat.Data`, construct an alternate Workspace graph, or seed/disconnect just to pretend the initial fixture was blank.

Use role/label/exact identity locators and web-first assertions. Register request/event waits before actions, then assert actual control readiness and outcome. No sleeps, action retries, `.first()` ambiguity fixes, or fake event streams. Pass Vitest test-context `signal` into `Effect.runPromise`; close owned scopes and verify TestLLM expectations. Official Playwright Best Practices, Actionability, Assertions, Locators, Network, and Isolation guides were read for this proposal; the repository's stricter real-Application rules apply.

Run focused affected tests and `bun typecheck` from each owning package. From web run `bun run test:application -- provider-activation.spec.ts`, then the relevant Application suite and `bun run typecheck:application`. From testing run `bun run test -- test/provider-activation.test.ts`. Record results; this design pass has run no source tests or application processes.

## Proposed change tree

```text
docs/specs/provider-activation-web.md                         add now: this proposal
packages/web/src/integration/providers/model.ts              change after approval: projection and refresh correctness
packages/web/src/integration/providers/management.ts         change: activation operation and revalidation
packages/web/src/integration/providers/view.tsx              change: activation status/editor and error states
packages/web/src/integration/providers/browser.tsx           change: supported deployment enable action
packages/web/src/integration/provider-catalog.css            change if needed: activation layout
packages/web/src/new-session/controller.ts                   change: setup access/state and submission readiness
packages/web/src/new-session/view.tsx                        change: setup panel with shared catalog
packages/web/src/new-session/view.css                        change: adjacent panel layout
packages/web/src/gateway/models/model.ts                     change if needed: shared refresh operation
packages/web/src/gateway/models/view.tsx                     change: distinguish Provider/Model empty states
packages/web/src/integration/catalog.test.tsx                change: activation presentation
packages/web/src/integration/providers/management.test.ts    change: write/refresh outcomes
packages/web/src/integration/providers/model.test.ts         add if needed: request races/lifetime
packages/web/src/new-session/controller.test.tsx             change: readiness/draft/submission
packages/web/src/new-session/route.test.tsx                  change: setup presentation
packages/web/src/gateway/models/route.test.tsx               change: management states
packages/testing/src/scenario/provider-activation.ts         add: reusable real setup
packages/testing/test/provider-activation.test.ts            add: real SDK behavior (coordinate backend owner)
packages/web/e2e/fixtures/app.ts                             change only for typed blank-scenario support
packages/web/e2e/application/provider-activation.spec.ts      add: real browser behavior
```

Deletion test: removing the activation projection would duplicate successful-read/empty/stale logic in onboarding and management; it belongs in the existing Provider read owner. Removing a new global Provider context loses nothing because no global context is needed. Existing feature lifetimes remain sufficient. No new Layer composition is required on the frontend; backend Catalog composition belongs to the separate API proposal.

## Approval and reference gaps

The approved implementation uses the local state model, persistent adjacent onboarding panel, admin/member action split, shared Enabled switch, and deployment enable affordance together with the backend contract.

The root guide references `references/domain-design.md` and `references/service-design.md`, but neither exists in this checkout (direct reads and repository search). This proposal follows the available root/package guides and the loaded design/Solid frontend design instructions. Recover those references before implementation/public-service approval if they impose additional requirements.
