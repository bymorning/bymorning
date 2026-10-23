# Plugin Runtime

Google Gmail, Context7, Atlassian, and Slack ship as opt-in packages under `plugins/`. They load only when selected through
Workspace configuration and use the same package path as any other external Plugin.

## Architecture

```text
[Workspace Config row] -------------------------+
                                                |
[Project Storage plugin/] -> [materialization] -+-> [PluginSource] --+
                                                                    |
[PluginPackage] ----------------------------------------------------+-> [PluginSupervisor]
[PluginUpdate] (global registry status) ----------------------------+
                                                                    |
[Catalog and Integration events] -> [PluginComposition] ------------+
                                                                    |
[Internal pre and post definitions] --------------------------------+
                                                                         |
                                                                         v
                                                              [Workspace Plugin registry]
                                                                 |          |
                                                                 v          v
                                                    [Workspace-bound    [Workspace
                                                     PluginHost]         Bus]
                                                         |                |
                                                         v                v
                                                    [Agents, tools,   [plugin.added and
                                                     skills, sessions, plugin.updated]
                                                     storage, hooks,
                                                     and catalogs]
```

Form-configured plugins have an additional synchronous activation path:

```text
[Plugin.configure]
                  |
                  v
       [PluginConfiguration] -> [Workspace Config row]
                  |
                  +-- PluginSupervisor.reloadAfter --> [Plugin registry]
```

```text
Config, local file,       PluginSource          PluginSupervisor       Plugin registry
or Project write               |                       |                      |
    |                           |                       |                      |
    | config.updated, fs.watch, |                       |                      |
    | or project.file.changed   |                       |                      |
    +-------------------------->|                       |                      |
    |                           | change                |                      |
    |                           +---------------------->|                      |
    |                           |                       | sliding queue(1),    |
    |                           |                       | debounce 100 ms      |
    |                           |                       | (initial run is      |
    |                           |                       | immediate)           |
    |                           | read ordered          |                      |
    |                           | snapshot              |                      |
    |                           |<----------------------+                      |
    |                           |                       | resolve and import   |
    |                           |                       | generation           |
    |                           |                       |                      |
    |                           |                       | activate desired     |
    |                           |                       | generation           |
    |                           |                       +--------------------->|
    |                           |                       |                      | close changed suffix,
    |                           |                       |                      | reload it in order
    |<------------------------------------------------------------------------+ publish
    |                           |                       |                        plugin.updated
    |                           |                       | release registry hold|
    |                           |                       | for latest observation
```

## Expected behavior

| Concern        | Current behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope          | One registry, supervisor, hook set, inventory, and set of host services per Workspace graph. A fresh plugin-specific Context is created for each activation. Capabilities and storage are permanently bound to that Workspace; public plugin APIs expose no Workspace selector.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Source         | `PluginSource` merges configured package/local operations with Project Storage entrypoints. Internal definitions are added by the supervisor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Initial load   | Readiness is owned by the registry (`awaitActivation`, `hold`). The supervisor holds it from boot, prepends an initial signal, activates, and releases only after the latest observed generation settles; `PluginActivation.Service.awaitActivation`, `Plugin.awaitActivation`, and `PluginSupervisor.awaitActivation` all delegate to that latch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reload         | Stream-driven Config changes, watched local entrypoint changes, Project deletion and writes below `plugin/`, Integration availability changes, a 24-hour package update check, and package update events each feed a sliding queue of capacity 1 whose consumer debounces by 100 ms; the initial generation activates immediately without that debounce. Integration changes first reload the Catalog so catalog-backed definitions are regenerated. `reloadAfter` serializes an explicit mutation and immediate activation. Only directly configured local entrypoint files are watched.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Reconciliation | IDs must be unique: the supervisor keeps the first occurrence in boot order and reports later duplicates as failed inventory items, so the registry's duplicate defect is only a last-resort guard. A changed generation keeps the unchanged leading prefix alive, closes every slot from the first changed index onward in reverse order, reloads that suffix in desired order, and publishes `plugin.updated` after the batch. State notifications are immediate (coalesced once per batch); terminal registry teardown uses a shutdown batch and suppresses further State notifications. A slot whose setup failed keeps its failed revision in inventory and is not retried until that revision changes; a failed replacement restores its previous loaded generation as a fallback. A configured or Project source whose new revision fails to import keeps its last running generation beside the reported failure. Tool replay keeps the last valid admitted value when an invalid registration is logged and skipped. |
| Failures       | Import and setup failures appear in inventory. An import failure exposes only a safe message plus an `err_<8 hex>` reference; the full cause is logged under that reference. Failed imports do not abort the remaining source operations. Malformed plugin input, such as an Integration method of an unknown or host-owned type or an OAuth method without `authorize`, fails only that plugin's setup with the host's reason; Integration applies a transform when it is registered so the failure cannot surface later for every reader. A generation that fails to apply restores the previous one and is not retried until its sources or revisions change, so readiness settles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Events         | Successful setup publishes `plugin.added`; generation/inventory reconciliation publishes broad `plugin.updated`. Events are process-local Workspace events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Config entries

