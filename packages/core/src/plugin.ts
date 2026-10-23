/** Exposes the Workspace-scoped Plugin registry owned by this module. */
export * as Plugin from "./plugin.js"

// Compatibility exports for the existing member-graph assembler. New composition
// crosses this boundary through `node`, `graph`, `Hooks`, `ready`, `configure`,
// and `configured`; it must not depend on these implementation modules.
export * as Hooks from "./plugin/hooks.js"
export * as Runtime from "./plugin/runtime-facade.js"
export * as Activation from "./plugin/activation.js"
export * as Source from "./plugin/source.js"
export * as Supervisor from "./plugin/supervisor.js"
export * as Package from "./plugin/package.js"
export * as Workspace from "./plugin/workspace-runtime.js"

import type { PluginOptions } from "@bymorning/plugin/options"
import { Form } from "@bymorning/schema/form"
import { Plugin } from "@bymorning/schema/plugin"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Cause, Context, Effect, Exit, Latch, Layer, Logger, Option, References, Schema, Scope, Semaphore } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Actor } from "./actor.js"
import { Agent } from "./agent.js"
import { AISDK } from "./aisdk.js"
import { PluginHost } from "./plugin/host.js"
import { resolveConfigurationDefinition } from "./plugin/configuration-definition.js"
import { Bus } from "./bus.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { InstructionDiscovery } from "./instruction-discovery.js"
import { Integration } from "./integration.js"
import { IntegrationOAuthCallback } from "./integration-oauth-callback.js"
import { Mcp } from "./mcp.js"
import { Reference } from "./reference.js"
import { Skill } from "./skill.js"
import { State } from "./state.js"
import { Storage } from "./storage.js"
import { Tool } from "./tool.js"
import { WebSearch } from "./websearch.js"
import { CodeInterpreter } from "./code-interpreter.js"
import { PluginHooks } from "./plugin/hooks.js"
import { PluginRuntime } from "./plugin/runtime.js"
import { PluginSource } from "./plugin/source.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import {
  Service,
  type Interface,
  type Generation,
  ActivationError,
  type ActivationOptions,
} from "./plugin/registry-service.js"
import { Registry } from "./plugin/registry-service.js"
export { awaitActivation, awaitActivation as ready, Service, ActivationError, type ActivationOptions, type Interface, type Generation } from "./plugin/registry-service.js"
export type { WorkspaceHost } from "./plugin/host.js"
import { PluginActivation } from "./plugin/activation.js"
import { PluginPackage } from "./plugin/package.js"
import { PluginUpdate } from "./plugin-update.js"
import { production } from "./plugin-update/registry.js"
import { PluginStartup } from "./plugin/startup.js"
import { WorkspaceRuntime } from "./plugin/workspace-runtime.js"
import { PluginInternal } from "./plugin/internal.js"

