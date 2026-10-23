export * as PluginSupervisor from "./supervisor.js"
export { ActivationError, Service, type Interface } from "./supervisor-service.js"

import type { Plugin as EffectPlugin } from "@bymorning/plugin/effect/plugin"
import { fromPromise } from "@bymorning/plugin/promise/adapter"
import { Host } from "@bymorning/plugin/host"
import type { Plugin as PromisePlugin } from "@bymorning/plugin/promise/plugin"
import { ID, type Info, type Source } from "@bymorning/schema/plugin"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Cause, Effect, Layer, Option, Queue, Schema, Scope, Semaphore, Stream } from "effect"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { Bus } from "../bus.js"
import { Actor } from "../actor.js"
import { Catalog } from "../catalog.js"
import { Config } from "../config.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import {
  inventoryStatus,
  ticketFailed,
  type Generation,
} from "./registry-service.js"
import { Registry } from "./registry-service.js"
import { Project } from "../project.js"
import { Storage } from "../storage.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { Integration } from "../integration.js"
import { Agent } from "../agent.js"
import { PluginHooks } from "./hooks.js"
import { PluginPackage } from "./package.js"
import { PluginUpdate } from "../plugin-update.js"
import { PluginRuntime } from "./runtime.js"
import { PluginSource } from "./source.js"
import { targetSource } from "./source-target.js"
import { ActivationError, Service } from "./supervisor-service.js"
import { Mcp } from "../mcp.js"
import { PluginComposition } from "./composition.js"
import { Binding } from "./internal/tool/binding.js"
import { Database } from "../database.js"
import { CodeInterpreter } from "../code-interpreter.js"
import { Reference } from "../reference.js"
import { Skill } from "../skill.js"
import { WebSearch } from "../websearch.js"
import { Form } from "../form.js"
import { Routing } from "../routing.js"