`Config.Info.plugins` is an optional array. Each item is exactly a string or `{ "package": string, "options"?: Record<string, unknown> }`.

```json
{
  "plugins": [
    "@scope/plugin@1.2.3",
    "./plugins/local.ts",
    "file:///opt/bymorning/plugin.ts",
    { "package": "demo-plugin", "options": { "mode": "strict" } },
    "-core.tool.write",
    "-bymorning.config.*",
    "*"
  ]
}
```

Operations are applied left to right:

| Entry                  | Meaning                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `target`               | Enable a matching known ID, or import `target` as an external source.           |
| `{ package, options }` | Same, with `options` supplied as `context.options`.                             |
| `-id`                  | Disable the exact ID.                                                           |
| `-prefix.*`            | Disable IDs with that prefix.                                                   |
| `*` / `-*`             | Enable all currently known definitions / disable all and clear import failures. |

Reserved `bymorning.*` and `core.*` IDs, wildcards, and already-known targets are selectors, not package imports. A relative `./` or `../` target resolves against the declaring Config document's directory; the production Config row has no document path, so it resolves against `process.cwd()`. `file://` becomes a filesystem path. Absolute targets are stat-revisioned and watched when they are files.

## Loading path and activation order

```text
packages/server/src/workspace-runtime.ts
  WorkspaceRuntime.production(...).factory(owner, key)
    -> packages/core/src/plugin/source.ts
    -> packages/core/src/plugin/project-materializer.ts
    -> packages/core/src/plugin/package.ts
    -> packages/core/src/plugin/supervisor.ts
    -> packages/core/src/plugin.ts
    -> packages/core/src/plugin/host.ts
```

The exact desired order for `PluginInternal.list()` (member host) is internal pre, configured external plugins in first-target declaration order, Project entrypoints in Project creation order then lexical path order, then internal post. Config selectors only toggle membership at their position; re-adding the same external target replaces its definition without moving its map position.

| Phase    | Order and ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre      | `core.provider.bymorning`, `core.provider.openai`, `core.provider.anthropic`, `core.provider.google`, `core.provider.opencode`, `core.provider.fireworks`, `core.provider.amazon-bedrock`, `core.websearch.exa`, `core.websearch.firecrawl`, `core.websearch.parallel`, `core.websearch.tavily`, `bymorning.toolkit`, `core.tool.add`, `core.tool.glob`, `core.tool.grep`, `core.tool.read`, `core.tool.tool-output`, `core.tool.write`, `core.tool.edit`, `core.tool.shell`, `core.tool.execute`, `core.tool.web-fetch`, `core.tool.web-search`, `core.tool.skill`, `core.tool.question`, `core.tool.subagent`, `core.skill.bymorning`, `core.agent.default`, `core.agent.build`, `core.agent.general`, `core.agent.explore` |
| External | Enabled imported Config targets, then discovered Project entrypoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Post     | `bymorning.config.instruction`, `bymorning.config.agent`, `bymorning.config.websearch`, `bymorning.config.code-interpreter`, `bymorning.config.mcp`, `bymorning.mcp.codemode.exclusion`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`PluginInternal.workspace()` is a separate Workspace-scoped host. Caller-less Gateway inference uses it. Member `list()` does not include these invocation plugins.

| Phase | Order and ID |
| ----- | ------------ |
| Pre   | `bymorning.limiter`, `bymorning.config.providers` |
| Post  | none |

## Bymorning Skill

The built-in `core.skill.bymorning` Skill guides the assistant to inspect and update Project-relative plugin files with the existing `read`, `write`, and `edit` Tools. There is no configure or plugin-specific Tool. Entrypoints are immediate `plugin/*.ts` files and `plugin/*/index.ts` files; other files in the subtree are support modules.

After a successful write or edit, `PluginSource` rescans and materializes the complete Project `plugin/` subtree as an immutable, content-addressed generation. Activation is asynchronous: newly registered Tools are available to the next assistant execution after supervisor reconciliation. Project plugin code is trusted, unsandboxed server code and remains subject to the existing file permission flow.

