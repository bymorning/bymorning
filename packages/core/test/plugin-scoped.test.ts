import { describe, expect, it } from "@effect/vitest"
import { Event } from "@bymorning/schema/event"
import { Context, Effect, Exit, Fiber, Layer, PubSub, Ref, Schema, Scope, Stream } from "effect"
import { Bus } from "../src/bus.js"
import type { Namespace as CodeModeNamespace, Tool as CodeModeTool } from "../src/codemode/catalog.js"
import { Plugin } from "../src/plugin.js"
import type { PluginHost } from "../src/plugin/host.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { State } from "../src/state.js"
import { Tool } from "../src/tool.js"

const busLayer = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<Event.Payload>()
    const publish = ((definition: Event.Definition, data: unknown) => {
      const event = {
        id: Event.ID.make(crypto.randomUUID()),
        created: Date.now(),
        type: definition.type,
        data,
      } as Event.Payload<typeof definition>
      return PubSub.publish(pubsub, event).pipe(Effect.as(event))
    }) as Bus.Interface["publish"]
    return Bus.Service.of({
      publish,
      subscribe: (() => PubSub.subscribe(pubsub).pipe(Effect.map(Stream.fromSubscription))) as Bus.Subscribe,
    })
  }),
)

describe("Plugin", () => {
  it.effect("projects package tool paths and removes disposed or replaced contributions", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const registrations = yield* Ref.make<State.Registration[]>([])
      const context = yield* Layer.buildWithScope(
        pluginLayer({ tool: tools }),
        yield* Scope.Scope,
      )
      const plugins = Context.get(context, Plugin.Service)
      const definition = (revision: string) => ({
        id: "example.package",
        revision,
        source: { type: "package" as const, package: "@example/package" },
        effect: (context: import("@bymorning/plugin/effect/plugin").Context) =>
          Effect.gen(function* () {
            const registration = yield* context.tool.transform((editor) =>
              editor.add({
                name: revision,
                description: "Example tool",
                input: Schema.Struct({}),
                options: { namespace: "example.mail" },
                execute: () => Effect.succeed({}),
              }),
            )
            yield* Ref.update(registrations, (items) => [...items, registration])
          }),
      })
      yield* plugins.activate([definition("first")])
      expect((yield* plugins.list())[0]).toMatchObject({ tools: ["example.mail.first"] })
      expect(catalogNames((yield* tools.snapshot()).codeModeCatalog?.tools ?? [])).toContain("first")
      const first = (yield* Ref.get(registrations))[0]
      if (!first) return yield* Effect.die("Missing registration")
      yield* first.dispose
      expect((yield* plugins.list())[0]).not.toHaveProperty("tools")
      expect(catalogNames((yield* tools.snapshot()).codeModeCatalog?.tools ?? [])).toHaveLength(0)
      yield* plugins.activate([definition("second")])
      expect((yield* plugins.list())[0]).toMatchObject({ tools: ["example.mail.second"] })
      yield* plugins.activate([])
      expect(yield* plugins.list()).toEqual([])
      expect(catalogNames((yield* tools.snapshot()).codeModeCatalog?.tools ?? [])).toHaveLength(0)
      yield* plugins.activate([
        {
          ...definition("failed"),
          effect: (context) =>
            definition("failed")
              .effect(context)
              .pipe(Effect.andThen(Effect.die("setup failed"))),
        },
      ])
      expect((yield* plugins.list())[0]).toMatchObject({ status: "failed" })
      expect((yield* plugins.list())[0]).not.toHaveProperty("tools")
      expect(catalogNames((yield* tools.snapshot()).codeModeCatalog?.tools ?? [])).toHaveLength(0)
    }).pipe(Effect.scoped, Effect.provide(Tool.layer.pipe(Layer.provide(PluginHooks.layer)))),
  )

  it.effect("restarts only the changed suffix sequentially and batches domain publication", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const bus = yield* Bus.Service
        const lifecycle = yield* Ref.make<string[]>([])
        const commits = yield* Ref.make(0)
        const state = State.create({
          initial: () => [] as string[],
          editor: (value) => value,
          notify: () => Ref.update(commits, (count) => count + 1),
        })
        const definition = (id: string, revision: string) => ({
          id,
          revision,
          effect: () =>
            Effect.gen(function* () {
              yield* Ref.update(lifecycle, (items) => [...items, `open:${id}:${revision}`])
              yield* state.transform((editor) => editor.push(`${id}:${revision}`))
              yield* Effect.addFinalizer(() => Ref.update(lifecycle, (items) => [...items, `close:${id}:${revision}`]))
            }),
        })
        const published = yield* (yield* bus.subscribe()).pipe(Stream.take(5), Stream.runCollect, Effect.forkScoped)
        yield* Effect.yieldNow

        yield* plugins.activate([definition("a", "one"), definition("b", "one")])
        expect(yield* Ref.get(commits)).toBe(1)
        expect(state.get()).toEqual(["a:one", "b:one"])

        // The unchanged prefix stays alive (upstream 36095decd7); only the suffix from the first change restarts.
        yield* plugins.activate([definition("a", "one"), definition("b", "two")])
        expect(yield* Ref.get(commits)).toBe(2)
        expect(state.get()).toEqual(["a:one", "b:two"])
        expect(yield* Ref.get(lifecycle)).toEqual(["open:a:one", "open:b:one", "close:b:one", "open:b:two"])
        expect(Array.from(yield* Fiber.join(published), (event) => event.type)).toEqual([
          "plugin.added",
          "plugin.added",
          "plugin.updated",
          "plugin.added",
          "plugin.updated",
        ])
      }),
    ).pipe(Effect.provide(pluginLayer())),
  )

  for (const scenario of [
    {
      name: "starts only the appended plugin",
      before: ["a", "b"],
      after: ["a", "b", "c"],
      expected: ["start:c:1"],
    },
    {
      name: "restarts the suffix after an insertion",
      before: ["a", "b", "c"],
      after: ["a", "x", "b", "c"],
      expected: ["stop:c:1", "stop:b:1", "start:x:1", "start:b:1", "start:c:1"],
    },
    {
      name: "restarts the suffix after a revision changes",
      before: ["a", "b", "c"],
      after: ["a", "b", "c"],
      updated: "b",
      expected: ["stop:c:1", "stop:b:1", "start:b:2", "start:c:1"],
    },
    {
      name: "stops only the removed trailing plugin",
      before: ["a", "b", "c"],
      after: ["a", "b"],
      expected: ["stop:c:1"],
    },
  ]) {
    it.effect(scenario.name, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const events: string[] = []
          const plugin = (id: string, revision = "1"): Plugin.Generation => ({
            id,
            revision,
            effect: () =>
              Effect.gen(function* () {
                events.push(`start:${id}:${revision}`)
                yield* Effect.addFinalizer(() => Effect.sync(() => events.push(`stop:${id}:${revision}`)))
              }),
          })

          yield* plugins.activate(scenario.before.map((id) => plugin(id)))
          events.length = 0
          yield* plugins.activate(scenario.after.map((id) => plugin(id, id === scenario.updated ? "2" : "1")))

          expect(events).toEqual(scenario.expected)
          expect((yield* plugins.list()).map((plugin) => plugin.id)).toEqual(scenario.after)
        }),
      ).pipe(Effect.provide(pluginLayer())),
    )
  }

  it.effect("updates inventory metadata without restarting an unchanged generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        let loads = 0
        const plugin: Plugin.Generation = {
          id: "metadata",
          revision: "1",
          source: { type: "package", package: "fixture" },
          effect: () => Effect.sync(() => void loads++),
        }

        yield* plugins.activate([plugin])
        yield* plugins.activate([{ ...plugin, configured: true, options: {}, tui: true }])

        expect(loads).toBe(1)
        expect((yield* plugins.list())[0]).toMatchObject({ source: { type: "package", package: "fixture" }, tui: true })
      }),
    ).pipe(Effect.provide(pluginLayer())),
  )

  it.effect("keeps the suffix after a failed plugin alive across identical activations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const setups = { good1: 0, broken: 0, good2: 0 }
        const good = (id: "good1" | "good2"): Plugin.Generation => ({
          id,
          revision: "1",
          effect: () => Effect.sync(() => void setups[id]++),
        })
        const broken = (revision: string): Plugin.Generation => ({
          id: "broken",
          revision,
          effect: () =>
            Effect.suspend(() => {
              setups.broken++
              return Effect.die(new Error("Setup failed"))
            }),
        })
        const failed = () =>
          plugins.list().pipe(Effect.map((inventory) => inventory.find((plugin) => plugin.id === "broken")))

        yield* plugins.activate([good("good1"), broken("1"), good("good2")])
        expect(setups).toEqual({ good1: 1, broken: 1, good2: 1 })
        expect(yield* failed()).toMatchObject({ status: "failed", error: expect.stringContaining("Setup failed") })

        // Identical definitions: nothing restarts and the failed revision is not retried.
        yield* plugins.activate([good("good1"), broken("1"), good("good2")])
        expect(setups).toEqual({ good1: 1, broken: 1, good2: 1 })
        expect(yield* failed()).toMatchObject({ status: "failed", error: expect.stringContaining("Setup failed") })
        expect((yield* plugins.list()).map((plugin) => `${plugin.id}:${plugin.status}`)).toEqual([
          "good1:active",
          "broken:failed",
          "good2:active",
        ])

        // A new revision of the failed plugin is retried once, restarting only the suffix behind it.
        yield* plugins.activate([good("good1"), broken("2"), good("good2")])
        expect(setups).toEqual({ good1: 1, broken: 2, good2: 2 })
        expect(yield* failed()).toMatchObject({ status: "failed" })
      }),
    ).pipe(Effect.provide(pluginLayer())),
  )

  it.effect("restores failed replacements and defects duplicates before mutation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const lifecycle = yield* Ref.make<string[]>([])
        const definition = (revision: string, fail = false) => ({
          id: "demo",
          revision,
          effect: () =>
            Effect.gen(function* () {
              yield* Ref.update(lifecycle, (items) => [...items, `open:${revision}`])
              yield* Effect.addFinalizer(() => Ref.update(lifecycle, (items) => [...items, `close:${revision}`]))
              if (fail) return yield* Effect.die(`failure:${revision}`)
            }),
        })

        yield* plugins.activate([definition("one")])
        yield* plugins.activate([definition("two")])
        yield* plugins.activate([definition("broken", true)])
        expect((yield* plugins.list())[0]?.status).toBe("failed")
        expect(yield* Ref.get(lifecycle)).toEqual([
          "open:one",
          "close:one",
          "open:two",
          "close:two",
          "open:broken",
          "close:broken",
          "open:two",
        ])

        const beforeDuplicate = yield* Ref.get(lifecycle)
        const duplicate = yield* plugins.activate([definition("a"), definition("b")]).pipe(Effect.exit)
        expect(Exit.isFailure(duplicate)).toBe(true)
        expect(yield* Ref.get(lifecycle)).toEqual(beforeDuplicate)
      }),
    ).pipe(Effect.provide(pluginLayer())),
  )

  it.effect("reports inventory failures and finalizes every active Workspace scope", () =>
    Effect.gen(function* () {
      const lifecycle = yield* Ref.make<string[]>([])
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(pluginLayer(), scope)
      const plugins = Context.get(context, Plugin.Service)
      const definition = (id: string) => ({
        id,
        revision: "one",
        effect: () => Effect.addFinalizer(() => Ref.update(lifecycle, (items) => [...items, `close:${id}`])),
      })

      yield* plugins.activate(
        [definition("a"), definition("b")],
        [{ source: { type: "local", path: "/plugin.ts" }, status: "failed", error: "import failed", tui: false }],
      )
      expect(yield* plugins.list()).toEqual([
        { id: "a", source: { type: "builtin" }, status: "active", tui: false, scope: "member" },
        { id: "b", source: { type: "builtin" }, status: "active", tui: false, scope: "member" },
        { source: { type: "local", path: "/plugin.ts" }, status: "failed", error: "import failed", tui: false },
      ])

      yield* Scope.close(scope, Exit.void)
      expect((yield* Ref.get(lifecycle)).toSorted()).toEqual(["close:a", "close:b"])
    }),
  )
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

const catalogNames = (tools: ReadonlyArray<CodeModeTool | CodeModeNamespace>): readonly string[] =>
  tools.flatMap((tool) => ("tools" in tool ? catalogNames(tool.tools ?? []) : [tool.name]))

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
