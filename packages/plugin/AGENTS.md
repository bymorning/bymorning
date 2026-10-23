# Plugin package agent guide

## Public plugin contract

Use the Promise API for public plugins unless Effect materially improves the implementation:

```ts
import { Plugin } from "@bymorning/plugin"

export default Plugin.define({
  id: "project.example",
  async setup(context) {
    // Await registrations so setup does not finish before they are active.
  },
})
```

- The default package export is the Promise surface in `src/promise/index.ts`. `Plugin.define` preserves the public
  `{ id, setup(context), tui?, configuration? }` shape. `setup` may return a synchronous or Promise cleanup function.
- Effect-native plugins import `Plugin` from `@bymorning/plugin/effect` and define `effect(context)`. The Effect runs in
  the plugin's `Scope`; do not adapt an ordinary Promise plugin manually because the loader does that.
- A loadable module may export the definition as named `plugin` or as `default`; the loader checks `plugin` first.
  Package loading resolves the package's `./server` export first, then its root export. Project entrypoints are exactly
  `plugin/*.ts` and `plugin/*/index.ts`; deeper files are support modules, not independently loaded plugins.
- Plugin IDs must be unique in the active Workspace. Plugin code is trusted, unsandboxed, in-process server code.
- Plugins may declare non-secret Workspace configuration with
  `configuration: { title, description?, fields, optionSets? }`. The host applies field defaults to `context.options`, exposes only
  form metadata and normalized values in inventory, and reloads the plugin after configuration commits. `external`
  and `secret` fields are invalid here; use Integration authentication for credentials.
- Large shared string choices belong in configuration-local `optionSets`, referenced by a string field's `optionsKey`.
  A field cannot declare both `options` and `optionsKey`; every key must resolve in the same configuration. This avoids
  duplicating the same option list across many fields without adding plugin-only concerns to generic form fields.

## Configuration and options

Keep these mechanisms distinct:

- `Config.plugins[].options` configures one loadable Plugin. The Plugin declares its form and receives normalized values
  through `context.options`.
- Top-level Workspace Config fields such as `default_agent`, `websearch`, `mcp`, `gateway`, `providers`, and `routing`
  are application configuration. Core applies Agent, WebSearch, and MCP through internal Config Plugins under
  `packages/core/src/config/plugin/`. Limiter and Provider admission consume `Config.gateway` and
  `Config.providers` from `packages/core/src/plugin/internal/` the same way — not through `plugins[].options`.
  `Config.routing` belongs to the Core `Routing` service.

Adding a top-level application field requires a Schema/Protocol compatibility review and an owning Core-domain
activation seam. Do not put it in an unrelated Plugin's options.

`Config.plugins` accepts operations in these exact forms:

```jsonc
{
  "plugins": [
    "@scope/example@1.2.3",
    "./plugins/local.ts",
    "file:///opt/bymorning/plugin.ts",
    { "package": "example-plugin", "options": { "mode": "strict" } },
    "-example.old",
    "-example.*",
    "*",
  ],
}
```

- A positive string imports a package/local/file target unless it matches a definition already known at that point, is
  a wildcard, or uses the reserved `core.*` or `bymorning.*` ID namespace. `-id`, `-prefix.*`, `*`, and `-*` are ordered
  selectors. Relative paths resolve from the declaring Config document, or from `process.cwd()` for virtual production
  Workspace configuration.
- An object-form configured plugin, including a known built-in ID, receives its `options` as `context.options`. The plugin owns
  validation and should decode the values into its own narrow options type before use. Treat options as non-secret
  activation inputs, never as API keys, OAuth client secrets, access tokens, or refresh tokens.
- Changing a target's options changes its generation and reloads it. Project plugins receive `{}`. A string selector
  enables a known built-in with defaults; an object target configures that built-in.

The schema is `packages/schema/src/config/plugin.ts`; resolution and selector behavior live in
`packages/core/src/plugin/source.ts`, `package.ts`, and `supervisor.ts`.

