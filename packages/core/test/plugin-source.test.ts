import { layer as storageLayer } from "./fixture/storage.js"
import { layer as installationLayer } from "./fixture/installation.js"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { Event } from "@bymorning/schema/event"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Plugin } from "@bymorning/schema/plugin"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Queue, Schema, Scope, Stream } from "effect"
import { watch } from "node:fs"
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Bus } from "../src/bus.js"
import { Config } from "../src/config.js"
import type { Installation } from "../src/installation.js"
import { PluginSource } from "../src/plugin/source.js"
import { Project } from "../src/project.js"
import { ProjectStorage } from "../src/project-storage.js"
import { Storage } from "../src/storage.js"

const workspaceID = Workspace.ID.make("wrk_plugin_source")
const otherWorkspaceID = Workspace.ID.make("wrk_plugin_source_other")
const firstProjectID = ProjectSchema.ID.make("prj_00000000000000000000000001")
const secondProjectID = ProjectSchema.ID.make("prj_00000000000000000000000002")
const encoder = new TextEncoder()
const decode = Schema.decodeUnknownSync(ConfigSchema.Info)

describe("PluginSource", () => {
  it.live("preserves ordered configured package, relative, absolute, file URL, options, selectors, and mtimes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-source-")
        const relative = path.join(root, "relative.ts")
        const absolute = path.join(root, "absolute.ts")
        yield* Effect.promise(() => Promise.all([writeFile(relative, "export default {}"), writeFile(absolute, "")]))
        const value = decode({
          plugins: [
            { package: `./${path.basename(relative)}`, options: { workspace: "first" } },
            absolute,
            pathToFileURL(absolute).href,
            "-core.tool.*",
            "@scope/plugin@1.0.0",
            "-*",
          ],
        })
        const service = yield* buildSource({ root, config: config(value, root), projects: [] })

        expect((yield* service.snapshot()).operations).toEqual([
          expect.objectContaining({
            type: "config.add",
            target: relative,
            options: { workspace: "first" },
            configured: true,
          }),
          expect.objectContaining({ type: "config.add", target: absolute, options: {}, configured: false }),
          expect.objectContaining({ type: "config.add", target: absolute, options: {}, configured: false }),
          { type: "config.remove", target: "core.tool.*" },
          { type: "config.add", target: "@scope/plugin@1.0.0", options: {}, configured: false },
          { type: "config.remove", target: "*" },
        ])
        expect((yield* service.snapshot()).operations.slice(0, 3).every((item) => "mtime" in item)).toBe(true)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.live("publishes direct configured local file changes and closes its watcher with the scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-watch-")
        const source = path.join(root, "plugin.ts")
        yield* Effect.promise(() => writeFile(source, "export default {}"))
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
          PluginSource.layer(workspaceID, root).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Config.Service, config(decode({ plugins: [source] }))),
                installationLayer(),
                Layer.succeed(Project.Service, projectService([])),
                Layer.succeed(Storage.Service, yield* Storage.Service),
                Layer.succeed(Bus.Service, yield* Bus.Service),
              ),
            ),
          ),
          scope,
        )
        const service = Context.get(context, PluginSource.Service)
        yield* service.snapshot()
        const changed = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("20 millis")
        yield* Effect.promise(() => writeFile(source, "export default { revision: 2 }"))
        expect((yield* Fiber.join(changed)).length).toBe(1)

        yield* Scope.close(scope, Exit.void)
        const afterClose = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.promise(() => writeFile(source, "export default { revision: 3 }"))
        yield* Effect.sleep("100 millis")
        expect(afterClose.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(afterClose)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.live("owns a configured watcher by the source Layer scope, not the snapshot caller's scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-watch-owner-")
        const source = path.join(root, "plugin.ts")
        yield* Effect.promise(() => writeFile(source, "export default {}"))
        const layerScope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
          PluginSource.layer(workspaceID, root).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Config.Service, config(decode({ plugins: [source] }))),
                installationLayer(),
                Layer.succeed(Project.Service, projectService([])),
                Layer.succeed(Storage.Service, yield* Storage.Service),
                Layer.succeed(Bus.Service, yield* Bus.Service),
              ),
            ),
          ),
          layerScope,
        )
        const service = Context.get(context, PluginSource.Service)

        // A supervisor generation supplies a short-lived caller scope to snapshot().
        const callerScope = yield* Scope.make()
        yield* service.snapshot().pipe(Scope.provide(callerScope))
        yield* Scope.close(callerScope, Exit.void)

        // The watcher must survive the caller and still follow real file changes.
        const changed = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("20 millis")
        yield* Effect.promise(() => writeFile(source, "export default { revision: 2 }"))
        expect((yield* Fiber.join(changed)).length).toBe(1)

        // Closing the owner releases it: no later file change publishes.
        yield* Scope.close(layerScope, Exit.void)
        const afterClose = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.promise(() => writeFile(source, "export default { revision: 3 }"))
        yield* Effect.sleep("100 millis")
        expect(afterClose.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(afterClose)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.live("emits nothing for a file change reported after the owning scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-watch-closed-")
        const source = path.join(root, "plugin.ts")
        yield* Effect.promise(() => writeFile(source, "export default {}"))
        const layerScope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
          PluginSource.layer(workspaceID, root).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Config.Service, config(decode({ plugins: [source] }))),
                installationLayer(),
                Layer.succeed(Project.Service, projectService([])),
                Layer.succeed(Storage.Service, yield* Storage.Service),
                Layer.succeed(Bus.Service, yield* Bus.Service),
              ),
            ),
          ),
          layerScope,
        )
        const service = Context.get(context, PluginSource.Service)
        yield* service.snapshot()

        // One long-lived subscriber spans the close so a late publish cannot
        // hide behind a subscription that did not exist yet.
        const events = yield* Queue.unbounded<void>()
        const collector = yield* service.changes().pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkChild,
        )
        // A Bus event round-trips only once the merged stream runs, which forks
        // the watcher-fed side as well; a watcher event received afterwards
        // proves that side is subscribed. `appendFile` is one syscall and so one
        // `change` event on every platform, leaving nothing else in flight.
        const bus = yield* Bus.Service
        yield* bus.publish(ProjectSchema.Deleted, { projectID: firstProjectID })
        yield* Queue.take(events)
        yield* Effect.promise(() => appendFile(source, "\n"))
        yield* Queue.take(events)
        expect(yield* Queue.size(events)).toBe(0)

        yield* Scope.close(layerScope, Exit.void)

        // An independent watcher on the same file completes `reported` once the
        // OS has delivered the change notification for the write below. Node
        // hands the readied fs callbacks of one poll phase over together, so a
        // `setImmediate` barrier then guarantees the source's listener has run
        // if it was still registered.
        const reported = yield* Deferred.make<void>()
        yield* Effect.acquireRelease(
          Effect.sync(() => watch(source, () => Deferred.doneUnsafe(reported, Effect.void))),
          (watcher) => Effect.sync(() => watcher.close()),
        )
        yield* Effect.promise(() => writeFile(source, "export default { revision: 3 }"))
        yield* Deferred.await(reported)
        yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))

        expect(collector.pollUnsafe()).toBeUndefined()
        expect(yield* Queue.size(events)).toBe(0)
        yield* Fiber.interrupt(collector)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("discovers startup state in Project order and lexical entrypoint order while excluding helpers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-discovery-")
        yield* writeProject(workspaceID, firstProjectID, {
          "plugin/z.ts": "z",
          "plugin/a/index.ts": "a",
          "plugin/a/helper.ts": "helper",
          "plugin/nested/deep.ts": "deep",
          "plugin/policies.json": JSON.stringify({ revision: 2, policies: [] }),
        })
        yield* writeProject(workspaceID, secondProjectID, { "plugin/b.ts": "b" })
        const service = yield* buildSource({
          root,
          config: config(decode({ plugins: ["configured", "-disabled"] })),
          projects: [project(firstProjectID), project(secondProjectID)],
        })

        const snapshot = yield* service.snapshot()
        expect(snapshot.failures).toEqual([])
        expect(
          snapshot.operations.map((operation) => [
            operation.type,
            operation.type === "project.add" ? operation.key : operation.target,
          ]),
        ).toEqual([
          ["config.add", "configured"],
          ["config.remove", "disabled"],
          ["project.add", `project:${firstProjectID}:plugin/a/index.ts`],
          ["project.add", `project:${firstProjectID}:plugin/z.ts`],
          ["project.add", `project:${secondProjectID}:plugin/b.ts`],
        ])
        const projectOperations = snapshot.operations.filter((operation) => operation.type === "project.add")
        expect(projectOperations[0]?.entrypoint).toBe(
          path.join(root, workspaceID, firstProjectID, projectOperations[0]!.revision, "a/index.ts"),
        )
        expect(projectOperations[0]?.revision).toBe(projectOperations[1]?.revision)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("applies the Installation plugin allowlist on the load path and reports dropped targets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-allowlist-")
        const local = path.join(root, "local.ts")
        yield* Effect.promise(() => writeFile(local, "export default {}"))
        yield* writeProject(workspaceID, firstProjectID, { "plugin/demo.ts": "demo" })
        const policy = { value: { plugins: { allow: ["@scope/allowed"] } } as const }
        const service = yield* buildSource({
          root,
          config: config(
            decode({
              plugins: [
                "@scope/allowed",
                "@scope/denied",
                { package: `./${path.basename(local)}`, options: { mode: "strict" } },
                "-core.tool.*",
                "*",
                "bymorning.share",
              ],
            }),
            root,
          ),
          projects: [project(firstProjectID)],
          policy,
        })

        const snapshot = yield* service.snapshot()
        expect(
          snapshot.operations.map((operation) => [
            operation.type,
            operation.type === "project.add" ? operation.key : operation.target,
          ]),
        ).toEqual([
          ["config.add", "@scope/allowed"],
          // An allowlist names package targets; Project plugins are not packages.
          ["project.add", `project:${firstProjectID}:plugin/demo.ts`],
        ])
        // Selectors name no plugin and are dropped silently; configured targets are reported.
        expect(snapshot.failures).toEqual([
          {
            source: { type: "package", package: "@scope/denied" },
            status: "failed",
            error: PluginSource.blocked,
            tui: false,
          },
          { source: { type: "local", path: local }, status: "failed", error: PluginSource.blocked, tui: false },
          {
            source: { type: "package", package: "bymorning.share" },
            status: "failed",
            error: PluginSource.blocked,
            tui: false,
          },
        ])

        // Lifting the lock between snapshots restores the targets without a new source.
        policy.value = {} as never
        const unlocked = yield* service.snapshot()
        expect(unlocked.failures).toEqual([])
        expect(unlocked.operations).toHaveLength(7)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("keeps every plugin off the load path when the Installation Policy turns plugins off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-off-")
        yield* writeProject(workspaceID, firstProjectID, {
          "plugin/demo.ts": "demo",
          "plugin/nested/index.ts": "nested",
          "plugin/nested/helper.ts": "helper",
        })
        const service = yield* buildSource({
          root,
          config: config(decode({ plugins: ["@scope/example", "-core.tool.*"] })),
          projects: [project(firstProjectID)],
          policy: { value: { plugins: "off" } },
        })

        const snapshot = yield* service.snapshot()
        expect(snapshot.operations).toEqual([])
        expect(snapshot.failures).toEqual([
          {
            source: { type: "package", package: "@scope/example" },
            status: "failed",
            error: PluginSource.blocked,
            tui: false,
          },
          {
            source: { type: "project", projectID: firstProjectID, path: "plugin/demo.ts" },
            status: "failed",
            error: PluginSource.blocked,
            tui: false,
          },
          {
            source: { type: "project", projectID: firstProjectID, path: "plugin/nested/index.ts" },
            status: "failed",
            error: PluginSource.blocked,
            tui: false,
          },
        ])
        // Nothing was materialized for a Project whose plugins cannot load.
        expect(
          yield* Effect.promise(() =>
            stat(path.join(root, workspaceID)).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("isolates the same Project identity between Workspaces", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-isolation-")
        yield* writeProject(workspaceID, firstProjectID, { "plugin/demo.ts": "first workspace" })
        yield* writeProject(otherWorkspaceID, firstProjectID, { "plugin/demo.ts": "other workspace" })
        const first = yield* buildSource({ root, config: config(decode({})), projects: [project(firstProjectID)] })
        const second = yield* buildSource({
          root,
          workspaceID: otherWorkspaceID,
          config: config(decode({})),
          projects: [project(firstProjectID)],
        })
        const firstOperation = (yield* first.snapshot()).operations.find((item) => item.type === "project.add")
        const secondOperation = (yield* second.snapshot()).operations.find((item) => item.type === "project.add")

        expect(firstOperation?.type).toBe("project.add")
        expect(secondOperation?.type).toBe("project.add")
        if (firstOperation?.type !== "project.add" || secondOperation?.type !== "project.add") return
        expect(firstOperation.revision).not.toBe(secondOperation.revision)
        expect(firstOperation.entrypoint).toContain(path.join(root, workspaceID, firstProjectID))
        expect(secondOperation.entrypoint).toContain(path.join(root, otherWorkspaceID, firstProjectID))
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("reports a config refresh failure as a safe inventory row and keeps last entries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const value = decode({ plugins: ["configured"] })
        const service = yield* buildSource({
          root: yield* temporaryDirectory("bm-plugin-refresh-"),
          config: {
            ...config(value),
            refresh: Effect.die(new Error("token=super-secret")),
          },
          projects: [],
        })
        const snapshot = yield* service.snapshot()
        expect(snapshot.operations).toEqual([
          { type: "config.add", target: "configured", options: {}, configured: false },
        ])
        expect(snapshot.failures).toEqual([
          expect.objectContaining({
            source: { type: "builtin" },
            status: "failed",
            error: "Plugin config refresh failed",
            tui: false,
          }),
        ])
        expect(snapshot.failures[0]?.ref).toMatch(/^err_[0-9a-f]{8}$/)
        expect(JSON.stringify(snapshot.failures)).not.toContain("super-secret")
        expect(JSON.stringify(snapshot.failures)).not.toContain("token=")
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.effect("reports one failed inventory row and suppresses only that Project's operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-failure-")
        const memory = yield* Storage.Service
        const failing = Storage.Service.of({
          ...memory,
          object: {
            ...memory.object,
            list: (prefix) =>
              JSON.stringify(prefix).includes(secondProjectID)
                ? Effect.fail(
                    new Storage.OperationError({
                      operation: "list",
                      cause: new Error("Project storage unavailable"),
                      message: "Project storage unavailable",
                      providerID: Storage.ID.make("memory"),
                    }),
                  )
                : memory.object.list(prefix),
          },
        })
        yield* writeProject(workspaceID, firstProjectID, { "plugin/healthy.ts": "healthy" })
        const service = yield* buildSource({
          root,
          config: config(decode({ plugins: ["configured"] })),
          projects: [project(firstProjectID), project(secondProjectID)],
        }).pipe(Effect.provideService(Storage.Service, failing))

        const snapshot = yield* service.snapshot()
        expect(
          snapshot.operations.map((operation) => (operation.type === "project.add" ? operation.key : operation.target)),
        ).toEqual(["configured", `project:${firstProjectID}:plugin/healthy.ts`])
        expect(snapshot.failures).toEqual([
          expect.objectContaining({
            source: { type: "project", projectID: secondProjectID },
            status: "failed",
            tui: false,
          }),
        ])
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.live("ignores inventory and non-plugin Project events and emits for plugin support files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-events-")
        const service = yield* buildSource({ root, config: config(decode({})), projects: [] })
        const bus = yield* Bus.Service
        const changed = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("100 millis")
        yield* bus.publish(ProjectSchema.FileChanged, {
          projectID: firstProjectID,
          path: ProjectDirectory.Path.make("notes.txt"),
        })
        yield* bus.publish(Plugin.Event.Updated, {})
        yield* Effect.sleep("100 millis")
        expect(changed.pollUnsafe()).toBeUndefined()
        yield* bus.publish(ProjectSchema.FileChanged, {
          projectID: firstProjectID,
          path: ProjectDirectory.Path.make("plugin/lib/helper.ts"),
        })
        yield* Effect.sleep("100 millis")
        expect((yield* Fiber.join(changed)).length).toBe(1)
      }).pipe(Effect.provide(testLayer)),
    ),
  )

  it.live("emits for every Project deletion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory("bm-plugin-delete-events-")
        const service = yield* buildSource({ root, config: config(decode({})), projects: [] })
        const bus = yield* Bus.Service
        const changed = yield* service.changes().pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("100 millis")

        yield* bus.publish(ProjectSchema.Deleted, { projectID: firstProjectID })

        expect((yield* Fiber.join(changed)).length).toBe(1)
      }).pipe(Effect.provide(testLayer)),
    ),
  )
})

