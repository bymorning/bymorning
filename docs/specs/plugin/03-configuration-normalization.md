# 03 — Configuration Normalization: one Module for definition resolution, options validation, and inventory projection

## 1. Summary

The same plugin configuration definition and options are processed three times today with subtle differences: the
configure command validates strictly (rejecting unknown keys before persisting), activation validates permissively
(validating declared defaults, silently dropping unknown keys, and marking option-set fields `custom`), and the
inventory projection silently omits configuration it cannot resolve. This spec consolidates all three into one pure
Module — `PluginConfiguration` — with exactly four synchronous entry points plus the existing `configure` command, so
the validation vocabulary (defaults, option sets, `optionsKey`, unknown keys, raw fallback) has one implementation and
one test surface. The Module is standalone; `PluginGeneration` (see `01-generation-pipeline.md`) becomes its caller,
not its owner.

## 2. Current shape

### The definition resolver — `packages/core/src/plugin/configuration-definition.ts` (18 lines)

```ts
// configuration-definition.ts:6-7
type Resolution =
  { readonly error: string } | { readonly definition: Plugin.ConfigurationDefinition; readonly fields: Form.Field[] }

// configuration-definition.ts:10-18
export function resolveConfigurationDefinition(input: unknown): Resolution {
  const definition = Schema.decodeUnknownOption(Plugin.ConfigurationDefinition)(input)
  if (definition._tag === "None") return { error: "Plugin configuration cannot contain external or secret fields" }
  const fields = Plugin.resolveFields(definition.value.fields, definition.value.optionSets)
  const error =
    Plugin.validateOptionSets(definition.value.fields, definition.value.optionSets) ?? validateFields(fields)
  if (error !== undefined) return { error }
  return { definition: definition.value, fields }
}
```

Callers: `plugin.ts:17` (activation + inventory) and `configuration.ts:8` (configure command). Nothing else imports it.

### Call site 1 — activation (`plugin.ts:73-98`, inside `load`; dies at 100-102)

```ts
// plugin.ts:73-98
const configuration =
  plugin.configuration === undefined ? undefined : resolveConfigurationDefinition(plugin.configuration)
const fields = configuration !== undefined && !("error" in configuration) ? configuration.fields : undefined
const submitted =
  fields === undefined ? undefined : Schema.decodeUnknownOption(Form.Answer)(plugin.options ?? {})
const normalized = fields
  ? Form.normalize(fields, {
      ...Form.defaults(fields),
      ...(submitted?._tag === "Some" ? submitted.value : {}),
    })
  : undefined
const options = normalized ?? plugin.options ?? {}          // raw fallback when no valid fields
const configurationError =
  configuration !== undefined && "error" in configuration
    ? configuration.error
    : fields === undefined
      ? undefined
      : submitted?._tag === "None"
        ? "Plugin configuration options must be form values"
        : (Form.validate(fields, Form.defaults(fields)) ??    // validates the DECLARED defaults
          Form.validate(
            fields.map((field) =>
              field.type === "string" && "optionsKey" in field ? { ...field, custom: true } : field,  // permissive
            ),
            normalized ?? {},
          ))
// plugin.ts:100-102 — configurationError === undefined ? plugin.effect(...) : Effect.die(new Error(configurationError))
```

Differences from configure: unknown keys in `plugin.options` are silently dropped (`Form.normalize` keeps only
declared field keys — schema/form.ts:154-162), option-set string fields are re-marked `custom: true` so any value
activates, and the definition's declared defaults are validated first. Errors become defects that surface as failed
inventory rows (plugin.ts:173-180).

### Call site 2 — configure command (`plugin/configuration.ts:22-69`)

```ts
// configuration.ts:33-42
const configuration = resolveConfigurationDefinition(current.configuration)
if ("error" in configuration) return yield* new InvalidError({ message: configuration.error })
const unknown = Object.keys(payload).find((key) => !configuration.fields.some((field) => field.key === key))
if (unknown !== undefined) return yield* new InvalidError({ message: `Unknown form field: ${unknown}` })   // pre-normalize
const normalized = Form.normalize(configuration.fields, {
  ...Form.defaults(configuration.fields),
  ...payload,
})
const invalidAnswer = Form.validate(configuration.fields, normalized)                                       // strict
if (invalidAnswer !== undefined) return yield* new InvalidError({ message: invalidAnswer })
```

