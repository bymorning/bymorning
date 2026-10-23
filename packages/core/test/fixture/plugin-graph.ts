/**
 * The supervisor test graph: a real Plugin registry over proxied host services,
 * the real PluginSource (materializer included), and the supervisor, with an
 * in-memory Config and Bus. Shared by the vitest suite and the Node runtime
 * child process so both exercise the same activation path.
 */
import type { Plugin as PluginDefinition } from "@bymorning/plugin/effect/plugin"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { Event } from "@bymorning/schema/event"
import type { Project as ProjectSchema } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, PubSub, Schema, Stream } from "effect"
import path from "node:path"
import { Bus } from "../../src/bus.js"
import { Config } from "../../src/config.js"
import type { Installation } from "../../src/installation.js"
import { Plugin } from "../../src/plugin.js"
import type { PluginHost } from "../../src/plugin/host.js"
import { PluginHooks } from "../../src/plugin/hooks.js"
import { PluginPackage } from "../../src/plugin/package.js"
import { PluginSource } from "../../src/plugin/source.js"
import { PluginSupervisor } from "../../src/plugin/supervisor.js"
import { Project } from "../../src/project.js"
import type { ProjectStorage } from "../../src/project-storage.js"
import { Storage } from "../../src/storage.js"
import { layer as installationLayer } from "./installation.js"
import { layer as storageLayer } from "./storage.js"

export const decode = Schema.decodeUnknownSync(ConfigSchema.Info)

export function supervisorGraph(
  initial: ConfigSchema.Info,
  packages: Record<string, string>,
  pre: readonly PluginDefinition<never>[],
  post: readonly PluginDefinition<never>[],
  updates?: PubSub.PubSub<void>,
  current = { value: initial },
  projectInput?: {
    readonly workspaceID: Workspace.ID
    readonly cacheRoot: string
    readonly projects: readonly ProjectSchema.Info[] | { readonly value: readonly ProjectSchema.Info[] }
    readonly storage: Storage.Interface
    readonly host?: Pick<PluginHost.HostServices, "integration" | "tool">
    readonly policy?: { value: Installation.Policy }
  },
) {
  const config = Layer.succeed(
    Config.Service,
    Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.sync(() => current.value),
      update: () => Effect.die("unused"),
      refresh: Effect.sync(() => current.value),
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        initialize: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.sync(() => [{ type: "document" as const, info: current.value }]),
      changes: () => (updates ? Stream.fromPubSub(updates) : Stream.never),
    }),
  )
  const bus = busLayer
  const storage = projectInput ? Layer.succeed(Storage.Service, projectInput.storage) : storageLayer
  const registry = Layer.unwrap(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      // The registry drains admission through `shellHooks.drain`, so it needs
      // the real hook registry rather than the proxies used for other hosts.
      const shellHooks = yield* PluginHooks.Service
      return Plugin.layer({
        ...(deepProxy() as Omit<PluginHost.HostServices, "bus" | "plugin">),
        workspaceID: projectInput?.workspaceID ?? Workspace.ID.make("wrk_00000000000000000000000000"),
        storage,
        shellHooks,
        ...projectInput?.host,
      })
    }),
  ).pipe(Layer.provide(Layer.mergeAll(bus, storage, PluginHooks.layer)))
  const discovered = PluginSource.layer(
    projectInput?.workspaceID ?? Workspace.ID.make("wrk_00000000000000000000000000"),
    projectInput?.cacheRoot ?? path.join(process.cwd(), ".bymorning", "test-plugin-supervisor"),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        config,
        bus,
        installationLayer(projectInput?.policy),
        Layer.succeed(Project.Service, projectInput ? projectServiceOf(projectInput.projects) : projectService),
        storage,
      ),
    ),
  )
  const source = Layer.effect(
    PluginSource.Service,
    Effect.map(PluginSource.Service, (discovery) =>
      PluginSource.Service.of({
        snapshot: discovery.snapshot,
        changes: () => (updates ? Stream.fromPubSub(updates) : discovery.changes()),
      }),
    ),
  ).pipe(Layer.provide(discovered))
  const packageLayer = Layer.succeed(
    PluginPackage.Service,
    PluginPackage.Service.of({
      resolve: (target) =>
        packages[target] ? Effect.succeed(packages[target]) : Effect.fail(new PluginPackage.ResolveError({ target })),
    }),
  )
  return Layer.merge(
    bus,
    PluginSupervisor.layerWith(Effect.succeed({ pre, post })).pipe(
      Layer.provideMerge(Layer.mergeAll(config, registry, source, packageLayer)),
    ),
  )
}

export const projectService = Project.Service.of({
  create: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  list: () => Effect.succeed([]),
  update: () => Effect.die("unused"),
  delete: () => Effect.die("unused"),
})

export const projectServiceOf = (
  projects: readonly ProjectSchema.Info[] | { readonly value: readonly ProjectSchema.Info[] },
) =>
  Project.Service.of({
    ...projectService,
    list: (options?: ProjectSchema.ListInput) =>
      options?.archived
        ? Effect.succeed([])
        : "value" in projects
          ? Effect.sync(() => projects.value)
          : Effect.succeed(projects),
  })

export const project = (id: ProjectSchema.ID): ProjectSchema.Info => ({
  id,
  name: id,
  time_created: 0,
  time_updated: 0,
})

export const writeStorage = (storage: ProjectStorage.Interface, file: string, contents: string) =>
  storage.set(file.split("/"), { body: Stream.succeed(new TextEncoder().encode(contents)) })

export const busLayer = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<Event.Payload>()
    return Bus.Service.of({
      publish: ((definition: Event.Definition, data: unknown) =>
        Effect.gen(function* () {
          const event = {
            id: Event.ID.make(crypto.randomUUID()),
            created: Date.now(),
            type: definition.type,
            data,
          } as Event.Payload<typeof definition>
          yield* PubSub.publish(events, event)
          return event
        })) as Bus.Interface["publish"],
      subscribe: (() => PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription))) as Bus.Subscribe,
    })
  }),
)

export function deepProxy(): object {
  const proxy = new Proxy(() => undefined, { get: () => proxy })
  return {
    workspaceID: "wrk_00000000000000000000000000",
    app: proxy,
    agent: proxy,
    aisdk: proxy,
    catalog: proxy,
    command: proxy,
    integration: proxy,
    instruction: proxy,
    mcp: proxy,
    mcpGatewayTools: proxy,
    policy: proxy,
    reference: proxy,
    runtime: proxy,
    shellHooks: proxy,
    skill: proxy,
    storage: proxy,
    tool: proxy,
    websearch: proxy,
  }
}