export const layerWith = <R, R2 = never>(
  internal: Effect.Effect<
    { readonly pre: readonly EffectPlugin<Scope.Scope>[]; readonly post: readonly EffectPlugin<Scope.Scope>[] },
    never,
    R
  >,
  additionalChanges?: Stream.Stream<void, never, R2>,
  updates: PluginUpdate.Interface = PluginUpdate.disabled,
  scope: "member" | "workspace" = "member",
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const registry = yield* Registry.Service
      const source = yield* PluginSource.Service
      const packages = yield* PluginPackage.Service
      const dependencies = yield* Effect.context<R | R2 | Scope.Scope>()
      // Readiness belongs to the registry: hold it from boot until the latest observed generation settles.
      let release = (yield* registry.hold()) as Effect.Effect<void> | undefined
      yield* Effect.addFinalizer(() => release ?? Effect.void)
      // Built-ins capture services from this layer; unload them before those services close.
      yield* Effect.addFinalizer(registry.close)
      const activationLock = Semaphore.makeUnsafe(1)
      let observed = 0
      let packagesToCheck = new Set<string>()
      let outdated = new Set<string>()
      const updating = new Set<string>()
      let generation = 0
      // Last generation handed to the registry per external target; a failed reload keeps it in place.
      let running = new Map<string, Generation>()
      let applied = {
        plugins: [] as Generation[],
        failures: [] as Extract<Info, { readonly status: "failed" }>[],
      }
      // Hook identity for a reload that dies while draining invocation scopes.
      let hook: string | undefined
      // The last generation that failed to apply. Restoring the previous generation changes Integration
      // availability, which triggers another reload; retrying the same generation would fail the same way and
      // keep readiness held forever. An identical generation therefore waits until a source or revision changes.
      let rejected: { readonly generation: string; readonly cause: Cause.Cause<unknown> } | undefined

      const decorate = (value: Source): Source =>
        value.type !== "package"
          ? value
          : {
              ...value,
              ...(outdated.has(value.package) ? { outdated: true as const } : {}),
              ...(updating.has(value.package) ? { updating: true as const } : {}),
            }
      const apply = (value: {
        readonly plugins: readonly Generation[]
        readonly failures: readonly Extract<Info, { readonly status: "failed" }>[]
        readonly external?: ReadonlyMap<string, Generation>
      }) =>
        Effect.gen(function* () {
          const plugins = value.plugins.map((plugin) => plugin.source ? { ...plugin, source: decorate(plugin.source) } : plugin)
          const failures = value.failures.map((failure) => ({ ...failure, source: decorate(failure.source) }))
          yield* registry.activate(plugins, failures)
          applied = { plugins, failures }
          if (value.external !== undefined) running = new Map(value.external)
        })
      const publish = (cause: Cause.Cause<unknown>) => {
        const failed = ticketFailed({ cause, ...(hook !== undefined ? { hook } : {}) })
        return Effect.logWarning("failed to reload plugins", {
          ref: failed.ref,
          cause,
          ...(failed.pluginID !== undefined ? { "plugin.id": failed.pluginID } : {}),
          ...(failed.hook !== undefined ? { hook: failed.hook } : {}),
        }).pipe(
          Effect.andThen(
            registry.activate(applied.plugins, [...applied.failures, ...inventoryStatus(failed)]).pipe(
              Effect.catchCause((publishCause) =>
                Effect.logWarning("failed to publish plugin reload ticket", { cause: publishCause, ref: failed.ref }),
              ),
            ),
          ),
        )
      }

      const activate = Effect.gen(function* () {
        const current = ++generation
        hook = undefined
        const definitions = yield* internal
        const snapshot = yield* source.snapshot()
        const resolved = yield* resolve(
          packages,
          updates,
          definitions.pre.map(builtin),
          definitions.post.map(builtin),
          snapshot,
          running,
          scope,
        )
        const fingerprint = JSON.stringify(resolved.plugins.map((plugin) => [plugin.id, plugin.revision]))
        if (rejected?.generation === fingerprint) return yield* new ActivationError({ cause: rejected.cause })
        hook = "model.invoke"
        yield* apply(resolved).pipe(
          Effect.onError((cause) =>
            Effect.sync(() => {
              if (!Cause.hasInterrupts(cause)) rejected = { generation: fingerprint, cause }
            }),
          ),
        )
        rejected = undefined
        hook = undefined
        const targets = new Set(
          [...resolved.plugins, ...resolved.failures].flatMap((plugin) =>
            plugin.source?.type === "package" ? [plugin.source.package] : [],
          ),
        )
        packagesToCheck = targets
        yield* Effect.forEach(
          targets,
          (target) => updates.check(target).pipe(Effect.map((available) => [target, available] as const)),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.flatMap((checked) => {
            if (current !== generation) return Effect.void
            const next = new Set(checked.flatMap(([target, available]) => available ? [target] : []))
            if (next.size === outdated.size && [...next].every((target) => outdated.has(target))) return Effect.void
            outdated = next
            return apply(resolved)
          }),
          Effect.catchCause((cause) => Effect.logWarning("failed to check plugin updates", { cause })),
          Effect.forkScoped({ startImmediately: true }),
        )
      }).pipe(
        Effect.provide(dependencies),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : // The unchanged rejected generation was already logged and published to inventory.
              Option.getOrUndefined(Cause.findErrorOption(cause)) instanceof ActivationError
              ? Effect.failCause(cause)
              : publish(cause).pipe(Effect.andThen(Effect.fail(new ActivationError({ cause })))),
        ),
        Effect.withSpan("PluginSupervisor.reload"),
      )
      const reloadAfter = Effect.fn("PluginSupervisor.reloadAfter")(function* <A, E, R2>(
        mutation: Effect.Effect<A, E, R2>,
      ) {
        return yield* activationLock.withPermit(mutation.pipe(Effect.tap(() => activate)))
      })
      const reload = reloadAfter(Effect.void)
      // Start source consumers before activation, without an extra merge/debounce boundary delaying them.
      // Each source owns its upstream subscriptions; the queue retains the latest observed request.
      const triggers = yield* Queue.sliding<number>(1)
      // Make accepted work visible to awaitActivation before coalescing the burst.
      const notify = Effect.gen(function* () {
        observed++
        if (!release) release = yield* registry.hold()
        yield* Queue.offer(triggers, observed)
      })
      const watch = <A>(stream: Stream.Stream<A, never, R2>) =>
        stream.pipe(
          Stream.runForEach(() => notify),
          Effect.forkScoped({ startImmediately: true }),
        )
      yield* watch(source.changes())
      if (additionalChanges !== undefined) yield* watch(additionalChanges)
      yield* watch(Stream.fromEffectRepeat(Effect.sleep("24 hours")))
      yield* watch(
        updates.changes().pipe(
          Stream.filter((update) => packagesToCheck.has(update.target)),
          Stream.tap((update) => Effect.sync(() => {
            update.outdated ? outdated.add(update.target) : outdated.delete(update.target)
            update.updating ? updating.add(update.target) : updating.delete(update.target)
          })),
        ),
      )
      // Run initial activation immediately; debounce only later requests. One consumer serializes both.
      yield* Stream.concat(Stream.succeed(0), Stream.fromQueue(triggers).pipe(Stream.debounce("100 millis"))).pipe(
        Stream.runForEach((target) =>
          Effect.gen(function* () {
            yield* reload.pipe(
              Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.void)),
            )
            if (observed !== target) return
            const settled = release
            release = undefined
            if (settled) yield* settled
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      return Service.of({ awaitActivation: registry.awaitActivation, reload, reloadAfter })
    }),
  )