Differences from activation: unknown keys are rejected explicitly (before `Form.normalize` can hide them), no
`custom` re-marking (option sets are enforced), no declared-defaults pre-check. Errors are tagged failures
(`InvalidError`, configuration.ts:12-14), not defects. The command then persists + activates via
`supervisor.reloadAfter` (configuration.ts:44-53), verifies inventory (54-63), and rolls back on failure (66-68).

### Call site 3 — inventory projection (`plugin.ts:336-364`, called from 168-172 and 326)

```ts
// plugin.ts:341-343 — silently omitted when the definition cannot be resolved
if (configuration === undefined) return
const resolution = resolveConfigurationDefinition(configuration)
if ("error" in resolution) return
// plugin.ts:345-349 — raw configured options decoded; decode failure ignored (defaults only)
const submitted = Schema.decodeUnknownOption(Form.Answer)(configured ?? {})
const options = Form.normalize(fields, {
  ...Form.defaults(fields),
  ...(submitted._tag === "Some" ? submitted.value : {}),
})
// plugin.ts:353-363 — redaction: drop secret fields and non-primitive values
values: Object.fromEntries(
  Object.entries(options).filter(
    ([key, value]) =>
      fields.some((field) => field.key === key && !(field.type === "string" && field.secret)) &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))),
  ),
),
```

### Supporting modules (read, unchanged)

- `packages/schema/src/plugin.ts:26-83` — `OptionSets` (26-29), `ConfigurationStringField` with `secret:
  Schema.Literal(false)` and `optionsKey` (31-36), the `ConfigurationField` union (38-45), `ConfigurationDefinition`
  (52-58), `Configuration` inventory shape (61-66), `resolveFields` copying option sets into field `options` (69-74),
  and `validateOptionSets` declaration checks (77-83).
- `packages/schema/src/form.ts` — `defaults` returns non-secret declared defaults (143-151), `normalize` drops
  unanswered, inactive, and empty-string values (154-162), `validate` rejects unknown keys first then enforces
  active/required/per-type constraints and closed option lists (165-229; unknown-key message at 167).
- `packages/core/src/form.ts:263-285` — `validateFields`: declaration-time structural validation (duplicate keys,
  secret defaults/multiline, `when` references) used by the resolver.
- `Form.Answer` = `Record<string, Value>` where `Value` is string | number | boolean | string[] (schema/form.ts:118-126);
  raw activation options are `PluginOptions = Readonly<Record<string, unknown>>` (`@bymorning/plugin/options`).

## 3. Proposed interface

One Module, `packages/core/src/plugin/configuration.ts` (the existing file, extended). `configuration-definition.ts`
is deleted. **External**: `resolveDefinition`, `activationOptions`, `normalizeSubmission`, `inventoryConfiguration`,
`configure`, `InvalidError`, `ActivationError`. **Internal**: the shared normalization steps (single-use, inlined
below the exports per style).

```ts
// packages/core/src/plugin/configuration.ts
export * as PluginConfiguration from "./configuration.js"

import { Form } from "@bymorning/schema/form"
import { Plugin } from "@bymorning/schema/plugin"
import { Effect, Exit, MutableRef, Schema } from "effect"
import { validateFields } from "../form.js"
import { Config } from "../config.js"
import { Plugin as PluginRegistry } from "../plugin.js"
import { configurationTarget } from "./source-target.js"

export class InvalidError extends Schema.TaggedError<InvalidError>()("PluginConfiguration.InvalidError", {
  message: Schema.String,
}) {}

export class ActivationError extends Schema.TaggedError<ActivationError>()(
  "PluginConfiguration.ActivationError",
  {},
) {}

/** A configuration definition decoded and resolved into ordinary form fields. */
export interface Definition {
  readonly definition: Plugin.ConfigurationDefinition
  readonly fields: ReadonlyArray<Form.Field>
}

export type Resolved = Definition | { readonly error: string }

/** Decode and resolve the one configuration-definition shape accepted by Core. Synchronous. */
export const resolveDefinition = (input: unknown): Resolved => { /* §4 */ }

/** Options handed to one plugin activation: a declared configuration is form-validated; otherwise raw. Synchronous. */
export const activationOptions = (input: {
  readonly configuration?: unknown
  readonly options?: Readonly<Record<string, unknown>>
}): { readonly options: Readonly<Record<string, unknown>> } | { readonly error: string } => { /* §4 */ }

/** Reject unknown keys, apply declared defaults, and validate one submitted configuration payload. Synchronous. */
export const normalizeSubmission = (
  resolved: Definition,
  payload: Form.Answer,
): { readonly options: Form.Answer } | { readonly error: string } => { /* §4 */ }

/** Project the redacted inventory configuration for one plugin inventory row, or omit it. Synchronous. */
export const inventoryConfiguration = (input: {
  readonly configuration?: unknown
  readonly options?: Readonly<Record<string, unknown>>
  readonly configured?: boolean
}): Plugin.Configuration | undefined => { /* §4 */ }

/** Persist, activate, and verify one form-configured Workspace plugin. */
export const configure = Effect.fn("PluginConfiguration.configure")(function* (
  pluginID: Plugin.ID,
  payload: Form.Answer,
) { /* §4; supervisor dependency becomes PluginGeneration.Service when 01 lands */ })
```