## Lifecycle and registration

All contributions belong to one plugin activation Scope. Await Promise registrations inside `setup`; registrations
return `dispose()` for early removal. On replacement, removal, reload, or Workspace shutdown, the host closes the old
Scope and removes registrations. Return cleanup only for resources the context did not register, such as a plugin-owned
 timer or socket.

Tool transforms replay in registration order against a fresh editor. The editor supports
`list`, `get`, `namespace`, `add`, `update`, and `remove`; `update` cannot rename a Tool
or move its namespace. Invalid registrations are logged and skipped, while the last valid
snapshot remains active. Names are normalized before duplicate resolution, using upstream
precedence rules. `namespace` records metadata, including an optional description, for the
prepared Code Mode catalog.

`context.tool.transform` returns a scoped registration. Disposing it is idempotent and
reveals earlier active definitions; reload replays transforms without changing precedence.
A prepared snapshot captures definitions and executors at that point in time, plus the
optional Code Mode catalog, but not live credentials or connection availability.

Register integrations inside setup with `context.integration.transform`. Use `editor.update(id, callback)` to create or
update an Integration and `editor.method.update(...)` to register supported `key`, `oauth`, `env`, or `command` methods.
There is no Integration `add`. The public editor can inspect but cannot register host-only `aws-sigv4` or `env-group`
methods. Consult `src/promise/integration.ts`, `src/effect/integration.ts`, and the provider integration docs rather than
copying a large authentication example.

Integration credentials and OAuth client configuration are the secret boundary. Register their forms and callbacks on
the Integration, then have each Tool call `context.integration.connection.active(integrationID)` and resolve that
connection at execution time. Never capture credentials during setup or place secrets in plugin options, metadata,
logs, errors, returned content, snapshots, or assertions.

The public context deliberately has no Effect `HttpClient` capability. Use native `fetch` or a plugin-owned HTTP
dependency. Internal Core plugins may receive injected services through Core composition, but that is not public plugin
API and must not be copied into a package or Project plugin.

## Tools and Permissions

Register Tools with `context.tool.transform((editor) => editor.add(...))`. Prefer sandbox execution when host access is
 unnecessary. A host Tool is an executable `execute(input, context)` callback; there is no host execution discriminator.
Sandbox Tools retain `execution: "sandbox"` and an `implementation`. For each Tool, choose one stable canonical Permission action in `options.permission`; if omitted, the
effective Tool name is the action. A trusted host Tool must call its execution context's `permission(...)` immediately
before the sensitive operation, using the same action and exact resources. Catalog registration does not grant access.

Unmatched Permission requests default to `allow`. A Session approval is once-only; permanent rules are authored only
by Workspace owners or administrators. Inbound MCP cannot present an approval: both `ask` and `deny` fail closed, and
wholly denied Tools are omitted. Do not weaken this behavior or treat plugin trust as Permission approval. See `src/promise/tool.ts`, `src/effect/tool.ts`, `packages/core/src/tool.ts`, and
`packages/server/src/handlers/permission.ts`.

## Policies

The Plugin context does not expose `context.policy`. Contribute policy through lifecycle-scoped inference hooks and the
existing owning authorities. There is no policy manifest, independently managed policy record, or generic built-in
"Policy plugin".

Register Session and Gateway hooks with `context.session.hook` and `context.gateway.hook`:

- `model.request` customizes a request before destination resolution. Session and Gateway keep their own input
  representations. Gateway `model.request` may return `ModelError`. Session `model.request` mutates the draft and cannot
  refuse with `ModelError`.
- `model.invoke` admits the frozen final Model selection. Return `ModelError` to refuse. Any callback may refuse; a later
  callback cannot turn a refusal into an allowance.

Declare `scope: "workspace"` when the Plugin must affect caller-less Gateway inference, and load it through Workspace
configuration. Project-discovered Plugins stay on the member host and cannot declare Workspace scope. Sessions compose
Workspace hooks first and member hooks second. LLM Gateway uses Workspace hooks only.