A generation is written beneath the installation's plugin cache (`os.tmpdir()/bymorning/plugins/materialized` in the image), where no `node_modules` ancestor provides `effect` or `@bymorning/plugin`. `PluginSource` therefore calls `Host.expose(cacheRoot)` (`@bymorning/plugin/host`), which registers in-thread `module.registerHooks` for imports whose parent lies beneath that root: bare specifiers in the runtime table resolve to a generated shim re-exporting the host's own module instance; any other bare specifier resolves as the host module itself would. The application bundle build emits the table as `virtual:bymorning-plugin-runtime` (`effect`, every runtime module of `@bymorning/plugin`, every `@bymorning/schema` module); outside the bundle the table is empty and the fallback resolves from the repository's `node_modules`. Each generation also carries a `package.json` declaring ESM so Node reads the `.ts` entrypoints as modules wherever the cache lives. A load failure's inventory `error` carries the loader's own class and message with the generation path mapped back to `plugin/` and every other filesystem path redacted; a value thrown by plugin code contributes only its class, and `ref` correlates with the server log.

The Installation Policy lock applies on this load path, not only to the `Config.get` view: a configured target an allowlist or `share: "off"` drops is reported as `failed` with `Blocked by Installation Policy`, and `plugins: "off"` additionally keeps every Project entrypoint unmaterialized and reports it the same way. An allowlist names package targets and does not restrict Project entrypoints.

## Module contract

Effect module:

```ts
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect } from "effect"

export const plugin = define({
  id: "example.plugin",
  effect: (context) => Effect.log(`mode=${context.options.mode}`),
})
```

Promise modules use `define` from `@bymorning/plugin/promise/plugin` and a `setup(context)` method that may return cleanup. The loader checks named `plugin` first, then `default`, and accepts either `{ id, effect }` or `{ id, setup }`. Setup runs in a child Scope; plugin cleanup/finalizers run on replacement, removal, or Workspace shutdown. Plugin code is trusted and runs in-process.

The public Context exposes `app`, `location`, `options`, `agent`, `aisdk`, `catalog`, `command`, `event`, `gateway`, `integration`, `instruction`, `mcp`, `plugin`, `policy`, `reference`, `session`, `shell`, `skill`, `storage`, `tool`, and `websearch`. Core creates a fresh Context for each plugin activation from the Workspace-bound host services. Storage is namespaced by Workspace and plugin ID.

## Configuration lifecycle

A plugin may declare non-secret form configuration with `configuration: { title, description?, fields, optionSets? }`.
Core applies defaults and normalized values to `context.options`, and inventory exposes the resolved metadata, values,
and `configured` state.

`Plugin.configure` accepts a `Form.Answer` and returns the updated `Plugin.Info`. `PluginConfiguration` validates the
definition, source, field names, and answer; persists the Workspace Config mutation under `PluginSupervisor.reloadAfter`;
activates it; and verifies the resulting inventory. If activation or verification fails after persistence, it rolls back
the Config mutation and reconciles again. Built-in, package, and local plugins can be configured this way; Project and
schema-reserved SDK sources cannot.

## Package resolution

1. Derive the package name from a possibly versioned target.
2. Resolve `<name>/server`, then `<name>`, from the process `package.json`.
3. If absent, create `~/.cache/bymorning/plugins/<encodeURIComponent(target)>`.
4. Run `bun add --ignore-scripts --cwd <cache> <target>`.
5. Resolve `<name>/server`, then `<name>`, from that cache.

The inventory records the installed package version. `PluginUpdate` checks mutable package targets with `bun pm view`, caches the result for 24 hours, and installs updates into the same cache directory before the Workspace supervisor reloads. `PluginPackage` continues to own package resolution; update status is a global input projected onto each Workspace inventory.

Local modules import by file URL. Reload uses the local mtime as a cache buster (an absolute import path under Bun, a file-URL query otherwise). Package targets are not watched or mtime-revisioned. `Host.resolve` resolves package `server` before its root entrypoint and separately discovers `tui`; `Host.load` imports the selected entrypoint.

## Inventory and API