### Where it lives

**Standalone** (`plugin/configuration.ts`), not inside `PluginGeneration`. The Module is pure — it performs no
effectful work, so its helpers stay synchronous per the style rules — and it has three callers across two Modules:
`PluginGeneration` (activation options + inventory projection) and the `configure` command (reached from
`handlers/plugin.ts:12-20`). Folding it into `PluginGeneration` would either widen `PluginGeneration.Interface` with
three more members or force `configure` to reach into generation internals; either is shallower than a standalone
Module whose interface is exactly the configuration vocabulary. `01-generation-pipeline.md` composes with this spec:
its `load` and inventory paths call `activationOptions` and `inventoryConfiguration`, and `configure`'s
`PluginSupervisor.Service` dependency becomes `PluginGeneration.Service`.

## 4. Implementation sketch

```ts
export const resolveDefinition = (input: unknown): Resolved => {
  const definition = Schema.decodeUnknownOption(Plugin.ConfigurationDefinition)(input)
  if (definition._tag === "None") return { error: "Plugin configuration cannot contain external or secret fields" }
  const fields = Plugin.resolveFields(definition.value.fields, definition.value.optionSets)
  const error =
    Plugin.validateOptionSets(definition.value.fields, definition.value.optionSets) ?? validateFields(fields)
  if (error !== undefined) return { error }
  return { definition: definition.value, fields }
}

export const activationOptions = ({ configuration, options }: {
  readonly configuration?: unknown
  readonly options?: Readonly<Record<string, unknown>>
}) => {
  // No declared configuration: raw options pass through untouched (project plugins receive {}).
  if (configuration === undefined) return { options: options ?? {} }
  const resolved = resolveDefinition(configuration)
  if ("error" in resolved) return { error: resolved.error }
  const submitted = Schema.decodeUnknownOption(Form.Answer)(options ?? {})
  if (submitted._tag === "None") return { error: "Plugin configuration options must be form values" }
  const normalized = Form.normalize(resolved.fields, {
    ...Form.defaults(resolved.fields),
    ...submitted.value,
  })
  // Configuration-local option sets are snapshots resolved at definition time; activation must accept values a
  // refreshed catalog would no longer list, so option-set string fields validate as `custom` here only.
  const invalid =
    Form.validate(resolved.fields, Form.defaults(resolved.fields)) ??
    Form.validate(
      resolved.fields.map((field) =>
        field.type === "string" && "optionsKey" in field ? { ...field, custom: true } : field,
      ),
      normalized,
    )
  if (invalid !== undefined) return { error: invalid }
  return { options: normalized }
}

export const normalizeSubmission = (resolved: Definition, payload: Form.Answer) => {
  // Rejected before normalize: Form.normalize drops unknown keys, so post-normalize validation cannot see them.
  const unknown = Object.keys(payload).find((key) => !resolved.fields.some((field) => field.key === key))
  if (unknown !== undefined) return { error: `Unknown form field: ${unknown}` }
  const options = Form.normalize(resolved.fields, {
    ...Form.defaults(resolved.fields),
    ...payload,
  })
  const invalid = Form.validate(resolved.fields, options)
  if (invalid !== undefined) return { error: invalid }
  return { options }
}

export const inventoryConfiguration = ({ configuration, options, configured }: {
  readonly configuration?: unknown
  readonly options?: Readonly<Record<string, unknown>>
  readonly configured?: boolean
}) => {
  if (configuration === undefined) return undefined
  const resolved = resolveDefinition(configuration)
  // Unresolvable definitions are omitted from inventory instead of failing the row.
  if ("error" in resolved) return undefined
  const submitted = Schema.decodeUnknownOption(Form.Answer)(options ?? {})
  const values = Form.normalize(resolved.fields, {
    ...Form.defaults(resolved.fields),
    ...(submitted._tag === "Some" ? submitted.value : {}),
  })
  return {
    ...resolved.definition,
    configured: configured ?? false,
    values: Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          resolved.fields.some((field) => field.key === key && !(field.type === "string" && field.secret)) &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            (Array.isArray(value) && value.every((item) => typeof item === "string"))),
      ),
    ),
  }
}
```