/** Build a Workspace registry and bind every loaded plugin to that Workspace's capabilities. */
export const layer = (
  services: Omit<PluginHost.HostServices, "bus" | "plugin"> | PluginHost.WorkspaceHost,
  coordinator = State.makeCoordinator(),
  requirements: ActivationOptions = {},
  parent?: Interface,
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const scope = yield* Scope.make()
      // One slot per requested definition in activation order, including ones whose setup failed, so
      // the prefix diff below stays index-aligned and a failed revision is not retried until it changes.
      const active = new Map<Plugin.ID, Slot>()
      const lock = Semaphore.makeUnsafe(1)
      const ready = yield* Latch.make(true)
      const pending = new Set<object>()
      const hold = () =>
        Effect.sync(() => {
          const token = {}
          pending.add(token)
          ready.closeUnsafe()
          return Effect.sync(() => {
            if (pending.delete(token) && pending.size === 0) ready.openUnsafe()
          })
        })
      let inventory: Plugin.Info[] = []

      const load = Effect.fnUntraced(function* (plugin: Generation) {
        const child = yield* Scope.fork(scope)
        const contribution = { integrations: new Map(), tools: new Map() }
        const inherit = yield* State.inherit()
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
        const options = normalized ?? plugin.options ?? {}
        const configurationError =
          configuration !== undefined && "error" in configuration
            ? configuration.error
            : fields === undefined
              ? undefined
              : submitted?._tag === "None"
                ? "Plugin configuration options must be form values"
                : (Form.validate(
                    fields.map((field) => ({ ...field, required: false })),
                    Form.defaults(fields),
                  ) ??
                  Form.validate(
                    fields.map((field) =>
                      field.type === "string" && "optionsKey" in field ? { ...field, custom: true } : field,
                    ),
                    normalized ?? {},
                  ))
        const loaded = yield* Effect.suspend(() =>
          configurationError === undefined
            ? plugin.scope === "workspace"
              ? plugin.effect(PluginHost.workspace({ ...services, scope: "workspace" }, plugin.id, options))
              : "scope" in services
                ? Effect.die(new Error("Member Plugin cannot activate in a Workspace host"))
                : plugin.effect(PluginHost.make({ ...services, bus, plugin: registry }, plugin.id, options, plugin.source, contribution))
            : Effect.die(new Error(configurationError)),
        ).pipe(
          inherit,
          Effect.updateContext((context: Context.Context<never>) =>
            Context.make(Scope.Scope, child).pipe(
              Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
              Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
            ),
          ),
          Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
          Effect.andThen(bus.publish(Plugin.Event.Added, { id: Plugin.ID.make(plugin.id) }).pipe(Effect.orDie)),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
          Effect.exit,
        )
        if (Exit.isSuccess(loaded)) return { scope: child, contribution } as const
        yield* Effect.logWarning("failed to load plugin", { "plugin.id": plugin.id, cause: loaded.cause })
        // The public setup contract has no error channel, so rejected plugin input arrives as this plugin's defect.
        const rejected = Cause.squash(loaded.cause)
        return { error: rejected instanceof PluginHost.InputError ? rejected.message : Cause.pretty(loaded.cause) } as const
      })

      const activate = Effect.fn("Plugin.activate")(function* (
        plugins: readonly Generation[],
        failures: readonly Extract<Plugin.Info, { readonly status: "failed" }>[] = [],
      ) {
        const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }))
        const ids = new Set<Plugin.ID>()
        for (const definition of definitions) {
          if (ids.has(definition.id)) return yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
          ids.add(definition.id)
        }

        yield* Effect.acquireUseRelease(
          hold(),
          () =>
            lock.withPermit(
              Effect.gen(function* () {
                const current = Array.from(active.values())
                const changed = definitions.findIndex((definition, index) => {
                  const entry = current[index]
                  return entry?.plugin.id !== definition.id || entry.plugin.revision !== definition.revision
                })
                const prefix = changed === -1 ? definitions.length : changed
                for (const definition of definitions.slice(0, prefix)) {
                  const entry = active.get(definition.id)
                  if (entry) active.set(definition.id, { ...entry, plugin: definition })
                }
                if (prefix === definitions.length && active.size === definitions.length) {
                  const nextInventory = [...Array.from(active.values(), slotInfo), ...failures]
                  if (JSON.stringify(inventory) === JSON.stringify(nextInventory)) return
                  inventory = nextInventory
                  yield* bus.publish(Plugin.Event.Updated, {}).pipe(Effect.orDie)
                  return
                }

                yield* services.shellHooks.drain(State.batch(
                  coordinator,
                  Effect.gen(function* () {
                    // Registrations are ordered by setup, so only the unchanged prefix can stay alive.
                    const previous = new Map(Array.from(active.entries()).slice(prefix))
                    yield* Effect.forEach(
                      Array.from(previous.entries()).toReversed(),
                      ([id, slot]) =>
                        Effect.gen(function* () {
                          active.delete(id)
                          if (slot.loaded) yield* Scope.close(slot.loaded.scope, Exit.void)
                        }),
                      { discard: true },
                    )
                    for (const definition of definitions.slice(prefix)) {
                      const loaded = yield* load(definition)
                      if (loaded.scope !== undefined) {
                        active.set(definition.id, {
                          plugin: definition,
                          loaded: { plugin: definition, scope: loaded.scope, contribution: loaded.contribution },
                        })
                        continue
                      }
                      active.set(definition.id, { plugin: definition, error: loaded.error })

                      const fallback = previous.get(definition.id)?.loaded
                      if (!fallback) continue
                      const restored = yield* load(fallback.plugin)
                      if (restored.scope !== undefined) {
                        active.set(definition.id, {
                          plugin: definition,
                          loaded: {
                            plugin: fallback.plugin,
                            scope: restored.scope,
                            contribution: restored.contribution,
                          },
                          error: loaded.error,
                        })
                        continue
                      }
                      yield* Effect.logError("failed to restore plugin; deactivating", { "plugin.id": definition.id })
                    }

                    inventory = [...Array.from(active.values(), slotInfo), ...failures]
                  }),
                ))
                yield* bus.publish(Plugin.Event.Updated, {}).pipe(Effect.orDie)
              }),
            ),
          (release) => release,
        )
      })

      const close = (exit: Exit.Exit<unknown, unknown>) =>
        lock.withPermit(
          Effect.gen(function* () {
            active.clear()
            yield* services.shellHooks.drain(State.batch(coordinator, State.shutdown(Scope.close(scope, exit))))
          }),
        )
      yield* Effect.addFinalizer(close)

      const registry = Service.of({
        activate,
        close,
        awaitActivation: Effect.gen(function* () {
          if (parent !== undefined) yield* parent.awaitActivation
          yield* ready.await
          for (const pluginID of requirements.required ?? []) {
            const slot = active.get(pluginID)
            if (!slot?.loaded || slot.error !== undefined) {
              return yield* new ActivationError({ pluginID, message: "Required Plugin is not active" })
            }
          }
        }),
        hold,
        list: Effect.fn("Plugin.list")(function* () {
          return [...(parent === undefined ? [] : yield* parent.list()), ...inventory.map((item) => {
            const contribution = item.id === undefined ? undefined : active.get(item.id)?.loaded?.contribution
            if (!contribution || item.status !== "active") return item
            const integrations = [
              ...new Set([...contribution.integrations.values()].flatMap((ids) => [...ids])),
            ].toSorted()
            const tools = [...new Set([...contribution.tools.values()].flatMap((paths) => [...paths]))].toSorted()
            return { ...item, ...(integrations.length ? { integrations } : {}), ...(tools.length ? { tools } : {}) }
          })]
        }),
      })
      return registry
    }),
  )

