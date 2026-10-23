# Model visibility port

Approved: Model Visibility is a personal display preference, independent of enabled state and inference access. Its domain definition is recorded in `CONTEXT.md`.

## Source and boundary

Source: `../opencode` at `4cfca7ab68293f8757f944f0c3953f91f1e03b0b`. The source files were clean at inspection. This ports bundled deprecated-Model exclusion and the web/desktop picker's release/family defaults and explicit show/hide overrides. TUI ordering, recent selections, variants, and `(latest)` label cleanup are outside this boundary.

| Source unit | Target | Adaptation |
| --- | --- | --- |
| `packages/core/src/plugin/models-dev.ts:34–44` | `packages/core/src/model/registry.ts` | Integration: omit deprecated entries when constructing the bundled catalog and execution registry; preserve generated source metadata and validate bindings before filtering. |
| `packages/app/src/providers/models/models.tsx:32–77,89–111` | `packages/web/src/model/visibility.ts` | Path/type: `provider.id`, `modelID`, and `release_date` become `provider`, `id`, and `releaseDate`. Same Luxon 3.6.1 and Remeda operations, memo boundaries, branch ordering, and persistence updates. |
| `packages/app/src/runtime/server/runtime.tsx:101–123` | `packages/web/src/model/visibility.ts`, `context/data/workspace-catalog.ts` | Runtime: use ByMorning's synchronous browser-local persisted store and schema validation. The Data owner shares it between management and picker consumers; remount restores preferences. |
| `packages/app/src/providers/models/select-dialog.tsx` visibility filter | `packages/web/src/ui/components/select-dialog.tsx` | Integration: carry optional `hidden` through Model options and filter at the picker. Selection metadata stays available for current labels, variants, and existing conversations. |
| `packages/app/src/providers/models/manage.tsx` show/hide controls | `packages/web/src/gateway/models/route.tsx` | Integration: add a separately labelled **Show in picker** control beside the existing inference **Enable** control. Management retains older supported Models. |

## Preserved edge behavior

- Only connected, enabled Providers supply the picker's catalog. Workspace inference policy still determines which Models can be selected; personal visibility never changes that policy.
- Explicit hide precedes explicit show, then latest-set membership, then invalid/missing-date fallback.
- `Math.abs(date.diffNow().as("months")) < 6` uses Luxon's default millisecond duration conversion: strictly less than 180 days in either direction, including future dates. It does not compute six calendar months.
- Grouping is Provider then family. Equal release strings preserve the first input entry. Remeda omits undefined family keys, so a dated Model without a family is hidden unless explicitly shown. Invalid dates remain visible.
- Hiding the currently selected Model keeps its identity and variants; it does not issue a selection or inference-policy mutation.
- Preferences are local to this browser, like OpenCode's client-local preferences; they are not synchronized through the server.

## Baseline

- Target: 37 frontend tests and 24 Core tests passed before implementation.
- Source Core test `test/plugin/models-dev.test.ts -t 'omits deprecated models'` could not start because the sibling checkout lacks `@opencode-ai/pty`.
- Source dependency characterization confirmed Luxon's 180-day conversion and Remeda's omission of undefined family groups. No dedicated source frontend visibility tests exist.
- Before changing selection code, the production-build transcript benchmark passed with 5 paced and 5 burst samples over 5,000 transcript entries. Artifact: `/tmp/opencode/model-visibility-before.json`.

## Verification

- Web focused suites: 52 passed across `model/visibility`, `context/data-resources`, `gateway/models/route`, `new-session/controller`, `features/session/selection-controller`, and `features/session/ui/session-selection`.
- Core suites: 24 passed across `model`, `catalog`, `bedrock-binding`, and `model-policy`. All 123 Bedrock candidates remain executable; 46 deprecated entries are omitted (registry 324 → 278). The full Core unit run has 45 failures in 8 plugin/session files (`plugin-activation`, `plugin-supervisor`, `plugin-host`, `session/model-request`, `plugin-scoped`, `project-directory`, `plugin-internal`, `model-routing-plugin`); none reference a removed deprecated Model and their signatures (`context.session.hook` undefined, `ActivationError` mismatches, supervisor batching) belong to the unrelated in-progress plugin refactor in the dirty tree.
- Web `typecheck`: no errors in port files; remaining errors are pre-existing unrelated dirty-tree failures (core `model-policy`/`session-operations`/`session/execution`, server handlers/middleware/workspace-map, `session/screen.tsx`).
- Core `typecheck`: no errors in port files after widening the lifecycle comparison; remaining failures are pre-existing unrelated dirty-tree issues.
- `git diff --check` on port files: clean.
- Production transcript benchmark: before and after runs each passed (5 paced + 5 burst samples, 5,000 entries). Paced latencyP95 16.6 → 16.6ms; burst latencyP95 31.4 → 24.8ms; zero long tasks in both. No selection-code regression. Artifacts: `/tmp/opencode/model-visibility-before.json`, `/tmp/opencode/model-visibility-after.json`.
- Rendered harness (`gateway-nonoverflow-harness`, now with the visibility control): at 1280/768/375 the help text, Show-in-picker and Enable switches render, label-click toggling persists `model-1` in `bymorning.model-visibility` across reload, and `scrollWidth` equals viewport width at every size. Screenshots: `/tmp/opencode/model-visibility-{1280,768,375}.png`.