`configure` rewritten onto the Module (supervisor dependency renamed for the 01 composition):

```ts
export const configure = Effect.fn("PluginConfiguration.configure")(function* (
  pluginID: Plugin.ID,
  payload: Form.Answer,
) {
  const plugins = yield* PluginRegistry.Service
  const current = (yield* plugins.list()).find((plugin) => plugin.id === pluginID && plugin.configuration !== undefined)
  if (current?.configuration === undefined)
    return yield* new InvalidError({ message: `Plugin is not configurable: ${pluginID}` })
  if (configurationTarget(current.source, pluginID) === undefined)
    return yield* new InvalidError({ message: `Plugin source is not Workspace-configurable: ${pluginID}` })

  const resolved = resolveDefinition(current.configuration)
  if ("error" in resolved) return yield* new InvalidError({ message: resolved.error })
  const normalized = normalizeSubmission(resolved, payload)
  if ("error" in normalized) return yield* new InvalidError({ message: normalized.error })

  const config = yield* Config.Service
  const generation = yield* PluginGeneration.Service
  const compensation = MutableRef.make<Config.PluginCompensation | undefined>(undefined)
  const activation = yield* generation
    .reloadAfter(
      config.plugin
        .configure(current.source, pluginID, normalized.options)
        .pipe(Effect.tap((value) => Effect.sync(() => MutableRef.set(compensation, value)))),
    )
    .pipe(Effect.exit)
  const configured = Exit.isSuccess(activation)
    ? (yield* plugins.list()).find(
        (plugin) =>
          plugin.id === pluginID &&
          plugin.status === "active" &&
          plugin.configuration?.configured === true &&
          Schema.toEquivalence(Plugin.Source)(plugin.source, current.source) &&
          Schema.toEquivalence(Form.Answer)(plugin.configuration.values, normalized.options),
      )
    : undefined
  if (configured !== undefined) return configured

  const committed = MutableRef.get(compensation)
  if (committed !== undefined) yield* generation.reloadAfter(committed.rollback).pipe(Effect.ignore)
  return yield* new ActivationError()
})
```

## 5. Caller migration

| Call site (current) | Today | After |
| --- | --- | --- |
| `core/src/plugin.ts:73-98` (activation block inside `load`; moves to `generation.ts` when 01 lands) | inline resolve/decode/normalize/validate with custom-marking and raw fallback | `const configured = PluginConfiguration.activationOptions({ configuration: plugin.configuration, options: plugin.options })` then `"error" in configured ? Effect.die(new Error(configured.error)) : plugin.effect(PluginHost.make({ …, plugin: registry }, plugin.id, configured.options, plugin.source))` |
| `core/src/plugin.ts:336-364` (`configurationInfo`, called at 168-172 and 326) | inline resolve/normalize/redact | `PluginConfiguration.inventoryConfiguration({ configuration: definition.configuration, options: definition.options, configured: definition.configured })`; the function is deleted |
| `core/src/plugin/configuration.ts:33-42` | inline resolve + unknown-key check + normalize + validate | `resolveDefinition` + `normalizeSubmission` (§4) |
| `core/src/plugin.ts:17` | `import { resolveConfigurationDefinition } from "./plugin/configuration-definition.js"` | import removed (call sites replaced); the file is deleted |
| `core/src/plugin/configuration.ts:8` | same import | removed (`resolveDefinition` is local) |
| `core/src/plugin/configuration.ts:10,45` | `PluginSupervisor` (supervisor-service) | unchanged until 01 lands; then `PluginGeneration.Service` |
| `server/src/handlers/plugin.ts:12-20` | `PluginConfiguration.configure(…)` | unchanged |

## 6. Tests