| Surface                                           | Result                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Plugin.Service.list()` / `context.plugin.list()` | Current Workspace inventory                                                                                                                                         |
| `Plugin.configure`                                | Validates, persists, activates, and returns the updated `Plugin.Info`                                                                                               |
| `Plugin.check`                                    | Checks one installed package target and returns the refreshed `Plugin.Info[]`                                                                                       |
| `Plugin.update`                                   | Updates one installed package target, reloads it, and returns the refreshed `Plugin.Info[]`                                                                         |
| Active item                                       | `{ id, source, status: "active", tui, configuration? }`                                                                                                             |
| Failed item                                       | `{ id?, source, status: "failed", error, ref?, tui, configuration? }`; `ref` correlates a redacted load failure with its `failed to load plugin` log entry          |
| Package source                                    | `{ type: "package", package, version?, outdated?, updating? }`; `outdated` means a newer registry revision is available and `updating` marks an in-progress install |
| Source                                            | `builtin`, `package`, `local`, `project`, or schema-reserved `sdk`                                                                                                  |

## Package updates

`Plugin.check(target)` and `Plugin.update(target)` operate only on a package source in the current Workspace inventory. Check refreshes its `outdated` projection; update installs the selected target and reloads the Workspace from the installed revision. Both return the fresh inventory. Startup with `installPackage: false` disables updates.

## Limitations and status

| Item                                                                            | Status                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configured package/local loading, selectors, options, reload, failure inventory | Implemented and covered by focused Core tests                                                                                                                                                                                        |
| Project authoring                                                               | `core.skill.bymorning` uses the existing `read`, `write`, and `edit` flow; no configure or plugin-specific Tool is exposed.                                                                                                          |
| Local reload                                                                    | Watches only the configured entrypoint, not transitive imports; no package watch or cross-process invalidation.                                                                                                                      |
| Project plugin authoring/discovery                                              | Implemented with Workspace-wide discovery from Project Storage, immutable complete-subtree generations, and successful-write invalidation.                                                                                           |
| Web catalog refresh                                                             | `DataProvider` consumes `plugin.added` and `plugin.updated`, then invalidates and synchronizes the Workspace Agent, Provider, Model, and Skill catalogs. |
| Isolation                                                                       | Workspace capability isolation, not a security sandbox; package cache and process filesystem/runtime remain shared.                                                                                                                  |

## Registering an internal plugin

Internal plugins are static definitions. Use `define(...)` and export a descriptive name such as
`WebSearchToolPlugin`; config plugin modules conventionally export `Plugin` and are imported under a namespace such as
`ConfigInstructionPlugin.Plugin`. Keep vendor integrations in opt-in packages under `plugins/`. Never add a plugin
factory merely to inject a service or configuration value. Do not inject services or configuration positionally,
manually invoke `plugin.effect(...)` as a DI or test seam, or bypass normal `Plugin.Service` registry activation.

`Plugin.load` intentionally isolates the plugin Effect context. `plugin/internal.ts` bridges that isolation
declaratively: a `services` tuple names every Workspace service an internal definition may yield, `Requirements` is
derived from it, and `InternalPlugin = Plugin<Requirements | Instructions | Scope.Scope>` is the type each entry of the
`pre` and `post` arrays must satisfy (`as const satisfies readonly InternalPlugin[]`). `PluginInternal.list()` captures
exactly those services once with `Context.pick(...services)` (plus the Workspace-bound `Instructions` value), then
spreads each definition and wraps only `effect` with `Effect.provide(context)` so identity, `tui`, and `configuration`
are retained. There are no hand-written per-plugin wrappers: yielding a service that is not in `services` is a type
error at the array, and adding a service means adding it to `services` and to `PluginSupervisor.node` deps. Workspace
layers are supplied once by `PluginSupervisor`; a shared service such as `Mcp.Service` owns one coordinator for the
workspace across internal reloads. `PluginInternal.workspace()` captures `Limiter.Service` and `Config.Service` instead
of the member `services` tuple. Its pre list is the always-on Workspace invocation plugins
(`bymorning.limiter`, `bymorning.config.providers`); post is empty.
They consume `Config.gateway` and `Config.providers` at hook time rather than
`plugins[].options`. They are not member `list()` entries. `Config.routing` is applied by the Core
`Routing` service before `model.request` hooks run, not by a Plugin.

Register product definitions in the `pre` array in `plugin/internal.ts`; register Config adapters and their
catalog-driven followers in `post`. Workspace Config projection runs through the owning domain adapters under
`config/plugin/`; these adapters belong in `post` so persisted selections override ordinary Plugin defaults.
Activation order is pre, external, post, and array order is significant. Selectors may exclude any built-in, so do not
rely on another definition merely being earlier in the list.

Transforms, background streams, and resources must be scoped to the plugin activation. Use scoped transforms,
`forkScoped`, and finalizers so replacement, deactivation, reload, and Workspace shutdown remove contributions and
close resources. A shared workspace service may outlive one activation, but each contribution must clean itself up.

Tests override explicit services with Layers and activate the static definition through the plugin host. Do not add
production callbacks, test-only branches, positional injection, plugin factories, direct `plugin.effect(...)` calls,
registry bypasses, or global mocks. Tests should resolve the captured internal definition through
`PluginInternal.list()` and activate it with `Plugin.Service`, exercising the same isolation bridge as production.

Checklist:

- Add the static definition and focused activation/cleanup tests.
- Register it in the correct `pre` or `post` position in `plugin/internal.ts`.
- Add any newly yielded Workspace service to the `services` tuple in `plugin/internal.ts` and to the supervisor node deps.
- Update exact inventory/order assertions in `test/plugin-internal.test.ts`.
- Run focused plugin tests plus `plugin-internal.test.ts` and `plugin-supervisor.test.ts`, then core formatting, lint,
  diff check, and `bun typecheck` from `packages/core`.