export const layer = Layer.unwrap(
  Effect.map(PluginUpdate.Service, (updates) => layerWith(PluginComposition.definitions, PluginComposition.changes, updates)),
)

/** Canonical supervisor declaration over the registry's own readiness. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.map(Actor.Binding.Service, (owner) => layer.pipe(Layer.provide(Binding.layer(owner.workspaceID)))),
  ),
  deps: [
    Actor.binding,
    Registry.node,
    PluginSource.node,
    PluginPackage.node,
    PluginUpdate.node,
    Database.node,
    LayerNodePlatform.crypto,
    CodeInterpreter.node,
    Reference.node,
    Skill.node,
    WebSearch.node,
    Form.node,
    PluginRuntime.node,
    ToolOutput.node,
    Integration.node,
    Agent.node,
    Config.node,
    PluginHooks.node,
    LayerNodePlatform.filesystem,
    LayerNodePlatform.path,
    LayerNodePlatform.httpClient,
    Mcp.node,
    Tool.bridge,
    Catalog.node,
    Routing.node,
    Bus.node,
    InstructionDiscovery.node,
    Project.node,
    Storage.node,
    Tool.node,
  ],
})

/** Resolve one desired generation from built-ins, ordered source operations, and the running externals. */
const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  packages: PluginPackage.Interface,
  updates: PluginUpdate.Interface,
  pre: readonly Generation[],
  post: readonly Generation[],
  snapshot: PluginSource.Snapshot,
  running: ReadonlyMap<string, Generation>,
  scope: "member" | "workspace",
) {
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const external = new Map<string, Generation>()
  const failures = new Map<string, Extract<Info, { readonly status: "failed" }>>()
  const configurations = new Map<
    string,
    { readonly options: Readonly<Record<string, unknown>>; readonly configured: boolean }
  >()
  const plugins = () => [...definitions, ...external.values()]

  for (const operation of snapshot.operations) {
    if (operation.type === "config.remove") {
      if (operation.target === "*") failures.clear()
      plugins()
        .filter((plugin) => matches(operation.target, plugin.id))
        .forEach((plugin) => enabled.delete(plugin.id))
      continue
    }
    if (operation.type === "config.add") {
      const matched = plugins().filter((plugin) => matches(operation.target, plugin.id))
      if (
        matched.length > 0 ||
        operation.target === "*" ||
        operation.target.endsWith(".*") ||
        operation.target.startsWith("bymorning.") ||
        operation.target.startsWith("core.")
      ) {
        matched.forEach((plugin) => {
          enabled.add(plugin.id)
          configurations.set(plugin.id, { options: operation.options, configured: operation.configured })
        })
        continue
      }
    }
    const loaded = yield* load(packages, updates, operation).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) return Effect.interrupt
        // Inventory carries a stable reference and the loader's diagnosis; the full cause stays in the server log.
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        return Effect.logWarning("failed to load plugin", {
          target: operation.type === "config.add" ? operation.target : operation.key,
          ref,
          cause,
        }).pipe(Effect.as({ error: describe(Cause.squash(cause), operation), ref }))
      }),
    )
    const key = operation.type === "config.add" ? operation.target : operation.key
    if ("error" in loaded) {
      failures.set(key, {
        source: operationSource(operation),
        status: "failed",
        error: loaded.error,
        ref: loaded.ref,
        tui: false,
      })
      // The new revision never became a generation, so the one already running keeps its place.
      const retained = external.get(key) ?? running.get(key)
      if (!retained) continue
      external.set(key, retained)
      enabled.add(retained.id)
      continue
    }
    failures.delete(key)
    const previous = external.get(key)
    if (previous) enabled.delete(previous.id)
    if ((loaded.scope ?? "member") !== scope) continue
    if (operation.type === "project.add" && loaded.scope === "workspace") continue
    external.set(key, loaded)
    enabled.add(loaded.id)
  }

  const ordered = [
    ...pre
      .filter((plugin) => enabled.has(plugin.id))
      .map((plugin) => configured(plugin, configurations.get(plugin.id))),
    ...external.values().filter((plugin) => enabled.has(plugin.id)),
    ...post
      .filter((plugin) => enabled.has(plugin.id))
      .map((plugin) => configured(plugin, configurations.get(plugin.id))),
  ]
  // Registry activation dies on a duplicate ID, which would drop the whole generation including builtins.
  // Keep the first occurrence in boot order and report later ones like any other plugin setup failure.
  const duplicate = (plugin: Generation, index: number) =>
    ordered.findIndex((other) => other.id === plugin.id) !== index
  return {
    plugins: ordered.filter((plugin, index) => !duplicate(plugin, index)),
    external: new Map([...external].filter(([, plugin]) => enabled.has(plugin.id))),
    failures: [
      ...snapshot.failures,
      ...failures.values(),
      ...ordered.filter(duplicate).map(
        (plugin): Extract<Info, { readonly status: "failed" }> => ({
          id: ID.make(plugin.id),
          source: plugin.source ?? { type: "builtin" },
          status: "failed",
          error: `Duplicate plugin ID: ${plugin.id}`,
          tui: plugin.tui ?? false,
        }),
      ),
    ],
  }
})