| Existing test file | Decision |
| --- | --- |
| `core/test/plugin-configuration.test.ts` (250) | Keep. All seven behaviors survive unchanged (persist+activate, defaults normalization, unknown-key rejection without persist or reload, rollback on activation failure, rollback on stale inventory, dangling option sets, values outside option sets, dual options declaration). The fake supervisor (218-247) swaps tag to `PluginGeneration.Service` when 01 lands. |
| `core/test/plugin-supervisor.test.ts` / `plugin-generation.test.ts` | Keep the configuration-error assertions that ride the real activation path (a declared-configuration defect surfaces as a failed inventory row). |
| `core/test/plugin-scoped.test.ts` | Add a case: a `Generation` with invalid declared defaults fails to load and produces the failed inventory row (drives `activationOptions` through the real reconciliation). |
| `core/test/plugin-host.test.ts` | Keep unchanged (host renders `configuration` only from inventory rows). |

New test cases (pure functions — the real implementation with no layers):

| Name | Assertion |
| --- | --- |
| "activationOptions passes raw options through when no configuration is declared" | `{ options: { anything: { nested: true } } }` round-trips without `Form.Answer` decoding. |
| "activationOptions rejects non-form values" | A declared configuration with a non-`Form.Value` option yields `"Plugin configuration options must be form values"`. |
| "activationOptions applies declared defaults, drops unknown keys, and accepts stale option-set members" | Defaults merge in; undeclared keys vanish; an `optionsKey` value absent from the declared set still activates. |
| "activationOptions rejects invalid declared defaults" | A default outside the field's options fails with `Form.validate`'s message. |
| "normalizeSubmission rejects unknown keys before any effect runs" | Error is `"Unknown form field: typo"`; nothing else is consulted. |
| "normalizeSubmission enforces declared option sets strictly" | A value outside the set yields `"Invalid option for form field: …"` (contrast with activation). |
| "inventoryConfiguration omits unresolvable definitions and projects only resolved values" | A definition failing `resolveDefinition` (e.g. dangling `optionsKey`) yields `undefined`; a valid one projects defaults into `values` with `configured` from the flag — schema-level `secret: Literal(false)` makes unresolvable omission the secret guard. |

Representative new tests as code:

```ts
// core/test/plugin-configuration.test.ts (appended)
describe("PluginConfiguration.pure", () => {
  it("activationOptions applies declared defaults, drops unknown keys, and accepts stale option-set members", () => {
    const resolved = PluginConfiguration.activationOptions({
      configuration: {
        title: "Routing",
        fields: [
          { key: "mode", type: "string", default: "auto", options: [{ value: "auto", label: "Auto" }] },
          { key: "target", type: "string", optionsKey: "destinations" },
        ],
        optionSets: { destinations: [{ value: "anthropic/target", label: "Target" }] },
      },
      options: { stray: true, target: "openai/stale" },
    })
    expect(resolved).toEqual({ options: { mode: "auto", target: "openai/stale" } })
  })

  it("inventoryConfiguration omits unresolvable definitions and projects only resolved values", () => {
    // A dangling optionsKey fails resolveDefinition (optionSets are empty), so the whole projection is omitted.
    expect(
      PluginConfiguration.inventoryConfiguration({
        configuration: {
          title: "Broken",
          fields: [{ key: "broken", type: "string", optionsKey: "missing" }],
          optionSets: {},
        },
        options: {},
        configured: true,
      }),
    ).toBeUndefined()
    expect(
      PluginConfiguration.inventoryConfiguration({
        configuration: {
          title: "Endpoint",
          fields: [{ key: "endpoint", type: "string", default: "https://example.test" }],
        },
        options: {},
        configured: true,
      }),
    ).toMatchObject({ configured: true, values: { endpoint: "https://example.test" } })
  })
})
```

(Secret string fields cannot resolve at all — `secret: Schema.Literal(false)` at schema/plugin.ts:33 — so the
omission path is the secret guard; the redaction filter inside the projection remains defense-in-depth and is pinned
by existing inventory tests.)

## 7. Preserved behavior

