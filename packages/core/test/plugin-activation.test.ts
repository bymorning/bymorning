import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import type { IntegrationMethodRegistration } from "@bymorning/plugin/effect/integration"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { Event } from "@bymorning/schema/event"
import { Context, Deferred, Effect, Fiber, Layer, PubSub, Schema, Stream } from "effect"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Bus } from "../src/bus.js"
import { Credential } from "../src/credential.js"
import { Integration } from "../src/integration.js"
import { Plugin } from "../src/plugin.js"
import { PluginActivation } from "../src/plugin/activation.js"
import type { PluginHost } from "../src/plugin/host.js"
import { node as registryNode } from "../src/plugin/registry-service.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Tool } from "../src/tool.js"
import { AppProcess } from "../src/util/process.js"

const busLayer = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<Event.Payload>()
    return Bus.Service.of({
      publish: ((definition: Event.Definition, data: unknown) => {
        const event = {
          id: Event.ID.make(crypto.randomUUID()),
          created: Date.now(),
          type: definition.type,
          data,
        } as Event.Payload<typeof definition>
        return PubSub.publish(pubsub, event).pipe(Effect.as(event))
      }) as Bus.Interface["publish"],
      subscribe: (() => PubSub.subscribe(pubsub).pipe(Effect.map(Stream.fromSubscription))) as Bus.Subscribe,
    })
  }),
)

describe("PluginActivation", () => {
  it.effect("delegates readiness to the registry's own activation latch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const registry = yield* Layer.build(pluginLayer({ tool: tools }))
        const plugins = Context.get(registry, Plugin.Service)
        const activation = Context.get(
          yield* Layer.build(
            LayerNode.compile(PluginActivation.node, {
              replacements: [registryNode.replace(Layer.succeed(Plugin.Service, plugins))],
            }),
          ),
          PluginActivation.Service,
        )

        // The supervisor holds readiness while it prepares a generation; the facade waits on that hold.
        const release = yield* plugins.hold()
        const waiting = yield* PluginActivation.awaitActivation.pipe(
          Effect.provideService(PluginActivation.Service, activation),
          Effect.forkScoped,
        )
        yield* Effect.yieldNow
        expect(waiting.pollUnsafe()).toBeUndefined()

        const entered = yield* Deferred.make<void>()
        yield* plugins.activate([
          {
            id: "activated",
            revision: "1",
            effect: (context) =>
              context.tool
                .transform((editor) =>
                  editor.add({
                    name: "activated",
                    description: "activated",
                    input: Schema.Struct({}),
                    execute: () => Effect.succeed({}),
                  }),
                )
                .pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.asVoid),
          },
        ])
        yield* Deferred.await(entered)
        yield* Effect.yieldNow
        expect(waiting.pollUnsafe()).toBeUndefined()

        yield* release
        yield* Fiber.join(waiting)
        const resolution = yield* activation.awaitActivation.pipe(Effect.andThen(tools.snapshot()))
        expect(resolution.codeModeCatalog?.tools).toContainEqual(
          expect.objectContaining({ type: "tool", name: "activated" }),
        )
        expect(activation.awaitActivation).toBe(plugins.awaitActivation)
      }),
    ).pipe(Effect.provide(Tool.layer.pipe(Layer.provide(PluginHooks.layer)))),
  )

  it.effect("fails only the plugin whose Integration method is malformed and keeps its siblings active", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const integration = yield* Integration.Service
        const registry = yield* Layer.build(pluginLayer({ integration }))
        const plugins = Context.get(registry, Plugin.Service)
        const keyPlugin = (id: string, integrationID: string) => ({
          id,
          revision: "1",
          effect: (context: PluginContext) =>
            context.integration
              .transform((editor) => editor.method.update({ integrationID, method: { type: "key", label: "API token" } }))
              .pipe(Effect.asVoid),
        })

        // The registry folds Integration state once at the end of its batch; the malformed method must not reach it.
        yield* plugins.activate([
          keyPlugin("project.jira-my-issues", "jira"),
          {
            id: "project.integration.google-workspace",
            revision: "1",
            effect: (context) =>
              context.integration
                .transform((editor) => {
                  editor.update("google-workspace", (entry) => {
                    entry.name = "Google Workspace"
                  })
                  editor.method.update({
                    integrationID: "google-workspace",
                    method: { id: "oauth", type: "oauth", label: "Google" },
                  } as unknown as IntegrationMethodRegistration)
                })
                .pipe(Effect.asVoid),
          },
          keyPlugin("project.after", "after"),
        ])

        expect(yield* plugins.list()).toEqual([
          expect.objectContaining({ id: "project.jira-my-issues", status: "active", integrations: ["jira"] }),
          expect.objectContaining({
            id: "project.integration.google-workspace",
            status: "failed",
            error: "OAuth method oauth for integration google-workspace needs an authorize function",
          }),
          expect.objectContaining({ id: "project.after", status: "active", integrations: ["after"] }),
        ])
        expect((yield* integration.list()).map((entry) => entry.id)).toEqual(["after", "jira"])
      }),
    ).pipe(
      Effect.provide(
        Integration.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Credential.Service, credentials),
              AppProcess.layer.pipe(Layer.provide(NodeServices.layer)),
              busLayer,
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("keeps readiness closed while an activation is in flight", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* Layer.build(pluginLayer())
        const plugins = Context.get(registry, Plugin.Service)
        const entered = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const activating = yield* plugins
          .activate([
            {
              id: "gated",
              revision: "1",
              effect: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
            },
          ])
          .pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        const waiting = yield* plugins.awaitActivation.pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        expect(waiting.pollUnsafe()).toBeUndefined()

        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(activating)
        yield* Fiber.join(waiting)
        expect((yield* plugins.list()).map((plugin) => plugin.id)).toEqual(["gated"])
      }),
    ),
  )
})

const noCredential: Credential.Info | undefined = undefined
const credentials = Credential.Service.of({
  client: {
    configured: () => Effect.succeed([]),
    resolve: () => Effect.succeed({}),
    put: () => Effect.void,
    remove: () => Effect.succeed(false),
  },
  all: () => Effect.succeed([]),
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(noCredential),
  create: () => Effect.die("unused"),
  activate: () => Effect.void,
  update: () => Effect.void,
  updateOAuth: () => Effect.succeed(false),
  removeOAuth: () => Effect.succeed(false),
  refreshOAuth: () => Effect.die("unused"),
  remove: () => Effect.void,
  discard: () => Effect.void,
  connected: () => Effect.succeed([]),
})

const host = deepProxy() as Omit<PluginHost.HostServices, "bus" | "plugin">

/**
 * Real hook registry for the Plugin registry under test. The registry drains
 * admission through `shellHooks.drain`, so a proxy without hook behavior
 * cannot stand in for it.
 */
const pluginLayer = (extra?: Partial<Omit<PluginHost.HostServices, "bus" | "plugin">>) =>
  Layer.unwrap(
    Effect.map(PluginHooks.Service, (shellHooks) => Plugin.layer({ ...host, shellHooks, ...extra })),
  ).pipe(
    Layer.provide(PluginHooks.layer),
    Layer.provideMerge(busLayer),
  )

function deepProxy(): object {
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