/** Loadable module contract: the loader checks the named `plugin` export first, then `default`. */
const Definition = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    effect: Schema.declare<EffectPlugin["effect"]>(
      (input): input is EffectPlugin["effect"] => typeof input === "function",
    ),
  }),
  Schema.Struct({
    id: Schema.String,
    setup: Schema.declare<PromisePlugin["setup"]>(
      (input): input is PromisePlugin["setup"] => typeof input === "function",
    ),
  }),
])

/** A plugin source could not be turned into a definition; its message is safe for inventory. */
export class LoadError extends Schema.TaggedError<LoadError>()("PluginSupervisor.LoadError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const load = Effect.fn("PluginSupervisor.load")(function* (
  packages: PluginPackage.Interface,
  updates: PluginUpdate.Interface,
  operation: Extract<PluginSource.Operation, { readonly type: "config.add" | "project.add" }>,
) {
  const candidate =
    operation.type === "project.add" && "plugin" in operation
      ? operation.plugin
      : yield* Effect.gen(function* () {
          const resolved =
            operation.type !== "config.add"
              ? { server: pathToFileURL(operation.entrypoint).href }
              : path.isAbsolute(operation.target)
                ? { server: pathToFileURL(operation.target).href }
                : {
                    server: yield* packages.resolve(operation.target).pipe(
                      Effect.mapError((cause) => new LoadError({ message: `Plugin entrypoint not found: ${operation.target}`, cause })),
                    ),
                    installed: yield* updates.installed(operation.target).pipe(
                      Effect.mapError((cause) => new LoadError({ message: `Plugin package version not found: ${operation.target}`, cause })),
                    ),
                  }
          const entrypoint = resolved.server
          if (entrypoint === undefined) return yield* new LoadError({ message: `Plugin entrypoint not found: ${operation.type === "config.add" ? operation.target : operation.entrypoint}` })
          // Bun ignores cache-busting query parameters on file URLs, but honors them on absolute import paths.
          const source =
            operation.type !== "config.add" || operation.mtime === undefined
              ? entrypoint
              : process.versions.bun === undefined
                ? `${entrypoint}?mtime=${operation.mtime}`
                : `${operation.target.replaceAll("\\", "/")}?mtime=${operation.mtime}`
          const module = (yield* Effect.tryPromise(() => Host.load(source))) as Record<string, unknown>
          return { candidate: (module.plugin ?? module.default) as unknown, installed: resolved.installed }
        })
  // Validate the shape only; the original value keeps `tui` and `configuration` (upstream 9f01e2b548).
  const loaded = typeof candidate === "object" && candidate !== null && "candidate" in candidate
    ? candidate as { readonly candidate: unknown; readonly installed?: { readonly version: string; readonly revision: string } }
    : { candidate, installed: undefined }
  const shape = yield* Schema.decodeUnknownEffect(Definition)(loaded.candidate).pipe(
    Effect.mapError(
      (cause) =>
        new LoadError({
          message:
            "Plugin must export a named plugin or default definition with an id and an effect or setup function.",
          cause,
        }),
    ),
  )
  const plugin = "effect" in shape ? (loaded.candidate as EffectPlugin) : fromPromise(loaded.candidate as PromisePlugin)
  return {
    ...plugin,
    revision:
      operation.type !== "config.add"
        ? operation.revision
        : JSON.stringify([{
            type: "add",
            target: operation.target,
            options: operation.options,
            configured: operation.configured,
            mtime: operation.mtime,
          }, loaded.installed?.revision]),
    source: operationSource(operation, loaded.installed?.version),
    options: operation.type === "config.add" ? operation.options : {},
    configured: operation.type === "config.add" && operation.configured,
    // Keep the established boolean inventory wire shape while resolution owns entrypoint discovery.
    tui: plugin.tui ?? false,
  } satisfies Generation
})