| Invariant | Where today |
| --- | --- |
| Exact error messages: `"Plugin configuration cannot contain external or secret fields"`, `"Plugin configuration options must be form values"`, `"Unknown form field: ${key}"`, `"Invalid option for form field: ${key}"`, `"Missing option set: ${key}"`, `"Form field cannot declare options and optionsKey: ${key}"` | configuration-definition.ts:12,15; plugin.ts:91; schema/form.ts:167; schema/plugin.ts:80-81 — pinned by plugin-configuration.test.ts:76,124,145,173 |
| Configure rejects unknown submitted keys before persisting or reloading | configuration.ts:35-36; plugin-configuration.test.ts:68-81 |
| Configure validates strictly against resolved option sets; activation accepts stale members via `custom` re-marking | configuration.ts:41-42 vs plugin.ts:93-97; plugin-configuration.test.ts:129-148 |
| Activation validates the definition's declared defaults first, then normalized values | plugin.ts:92-98 |
| Activation configuration errors are defects → failed inventory rows | plugin.ts:100-102,173-180; plugin-configuration.test.ts:109-148 |
| Raw options pass through untouched when no configuration is declared; Project plugins receive `{}` | plugin.ts:84; supervisor.ts:309 |
| `Form.normalize` drops unanswered, inactive, and empty-string values before persisting or activating | schema/form.ts:154-162; configuration.ts:37-40 |
| Declaration-time checks: option sets must resolve, fields cannot declare `options` and `optionsKey`, no external/secret fields | schema/plugin.ts:77-83; configuration-definition.ts:13-16; ConfigurationStringField `secret: Literal(false)` at schema/plugin.ts:33 |
| Inventory silently omits unresolvable definitions; redacts secret and non-primitive values; `configured` starts `false` | plugin.ts:341-343,353-363,352 |
| Persist → activate → verify → rollback ordering, with rollback only for a committed compensation | configuration.ts:44-68; plugin-configuration.test.ts:83-107 |
| `configurationTarget` gates which sources are Workspace-configurable | configuration.ts:30-31; source-target.ts:6-10; config.ts:287 |

## 8. Open decisions

| Decision | Current behavior | Options | Recommended default |
| --- | --- | --- | --- |
| Unknown keys at activation | Silently dropped by `Form.normalize` (plugin.ts:78-83); rejected only at configure | (a) preserve asymmetry; (b) reject at activation too | **(a) preserve.** Config-file options are plugin-owner territory and long-lived; rejecting would turn every stale key in a persisted Config row into a failed plugin. |
| Option-set strictness asymmetry | Configure enforces declared sets; activation marks `optionsKey` fields `custom` (configuration.ts:41-42 vs plugin.ts:93-97) | (a) preserve; (b) strict everywhere | **(a) preserve.** Option sets are snapshots of dynamic catalogs (e.g. model routing rebuilds its definition from catalog state on every `PluginInternal.list` call, internal.ts:192, re-versioned by `builtin()` at supervisor.ts:314-318); strict activation would fail plugins whose configured value references a set member that rotated out. |
| Declared-defaults validation at activation | Validated before values; a bad default dies the load (plugin.ts:92) | (a) preserve; (b) warn and continue | **(a) preserve.** Defaults become the plugin's standing options; an invalid default cannot produce a valid active state, so the failed row is the honest outcome. |
| Inventory omission on unresolvable definitions | Silent `undefined` (plugin.ts:344-345) | (a) preserve; (b) emit a failed-configuration marker on the row | **(a) preserve.** The row's `status` already carries the plugin-level outcome; adding a second failure vocabulary doubles the interface for a case the schema forbids authoring in the first place. |
| Placement | Split across `configuration.ts` + `configuration-definition.ts` | (a) standalone `configuration.ts` (recommended); (b) private inside `PluginGeneration` | **(a) standalone.** Pure, synchronous, three callers across two Modules; folding it in widens the generation interface or forces the configure command through internals. |
| Error shape from pure functions | Data (`{ error: string }`), tagged errors only at `configure` | (a) preserve; (b) tagged errors from the pure functions | **(a) preserve.** Each call site fails differently (die vs `InvalidError`); data-shaped results let the caller choose, and synchronous helpers stay effect-free. |

## 9. Sequencing

1. **Introduce the Module interface over the old internals.** Add `resolveDefinition`, `activationOptions`,
   `normalizeSubmission`, and `inventoryConfiguration` to `plugin/configuration.ts`; implement `resolveDefinition`
   by delegating to the existing `resolveConfigurationDefinition`, and rewrite the three call sites
   (activation block, `configurationInfo`, configure's validation block) to call the new members. No behavior change;
   all existing tests pass unchanged.
2. **Delete the old seam and move tests.** Inline the resolver body, delete the `configuration-definition.ts` file
   and its imports (plugin.ts:17, configuration.ts:8), swap `configure`'s
   supervisor dependency to `PluginGeneration.Service` once 01 lands, and append the pure-function test cases above.
   Run core formatting, lint, `git diff --check`, and `bun typecheck` from `packages/core`.