/** Registry implementation wired only to canonical domain declarations. */
const registryWith = (shared?: WorkspaceNode<WorkspaceRuntime.Binding, unknown>) => makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const owner = yield* Actor.Binding.Service
      const startup = yield* PluginStartup.Service
      const coordinator = yield* State.Service
      const binding = yield* Effect.serviceOption(WorkspaceRuntime.Binding)
      if (shared !== undefined && Option.isNone(binding)) return yield* Effect.die(new Error("Workspace Plugin runtime was not composed"))
      const parent = shared === undefined || Option.isNone(binding) ? undefined : Context.get(binding.value, Service)
      return layer(
        {
          workspaceID: owner.workspaceID,
          accountID: owner.accountID,
          app: startup.app,
          agent: yield* Agent.Service,
          aisdk: yield* AISDK.Service,
          catalog: yield* Catalog.Service,
          command: yield* Command.Service,
          integration: yield* Integration.Service,
          integrationOAuthCallback: yield* IntegrationOAuthCallback.Service,
          instruction: yield* InstructionDiscovery.Service,
          mcp: yield* Mcp.Service,
          reference: yield* Reference.Service,
          runtime: yield* PluginRuntime.Service,
          shellHooks: yield* PluginHooks.Service,
          skill: yield* Skill.Service,
          storage: yield* Storage.Service,
          tool: yield* Tool.Service,
          websearch: yield* WebSearch.Service,
          codeInterpreter: yield* CodeInterpreter.Service,
          http: yield* HttpClient.HttpClient,
        },
        coordinator,
        {},
        parent,
      )
    }),
  ),
  deps: [
    Actor.binding,
    PluginStartup.node,
    State.node,
    Bus.node,
    Agent.node,
    AISDK.node,
    Catalog.node,
    Command.node,
    Integration.node,
    IntegrationOAuthCallback.node,
    InstructionDiscovery.node,
    Mcp.node,
    Reference.node,
    PluginRuntime.node,
    PluginHooks.node,
    Skill.node,
    Storage.node,
    Tool.node,
    WebSearch.node,
    CodeInterpreter.node,
    LayerNodePlatform.httpClient,
    ...(shared === undefined ? [] : [shared]),
  ],
})
const registry = registryWith()

/** Concrete canonical member provider consumed by all sibling member graphs. */
export const node = registry

/**
 * Supported Plugin projection for member composition. It establishes the one
 * hook registry, source, supervisor, and lightweight cycle facades in the same
 * member lifetime. The registry is the private direct-dependency provider above.
 */
const declarations = LayerNode.group([
  node,
  State.node,
  PluginStartup.node,
  PluginPackage.node,
  PluginSource.node,
  PluginSupervisor.node,
  PluginHooks.node,
  PluginRuntime.node,
  PluginActivation.node,
])

/**
 * Apply the registry implementation to the complete Plugin branch. A binding on
 * only the registry output would not reach Supervisor's dependency branch.
 */
export const graph = LayerNode.bind(declarations, [Registry.node.replace(registry)])