Permanent Tool permissions are administrator-authored Permission configuration. Catalog registration does not grant
access. Durable company guidance is an Instruction-owned source. Per-request instructions use the Session `context` hook.

First-class `Config.routing` and `Config.providers` are Workspace application configuration. Internal
`bymorning.config.providers` consumes `Config.providers` at hook time, the same Limiter pattern as
`bymorning.limiter` reading `Config.gateway`. Do not duplicate these fields in `plugins[].options`.

`Config.routing` is applied by the Core `Routing` service (`packages/core/src/routing.ts`) before Session and Gateway
`model.request` hooks run, so Plugins observe the routed Model and may still override it. A Plugin cannot rewrite a
request to an Auto name. The judge's own requests use purpose `route` and skip Routing.
`bymorning.config.providers` registers Session and Gateway `model.invoke` and Gateway `model.request`, and refuses a
Provider missing from a present `allow` list. Omitted `providers` or omitted `allow` admits every Provider; empty `allow`
admits none.

The built-in Limiter Plugin registers `model.invoke` callbacks and reads `Config.gateway` activity caps rather than
duplicating those fields in Plugin options. Spend Limits are not a Plugin concern: the edge reserves through Budget by
Holder before any hook runs (Gateway HTTP middleware; the Session Provider decorator), so no Plugin sees or applies them.

Use `src/promise/session.ts`, `src/promise/gateway.ts`, `src/promise/model.ts`, `src/gateway-hooks.ts`, and
`packages/core/src/plugin/hooks.ts` as the source of truth. Do not invent a separate policy loading path.

## Scope and reload behavior

- One registry, host, inventory, hook set, and plugin storage namespace belongs to one Workspace graph. Public plugin
  APIs do not accept a Workspace selector. Project files are project-owned sources, but their code contributions enter
  that Workspace registry and apply across it.
- Config changes, direct changes to configured local entrypoint files, and successful Project writes below `plugin/`
  trigger asynchronous generation reconciliation. Project changes rematerialize the complete `plugin/` subtree.
- Only the directly configured local entrypoint is watched. Package targets and transitive local imports are not
  watched, and plugin invalidation is not cross-process. A newly written Project Tool is available on the next assistant
  execution after reconciliation.

The runtime path is `packages/core/src/plugin/source.ts` -> `supervisor.ts` -> `packages/core/src/plugin.ts` ->
`packages/core/src/plugin/host.ts`. Keep registrations and background work scoped so reload removes every contribution.

## Documentation and verification

Use these authored pages for complete examples and user-visible behavior:

- `packages/docs/src/06-developer-reference/03-plugins.mdx`
- `packages/docs/src/06-developer-reference/04-provider-integration-plugins.mdx`
- `packages/docs/src/06-developer-reference/05-integration-authentication.mdx`
- `packages/docs/src/06-developer-reference/01-permission-model.mdx`
- `packages/docs/src/06-developer-reference/02-policy-language.mdx`
- `packages/docs/src/05-connect/01-inbound-mcp.mdx`
- `packages/docs/src/03-admin/02-workspace-configuration.mdx`

Public types live under `packages/plugin/src/promise/` and `packages/plugin/src/effect/`; runtime truth lives under
`packages/core/src/plugin/`. Keep Promise examples first and verify every field and method against both type and runtime.

- Run tests only from the package that owns them, for example `bun test` in `packages/core`; never run tests at the repo
  root. Exercise real registration/activation boundaries and avoid global mocks.
- Run `bun typecheck` from each changed package, including `packages/plugin` for source changes. Never invoke `tsc`
  directly. Documentation-only changes do not require the plugin typecheck.
- Tests covering credentials must assert redaction across logs, errors, metadata, catalogs, and recorded request
  summaries without snapshotting secret values.
- Run the relevant docs build/link checks only when docs or references change, and always finish with
  `git diff --check`. Preserve unrelated worktree changes.
