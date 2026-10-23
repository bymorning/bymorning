# Plugin Specs Index

## Status

The upstream parity port supersedes spec 01 in part (readiness and prefix reconciliation), spec 03 (not applicable), and spec 05 in full. The port includes upstream commits `e0c0d5691d`, `36095decd7`, `09b0edd662`, `d4b4dd17cc`, and `ed3259a9b7`.

Seven architecture specs against `packages/core/src/plugin` and `packages/plugin`. Every spec uses the
nine-section template (Summary, Current shape, Proposed interface, Implementation sketch, Caller migration,
Tests, Preserved behavior, Open decisions, Sequencing).

| Spec | One-line summary | Strength |
| --- | --- | --- |
| [01-generation-pipeline](01-generation-pipeline.md) | Fold `PluginSource` + `PluginSupervisor` + the `Plugin` registry into one deep Workspace-scoped `PluginGeneration` Module (`flush` / `reloadAfter` / `list`). | 🟢 Ready — full evidence, byte-level preservation tables, two-step safe rollout |
| [02-config-replay-plugins](02-config-replay-plugins.md) | Delete the six `bymorning.config.*` replay pseudo-plugins; Agent/WebSearch/Catalog/GatewayConfig absorb their own Config projection. | 🟢 Ready — every delete backed by a live read of Config at the owning domain |
| [03-configuration-normalization](03-configuration-normalization.md) | Consolidate the three divergent plugin-configuration paths into one pure `PluginConfiguration` Module (resolve / activate / submit / inventory). | 🟢 Ready — pure functions, exact error-message pins, standalone by construction |
| [04-effect-promise-mirroring](04-effect-promise-mirroring.md) | Stop hand-copying `packages/plugin` types: re-export pure payloads, derive Effect-carrying ones with `Promisify`, keep semantic overrides explicit. | 🟡 Solid — scoped recommendation with compile-time parity pins; `any`-cleanup and client-projection convergence deliberately deferred |
| [05-internal-composition](05-internal-composition.md) | Replace `internal.ts` hand-wrapping with declarative `{ phase, plugin }` entries plus one `compose` that provides captured authorities, typed by the definition's `R`. | 🟢 Ready — order is pinned by an explicit test; compile-time missing-authority errors |
| [06-inference-hook-pipeline](06-inference-hook-pipeline.md) | Concentrate the physical inference hook pipeline (`model.request` → `context` → `http.*`) into one `SessionInference` Module with one error model. | 🟡 Solid — requires sign-off on deliberate divergences (context-hook defect policy, HTTP-hook retriability) |
| [07-plugin-host-surface](07-plugin-host-surface.md) | Split Integration/Tool projections out of `host.ts` into per-domain Adapters with a nested `HostServices`. | 🔴 Gated — spec argues itself into "do not do this now"; execute only if its trigger conditions fire after 04/05 |

## Dependencies between specs

- **03 → 01.** `PluginGeneration` (01) becomes the caller of `PluginConfiguration` (03): its `load` calls
  `activationOptions`, its inventory path calls `inventoryConfiguration`, and `configure` swaps
  `PluginSupervisor.Service` for `PluginGeneration.Service` once 01 lands. 03 is standalone until then.
- **01 + 03 share `plugin.ts` / `plugin/configuration.ts`.** 03 rewrites the activation block and
  `configurationInfo` inside `plugin.ts`; 01 deletes the surrounding `layer`/`workspaceNodes`. Land 03 first;
  01 absorbs the call sites into `generation.ts` using 03's names verbatim (`flush`, `reloadAfter`, `list`,
  `ActivationError`, tag `@bymorning/PluginGeneration`).
- **02 ↔ 05 both rewrite `plugin/internal.ts`.** 05's `declarations` array is drawn against pre-02 code; its
  `declarations` comment and Open decision 5 define the post-02 shape (six `Config*Plugin` entries gone,
  `GatewayConfig` entry dropped if the gateway was absorbed, `capture` keeps `Config.Service`). Land 02 before
  05, or apply 05's Open decision 5 when landing 05 first.
- **02 ← 01 (selector resolution).** 02's stale-selector argument cites `supervisor.ts` resolution, which 01
  moves verbatim into `PluginGeneration`; 02 notes this and its citations refer to the pre-01 home.
- **05 → 01 (composition Seam).** 01 consumes `PluginComposition.definitions`/`changes` as its `internal`
  Seam; 05 preserves both signatures, so the two compose without edits.
- **04 → 07.** 07's verdict sequences this spec after 04 (and 05); 04 itself leaves `host.ts` untouched, so
  no conflict — 07 only proceeds if its triggers fire afterwards.
- **06 is independent.** It touches the Session inference pipeline only (`session/*`, `session-operations.ts`,
  `plugin/hooks.ts` callers); no shared files with 01–05, 07. `PluginHooks` itself stays untouched, so 07's
  `HostServices.shellHooks` projection is unaffected.

## Suggested execution order

1. **03 — configuration normalization** (pure, no behavior change, zero shared-file risk).
2. **02 — config replay removal** (pre-05 `internal.ts` shape; update post-ID assertions).
3. **05 — internal composition** (apply its Open decision 5 to drop the entries 02 deleted).
4. **01 — generation pipeline** (folds the three Modules; consumes 03's `PluginConfiguration` and 05's
   composition Seam; moves selector resolution).
5. **06 — inference hook pipeline** (independent; approve its divergences first).
6. **04 — promise mirroring** (type-level; independent of the core plugin files).
7. **07 — host surface** (only if its trigger conditions hold after 04 and 05).