// `plugin` is the definition the slot was last asked to run; `loaded` is the generation actually
// running, which stays an older fallback while the requested version keeps failing setup.
type Slot = {
  readonly plugin: Generation
  readonly loaded?: {
    readonly plugin: Generation
    readonly scope: Scope.Closeable
    readonly contribution: PluginHost.Contribution
  }
  readonly error?: string
}

function slotInfo(slot: Slot): Plugin.Info {
  const configuration = configurationInfo(slot.plugin.configuration, slot.plugin.options, slot.plugin.configured)
  const info = {
    id: Plugin.ID.make(slot.plugin.id),
    source: slot.plugin.source ?? { type: "builtin" as const },
    tui: slot.plugin.tui ?? false,
    scope: slot.plugin.scope ?? "member",
    ...(configuration === undefined ? {} : { configuration }),
  }
  return slot.error === undefined ? { ...info, status: "active" } : { ...info, status: "failed", error: slot.error }
}

function configurationInfo(
  configuration: Generation["configuration"],
  configured?: PluginOptions,
  configuredOnce?: boolean,
): Plugin.Configuration | undefined {
  if (configuration === undefined) return
  const resolution = resolveConfigurationDefinition(configuration)
  if ("error" in resolution) return
  const fields = resolution.fields
  const submitted = Schema.decodeUnknownOption(Form.Answer)(configured ?? {})
  const options = Form.normalize(fields, {
    ...Form.defaults(fields),
    ...(submitted._tag === "Some" ? submitted.value : {}),
  })
  return {
    ...resolution.definition,
    configured: configuredOnce ?? false,
    values: Object.fromEntries(
      Object.entries(options).filter(
        ([key, value]) =>
          fields.some((field) => field.key === key && !(field.type === "string" && field.secret)) &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            (Array.isArray(value) && value.every((item) => typeof item === "string"))),
      ),
    ),
  }
}

/** Await Plugin activation; kept as the established name for `awaitActivation`. */

/** Construct the ordinary loader/supervisor over the reduced Workspace host. */
export const workspace = (host: PluginHost.WorkspaceHost, startup: PluginStartup.Options) => {
  const registry = layer(host, undefined, {
    required: [Plugin.ID.make("bymorning.limiter")],
  })
  const source = PluginSource.workspaceLayer(host.workspaceID)
  const packages = PluginPackage.configured({ directory: startup.directory, install: startup.installPackage })
  const supervisor = PluginSupervisor.layerWith(PluginInternal.workspace, undefined, PluginUpdate.disabled, "workspace").pipe(
    Layer.provideMerge(registry),
    Layer.provide(source),
    Layer.provide(packages),
    Layer.provide(Layer.succeed(Catalog.Service, host.catalog)),
  )
  return supervisor
}
export { configure } from "./plugin/configuration.js"
export { check, update } from "./plugin/update.js"
/**
 * Bind the installation-selected Plugin startup options once. Workspace/plugin
 * code receives only the resolved host capabilities, never this configuration.
 */
const bindings = (options: PluginStartup.Options, shared?: WorkspaceNode<WorkspaceRuntime.Binding, unknown>) => {
  const selected = shared === undefined ? registry : registryWith(shared)
  return [
    // Supervisor's private cycle declaration can be traversed from a sibling
    // branch, so bind it alongside startup policy on the enclosing member root.
    Registry.node.replace(selected),
    registry.replace(selected),
    PluginStartup.node.replace(Layer.succeed(PluginStartup.Service, PluginStartup.Service.of(options))),
    PluginPackage.node.replace(
      PluginPackage.configured({ directory: options.directory, install: options.installPackage }),
    ),
    PluginUpdate.node.replace(
      PluginUpdate.configured({ registry: production(options.directory), enabled: options.installPackage !== false }),
    ),
  ] as const
}

/**
 * Select Plugin startup policy once. Supplying the complete member recipe binds
 * private registry/startup/package declarations across every sibling branch.
 */
export function configured(options: PluginStartup.Options): typeof graph
export function configured<A, E, T extends LayerNode.Tag | undefined>(
  options: PluginStartup.Options,
  root: LayerNode.Graph<A, E, T>,
  shared?: WorkspaceNode<WorkspaceRuntime.Binding, unknown>,
): LayerNode.Graph<A, E, T>
export function configured(
  options: PluginStartup.Options,
  root?: LayerNode.Graph<never, unknown, LayerNode.Tag | undefined>,
  shared?: WorkspaceNode<WorkspaceRuntime.Binding, unknown>,
) {
  return LayerNode.bind(root ?? graph, bindings(options, shared))
}