/**
 * Inventory text for a load failure. Node's own resolution and syntax
 * diagnostics are what an author needs and carry nothing the plugin chose to
 * say, so they are included with cache paths mapped back to the Project path
 * and every other filesystem path redacted. A value thrown by plugin code
 * contributes only its class; its message stays in the server log.
 */
const describe = (
  failure: unknown,
  operation: Extract<PluginSource.Operation, { readonly type: "config.add" | "project.add" }>,
): string => {
  // `Host.load` runs under tryPromise, which wraps the loader's rejection.
  const error = Cause.isUnknownError(failure) ? failure.cause : failure
  if (error instanceof LoadError) return error.message
  const name = error instanceof Error ? error.name : undefined
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  if (code === undefined && name !== "SyntaxError") return name === undefined ? "Plugin failed to load" : `Plugin failed to load (${name})`
  const message = error instanceof Error ? error.message : String(error)
  return `${code ?? name}: ${sanitize(message, operation)}`
}

/** Map the materialized generation back to `plugin/`, then redact every other absolute path. */
const sanitize = (
  message: string,
  operation: Extract<PluginSource.Operation, { readonly type: "config.add" | "project.add" }>,
): string => {
  let text = message
  if (operation.type === "project.add") {
    const root = operation.entrypoint.slice(0, operation.entrypoint.length - operation.path.slice("plugin/".length).length)
    for (const spelling of [pathToFileURL(root).href, root]) text = text.replaceAll(spelling, "plugin/")
  }
  const allowed = operation.type === "config.add" && path.isAbsolute(operation.target) ? operation.target : undefined
  text = text.replace(/(?<![\w.~-])(?:file:\/\/)?\/[^\s'"`,()[\]]+/g, (match) =>
    allowed !== undefined && match.startsWith(allowed) ? match : "<path>",
  )
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

const builtin = (plugin: EffectPlugin<Scope.Scope>): Generation => ({
  ...plugin,
  revision: plugin.configuration === undefined ? "internal" : JSON.stringify(plugin.configuration),
  source: { type: "builtin" },
})
const configured = (
  plugin: Generation,
  configuration: { readonly options: Readonly<Record<string, unknown>>; readonly configured: boolean } | undefined,
): Generation =>
  configuration === undefined
    ? plugin
    : {
        ...plugin,
        revision: JSON.stringify({
          revision: plugin.revision,
          options: configuration.options,
          configured: configuration.configured,
        }),
        options: configuration.options,
        configured: configuration.configured,
      }
const matches = (selector: string, target: string) =>
  selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
const operationSource = (
  operation: Extract<PluginSource.Operation, { readonly type: "config.add" | "project.add" }>,
  version?: string,
): Source =>
  operation.type === "project.add"
    ? { type: "project", projectID: operation.projectID, path: operation.path }
    : { ...targetSource(operation.target), ...(version !== undefined && !path.isAbsolute(operation.target) ? { version } : {}) }