function buildSource(input: {
  readonly root: string
  readonly workspaceID?: Workspace.ID
  readonly config: Config.Interface
  readonly projects: readonly ProjectSchema.Info[]
  readonly policy?: { value: Installation.Policy }
}) {
  return Effect.gen(function* () {
    const context = yield* Layer.build(
      PluginSource.layer(input.workspaceID ?? workspaceID, input.root).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Config.Service, input.config),
            installationLayer(input.policy),
            Layer.succeed(Project.Service, projectService(input.projects)),
            Layer.succeed(Storage.Service, yield* Storage.Service),
            Layer.succeed(Bus.Service, yield* Bus.Service),
          ),
        ),
      ),
    )
    return Context.get(context, PluginSource.Service)
  })
}

function config(value: ConfigSchema.Info, directory?: string): Config.Interface {
  return {
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: Effect.succeed(value),
    update: () => Effect.die("unused"),
    refresh: Effect.succeed(value),
    mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    modelPolicy: {
      reconcile: () => Effect.die("unused"),
      initialize: () => Effect.die("unused"),
      toggle: () => Effect.die("unused"),
      setDefault: () => Effect.die("unused"),
    },
    plugin: Config.pluginUnavailable,
    entries: () =>
      Effect.succeed([
        { type: "document", ...(directory ? { path: path.join(directory, "config.json") } : {}), info: value },
      ]),
    changes: () => Stream.never,
  }
}

function projectService(projects: readonly ProjectSchema.Info[]): Project.Interface {
  return {
    create: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    list: (options) => Effect.succeed(options?.archived ? [] : projects),
    update: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
  }
}

function project(id: ProjectSchema.ID): ProjectSchema.Info {
  return { id, name: id, time_created: 0, time_updated: 0 }
}

const writeProject = (workspace: Workspace.ID, projectID: ProjectSchema.ID, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const storage = yield* ProjectStorage.make(workspace, projectID)
    for (const [file, contents] of Object.entries(files)) {
      yield* storage.set(file.split("/"), { body: Stream.succeed(encoder.encode(contents)) })
    }
  })

const temporaryDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(tmpdir(), prefix))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )

const busLayer = Layer.effect(
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

const testLayer = Layer.merge(storageLayer, busLayer)
