import { layer as storageLayer } from "./fixture/storage.js"
import { busLayer, decode, project, supervisorGraph, writeStorage } from "./fixture/plugin-graph.js"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import type { Plugin as PluginDefinition } from "@bymorning/plugin/effect/plugin"
import { Event } from "@bymorning/schema/event"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  Logger,
  PubSub,
  Queue,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Bus } from "../src/bus.js"
import { Credential } from "../src/credential.js"
import type { Installation } from "../src/installation.js"
import { Integration } from "../src/integration.js"
import { Plugin } from "../src/plugin.js"
import { PluginPackage } from "../src/plugin/package.js"
import { PluginUpdate } from "../src/plugin-update.js"
import { PluginSource } from "../src/plugin/source.js"
import { PluginSupervisor } from "../src/plugin/supervisor.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { ProjectStorage } from "../src/project-storage.js"
import { Storage } from "../src/storage.js"
import { Tool } from "../src/tool.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { AppProcess } from "../src/util/process.js"

describe("PluginSupervisor", () => {
  it.live("shares source-driven reconciliation across stable awaitActivationes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporaryDirectory(".plugin-reconciliation-")
        const entrypoint = path.join(root, "plugin.ts")
        yield* Effect.promise(() => writeFile(entrypoint, idModule("reconciliation.project")))
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000006")
        const pluginPath = ProjectDirectory.Path.make("plugin/demo.ts")
        const revision = { value: "v1" }
        const activations = yield* Ref.make(0)
        const snapshots = yield* Ref.make(0)
        const updates = yield* PubSub.unbounded<void>()
        const source = Layer.succeed(
          PluginSource.Service,
          PluginSource.Service.of({
            snapshot: () =>
              Ref.update(snapshots, (count) => count + 1).pipe(
                Effect.as({
                  operations: [
                    {
                      type: "project.add" as const,
                      key: `project:${projectID}:${pluginPath}` as const,
                      projectID,
                      path: pluginPath,
                      entrypoint,
                      revision: revision.value,
                    },
                  ],
                  failures: [],
                }),
              ),
            changes: () => Stream.fromPubSub(updates),
          }),
        )
        const registry = Layer.succeed(
          Plugin.Service,
          registryOf({
            activate: () => Ref.update(activations, (count) => count + 1),
            list: () => Effect.succeed([]),
          }),
        )
        const packages = Layer.succeed(
          PluginPackage.Service,
          PluginPackage.Service.of({ resolve: (target) => Effect.fail(new PluginPackage.ResolveError({ target })) }),
        )
        const context = yield* Layer.build(
          PluginSupervisor.layerWith(Effect.succeed({ pre: [], post: [] })).pipe(
            Layer.provideMerge(Layer.mergeAll(source, registry, packages)),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)

        yield* supervisor.awaitActivation
        yield* Effect.all(
          Array.from({ length: 8 }, () => supervisor.awaitActivation),
          { concurrency: "unbounded" },
        )
        expect(yield* Ref.get(activations)).toBe(1)
        expect(yield* Ref.get(snapshots)).toBe(1)

        revision.value = "v2"
        yield* PubSub.publish(updates, undefined)
        yield* supervisor.awaitActivation
        expect(yield* Ref.get(activations)).toBe(2)
        expect(yield* Ref.get(snapshots)).toBe(2)
      }),
    ),
  )

  it.effect("activates the initial generation without waiting for the reload debounce", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const snapshots = { count: 0 }
        const context = yield* Layer.build(
          supervisorTestGraph(
            countingSource(snapshots, Stream.never),
            registryOf({ activate: () => Effect.void, list: () => Effect.succeed([]) }),
          ),
        )
        // The TestClock never advances here, so any timer between boot and the first activation would hang this.
        yield* Context.get(context, PluginSupervisor.Service).awaitActivation
        expect(snapshots.count).toBe(1)
      }),
    ),
  )

  it.effect("reloads for a trigger published while the initial generation is activating", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const snapshots = { count: 0 }
        const changes = yield* PubSub.unbounded<void>()
        const entered = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const context = yield* Layer.build(
          supervisorTestGraph(
            countingSource(snapshots, Stream.fromPubSub(changes)),
            registryOf({
              activate: () =>
                snapshots.count === 1
                  ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))
                  : Effect.void,
              list: () => Effect.succeed([]),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* Deferred.await(entered)
        // Generation 0 is mid-activation: the source feed must already be subscribed for this update to count.
        yield* PubSub.publish(changes, undefined)
        const ready = yield* supervisor.awaitActivation.pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.succeed(gate, undefined)
        yield* advance(() => ready.pollUnsafe() !== undefined)
        yield* Fiber.join(ready)
        expect(snapshots.count).toBe(2)
      }),
    ),
  )

  it.effect("coalesces a burst of reload triggers after the initial generation into one activation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const snapshots = { count: 0 }
        const changes = yield* PubSub.unbounded<void>()
        const context = yield* Layer.build(
          supervisorTestGraph(
            countingSource(snapshots, Stream.fromPubSub(changes)),
            registryOf({ activate: () => Effect.void, list: () => Effect.succeed([]) }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation
        expect(snapshots.count).toBe(1)

        yield* PubSub.publish(changes, undefined)
        yield* PubSub.publish(changes, undefined)
        yield* PubSub.publish(changes, undefined)
        yield* advance(() => snapshots.count > 1)
        yield* supervisor.awaitActivation
        expect(snapshots.count).toBe(2)
      }),
    ),
  )

  it.live("reload snapshots and activates source before the watcher consumes its event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* Queue.unbounded<void>()
        const watcher = yield* Deferred.make<void>()
        const revision = { value: "v1" }
        const activated = yield* Ref.make<readonly string[]>([])
        const context = yield* Layer.build(
          supervisorTestGraph(
            PluginSource.Service.of({
              snapshot: () =>
                Effect.succeed({
                  operations: [projectOperation(revision.value)],
                  failures: [],
                }),
              changes: () =>
                Stream.fromEffect(Deferred.await(watcher)).pipe(Stream.flatMap(() => Stream.fromQueue(changes))),
            }),
            registryOf({
              activate: (plugins) =>
                Ref.set(
                  activated,
                  plugins.map(({ revision }) => revision),
                ),
              list: () => Effect.succeed([]),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation

        revision.value = "v2"
        yield* Queue.offer(changes, undefined)
        yield* supervisor.reload

        expect(yield* Ref.get(activated)).toEqual(["v2"])
      }),
    ),
  )

  it.live("serializes explicit reload with watcher activation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* PubSub.unbounded<void>()
        const starts = yield* Queue.unbounded<void>()
        const release = yield* Deferred.make<void>()
        const blocked = { value: false }
        const context = yield* Layer.build(
          supervisorTestGraph(
            PluginSource.Service.of({
              snapshot: () => Effect.succeed({ operations: [], failures: [] }),
              changes: () => Stream.fromPubSub(changes),
            }),
            registryOf({
              activate: () =>
                blocked.value
                  ? Queue.offer(starts, undefined).pipe(Effect.andThen(Deferred.await(release)))
                  : Effect.void,
              list: () => Effect.succeed([]),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation

        blocked.value = true
        yield* PubSub.publish(changes, undefined)
        yield* Queue.take(starts)
        const explicit = yield* supervisor.reload.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Queue.size(starts)).toBe(0)

        yield* Deferred.succeed(release, undefined)
        yield* Queue.take(starts)
        yield* Fiber.join(explicit)
      }),
    ),
  )

  it.live("serializes concurrent Project manifest read-modify-write mutations before snapshot activation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstRead = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const secondRead = yield* Deferred.make<void>()
        const values = yield* Ref.make<readonly string[]>([])
        const context = yield* Layer.build(
          supervisorTestGraph(
            PluginSource.Service.of({
              snapshot: () => Effect.succeed({ operations: [], failures: [] }),
              changes: () => Stream.never,
            }),
            registryOf({ activate: () => Effect.void, list: () => Effect.succeed([]) }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation

        const first = yield* supervisor
          .reloadAfter(
            Effect.gen(function* () {
              const current = yield* Ref.get(values)
              yield* Deferred.succeed(firstRead, undefined)
              yield* Deferred.await(release)
              yield* Ref.set(values, [...current, "first"])
            }),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstRead)
        const second = yield* supervisor
          .reloadAfter(
            Effect.gen(function* () {
              const current = yield* Ref.get(values)
              yield* Deferred.succeed(secondRead, undefined)
              yield* Ref.set(values, [...current, "second"])
            }),
          )
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(secondRead)).toBe(false)

        yield* Deferred.succeed(release, undefined)
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(yield* Ref.get(values)).toEqual(["first", "second"])
      }),
    ),
  )

  it.effect("surfaces a failed reload ticket in inventory without copying cause text", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const snapshots = { count: 0 }
        const inventory = yield* Ref.make<PluginSchema.Info[]>([])
        const context = yield* Layer.build(
          supervisorTestGraph(
            PluginSource.Service.of({
              snapshot: () =>
                Effect.sync(() => {
                  snapshots.count++
                  if (snapshots.count > 1) throw new Error("password=hunter2")
                  return { operations: [], failures: [] }
                }),
              changes: () => Stream.never,
            }),
            registryOf({
              activate: (_plugins, failures = []) => Ref.set(inventory, [...failures]),
              list: () => Ref.get(inventory),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation
        expect(yield* Ref.get(inventory)).toEqual([])
        expect(Exit.isFailure(yield* supervisor.reload.pipe(Effect.exit))).toBe(true)
        const failed = (yield* Ref.get(inventory)).filter((plugin) => plugin.status === "failed")
        expect(failed).toEqual([
          expect.objectContaining({
            source: { type: "builtin" },
            status: "failed",
            error: "Plugin reload failed",
            tui: false,
          }),
        ])
        expect(failed[0]?.ref).toMatch(/^err_[0-9a-f]{8}$/)
        expect(JSON.stringify(failed)).not.toContain("hunter2")
        expect(JSON.stringify(failed)).not.toContain("password=")
        const encoded = yield* Schema.encodeEffect(Schema.Array(PluginSchema.Info))(failed)
        expect(yield* Schema.decodeUnknownEffect(Schema.Array(PluginSchema.Info))(encoded)).toEqual(failed)
      }),
    ),
  )

  it.effect("identifies plugin and hook when reload dies while draining", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activations = { count: 0 }
        const inventory = yield* Ref.make<PluginSchema.Info[]>([])
        const pluginID = PluginSchema.ID.make("bymorning.limiter")
        const context = yield* Layer.build(
          supervisorTestGraph(
            countingSource({ count: 0 }, Stream.never),
            registryOf({
              activate: (_plugins, failures = []) =>
                Effect.gen(function* () {
                  activations.count++
                  if (activations.count === 2) {
                    return yield* Effect.die(
                      new PluginSchema.ActivationError({
                        pluginID,
                        message: "Required Plugin is not active",
                      }),
                    )
                  }
                  yield* Ref.set(inventory, [...failures])
                }),
              list: () => Ref.get(inventory),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation
        expect(Exit.isFailure(yield* supervisor.reload.pipe(Effect.exit))).toBe(true)
        const failed = (yield* Ref.get(inventory)).filter((plugin) => plugin.status === "failed")
        expect(failed).toEqual([
          expect.objectContaining({
            id: pluginID,
            source: { type: "builtin" },
            status: "failed",
            error: "Plugin reload failed (bymorning.limiter model.invoke)",
            tui: false,
          }),
        ])
        expect(failed[0]?.ref).toMatch(/^err_[0-9a-f]{8}$/)
      }),
    ),
  )

  it.live("does not retry an unchanged failed generation when restoring the previous one triggers a reload", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* PubSub.unbounded<void>()
        const revision = { value: "v1" }
        const activated: string[] = []
        const context = yield* Layer.build(
          supervisorTestGraph(
            PluginSource.Service.of({
              snapshot: () => Effect.succeed({ operations: [projectOperation(revision.value)], failures: [] }),
              changes: () => Stream.fromPubSub(changes),
            }),
            registryOf({
              activate: (plugins) =>
                Effect.gen(function* () {
                  const revisions = plugins.map((plugin) => plugin.revision).join(",")
                  activated.push(revisions)
                  if (revisions === "bad") return yield* Effect.die(new Error("generation cannot activate"))
                  // Restoring the previous generation changes Integration availability, which is a reload trigger.
                  if (activated.length > 1) yield* PubSub.publish(changes, undefined)
                }),
              list: () => Effect.succeed([]),
            }),
          ),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation
        expect(activated).toEqual(["v1"])

        revision.value = "bad"
        yield* PubSub.publish(changes, undefined)
        // Readiness settles: the restoration's trigger resolves to the same failed generation and is not retried.
        yield* supervisor.awaitActivation
        expect(activated).toEqual(["v1", "bad", "v1"])
        expect(Exit.isFailure(yield* supervisor.reload.pipe(Effect.exit))).toBe(true)
        expect(activated).toEqual(["v1", "bad", "v1"])

        // A changed source is tried again.
        revision.value = "v2"
        yield* supervisor.reload
        expect(activated).toEqual(["v1", "bad", "v1", "v2"])
      }),
    ),
  )

  it.effect("resolves installed package roots when no server export exists", () =>
    Effect.gen(function* () {
      const packages = yield* PluginPackage.Service
      expect(yield* packages.resolve("@bymorning/plugin")).toContain("packages/plugin/src/promise/index.ts")
    }).pipe(Effect.provide(PluginPackage.layer)),
  )

  it.live("applies selectors, package options, failures, and pre/package/post ordering", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-supervisor-")))
        const journal = path.join(root, "journal.log")
        const packageFile = path.join(root, "package.ts")
        const promiseFile = path.join(root, "promise.ts")
        yield* Effect.promise(() => writeFile(packageFile, moduleSource(journal)))
        yield* Effect.promise(() => writeFile(promiseFile, promiseModuleSource(journal)))
        const graph = supervisorGraph(
          decode({
            plugins: [
              "-pre.remove",
              "*",
              { package: "demo-package", options: { label: "configured" } },
              "promise-package",
              "-post.*",
            ],
          }),
          { "demo-package": packageFile, "promise-package": promiseFile },
          [definition("pre.keep", journal), definition("pre.remove", journal)],
          [definition("post.remove", journal), definition("post.keep", journal)],
        )
        const services = yield* Layer.build(graph)
        const supervisor = Context.get(services, PluginSupervisor.Service)
        const plugins = Context.get(services, Plugin.Service)
        yield* supervisor.awaitActivation

        expect((yield* plugins.list()).map((item) => (item.status === "active" ? item.id : item.status))).toEqual([
          "pre.keep",
          "pre.remove",
          "demo.package",
          "demo.promise",
        ])
        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("configured")
        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("promise-load")
      }),
    ),
  )

  it.live("reports a duplicate plugin ID as a failure without dropping the generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-duplicate-")))
        const journal = path.join(root, "journal.log")
        const shared = path.join(root, "shared.ts")
        // The package copy registers under the builtin's ID; the journal shows which one activated.
        yield* Effect.promise(() =>
          writeFile(
            shared,
            `import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
export default { id: "pre.keep", effect: () => Effect.sync(() => appendFileSync(${JSON.stringify(journal)}, "package-copy\\n")) }`,
          ),
        )
        const services = yield* Layer.build(
          supervisorGraph(
            decode({ plugins: ["shared-package"] }),
            { "shared-package": shared },
            [definition("pre.keep", journal), definition("pre.other", journal)],
            [definition("post.keep", journal)],
          ),
        )
        yield* Context.get(services, PluginSupervisor.Service).awaitActivation

        // Earlier boot order wins: the builtin activates and the package copy is reported.
        expect(yield* Context.get(services, Plugin.Service).list()).toEqual([
          { id: "pre.keep", source: { type: "builtin" }, status: "active", tui: false, scope: "member" },
          { id: "pre.other", source: { type: "builtin" }, status: "active", tui: false, scope: "member" },
          { id: "post.keep", source: { type: "builtin" }, status: "active", tui: false, scope: "member" },
          {
            id: "pre.keep",
            source: { type: "package", package: "shared-package" },
            status: "failed",
            error: "Duplicate plugin ID: pre.keep",
            tui: false,
          },
        ])
        const log = yield* Effect.promise(() => readFile(journal, "utf8"))
        expect(log).toContain("pre.keep\n")
        expect(log).not.toContain("package-copy")
      }),
    ),
  )

  it.live("logs load failures with a reference and keeps loader details out of inventory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-diagnostics-")))
        const journal = path.join(root, "journal.log")
        const missing = path.join(root, "missing-plugin.ts")
        const invalid = path.join(root, "invalid.ts")
        const throwing = path.join(root, "load-failure.ts")
        const valid = path.join(root, "valid.ts")
        yield* Effect.promise(() => writeFile(invalid, "export const value = 1"))
        yield* Effect.promise(() => writeFile(throwing, 'throw new Error("private plugin loader details")'))
        yield* Effect.promise(() => writeFile(valid, moduleSource(journal)))
        const output: Array<{ target: string; ref: string; diagnostic: string }> = []
        const logger = Logger.make(({ message }) => {
          if (!Array.isArray(message) || message[0] !== "failed to load plugin") return
          const details = message[1]
          if (typeof details !== "object" || details === null) return
          if (!("target" in details) || typeof details.target !== "string") return
          if (!("ref" in details) || typeof details.ref !== "string") return
          if (!("cause" in details) || !Cause.isCause(details.cause)) return
          output.push({ target: details.target, ref: details.ref, diagnostic: Cause.pretty(details.cause) })
        })
        const services = yield* Layer.build(
          supervisorGraph(decode({ plugins: [missing, invalid, throwing, valid, "missing-package"] }), {}, [], []),
        ).pipe(Effect.provide(Logger.layer([logger])))
        const supervisor = Context.get(services, PluginSupervisor.Service)
        const plugins = Context.get(services, Plugin.Service)
        yield* supervisor.awaitActivation

        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("load:package")
        expect(output.map((entry) => entry.target)).toEqual([missing, invalid, throwing, "missing-package"])
        const failed = (yield* plugins.list()).filter((plugin) => plugin.status === "failed")
        expect(failed.map((plugin) => plugin.source)).toEqual([
          { type: "local", path: missing },
          { type: "local", path: invalid },
          { type: "local", path: throwing },
          { type: "package", package: "missing-package" },
        ])
        expect(failed.map(({ error, ref }) => ({ error, ref }))).toEqual([
          // The loader's own diagnosis names the error class; filesystem paths beyond the plugin are redacted.
          { error: expect.stringMatching(/^ERR_MODULE_NOT_FOUND: Cannot find module /), ref: output[0]?.ref },
          {
            error:
              "Plugin must export a named plugin or default definition with an id and an effect or setup function.",
            ref: output[1]?.ref,
          },
          // A value thrown by plugin code contributes only its class.
          { error: "Plugin failed to load (Error)", ref: output[2]?.ref },
          { error: "Plugin entrypoint not found: missing-package", ref: output[3]?.ref },
        ])
        output.forEach((entry) => expect(entry.ref).toMatch(/^err_[0-9a-f]{8}$/))
        expect(new Set(output.map((entry) => entry.ref)).size).toBe(4)
        expect(output[2]?.diagnostic).toContain("private plugin loader details")
        expect(JSON.stringify(failed)).not.toContain("private plugin loader details")
        expect(failed[0]?.error).not.toContain(path.dirname(missing).slice(1))
        const encoded = yield* Schema.encodeEffect(Schema.Array(PluginSchema.Info))(failed)
        expect(yield* Schema.decodeUnknownEffect(Schema.Array(PluginSchema.Info))(encoded)).toEqual(failed)
      }),
    ),
  )

  it.live("treats removed config replay selectors as inert instead of imports or failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activated = yield* Ref.make<readonly string[]>([])
        const failures = yield* Ref.make<readonly string[]>([])
        const imports = yield* Ref.make(0)
        const context = yield* Layer.build(
          PluginSupervisor.layerWith(
            Effect.succeed({
              pre: [definition("pre.keep", path.join(tmpdir(), "inert-selectors"))],
              post: [definition("post.keep", path.join(tmpdir(), "inert-selectors"))],
            }),
          ).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  PluginSource.Service,
                  PluginSource.Service.of({
                    snapshot: () =>
                      Effect.succeed({
                        operations: [
                          { type: "config.add", target: "bymorning.config.command", options: {}, configured: false },
                          { type: "config.remove", target: "bymorning.config.command" },
                          { type: "config.remove", target: "bymorning.config.*" },
                          { type: "config.add", target: "core.tool.removed", options: {}, configured: false },
                          { type: "config.remove", target: "core.tool.removed" },
                          { type: "config.remove", target: "core.tool.*" },
                        ] satisfies PluginSource.Operation[],
                        failures: [],
                      }),
                    changes: () => Stream.never,
                  }),
                ),
                Layer.succeed(
                  Plugin.Service,
                  registryOf({
                    activate: (plugins, recordedFailures) =>
                      Effect.all([
                        Ref.set(
                          activated,
                          plugins.map((plugin) => plugin.id),
                        ),
                        Ref.set(
                          failures,
                          (recordedFailures ?? []).map((failure) => failure.id ?? "?"),
                        ),
                      ]).pipe(Effect.asVoid),
                    list: () => Effect.succeed([]),
                  }),
                ),
                Layer.succeed(
                  PluginPackage.Service,
                  PluginPackage.Service.of({
                    resolve: (target) =>
                      Ref.update(imports, (count) => count + 1).pipe(
                        Effect.andThen(Effect.fail(new PluginPackage.ResolveError({ target }))),
                      ),
                  }),
                ),
              ),
            ),
          ),
        )
        yield* Context.get(context, PluginSupervisor.Service).awaitActivation

        expect(yield* Ref.get(activated)).toEqual(["pre.keep", "post.keep"])
        expect(yield* Ref.get(failures)).toEqual([])
        expect(yield* Ref.get(imports)).toBe(0)
      }),
    ),
  )

  it.effect("applies configured options to a built-in plugin and exposes its form configuration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const received = yield* Ref.make<unknown>(undefined)
        const services = yield* Layer.build(
          supervisorGraph(
            decode({ plugins: [{ package: "builtin.configured", options: { enabled: false } }] }),
            {},
            [
              {
                id: "builtin.configured",
                configuration: {
                  title: "Configured built-in",
                  fields: [
                    { key: "enabled", type: "boolean", default: true },
                    {
                      key: "mode",
                      type: "string",
                      default: "strict",
                      when: [{ key: "enabled", op: "eq", value: true }],
                    },
                  ],
                },
                effect: (context) => Ref.set(received, context.options),
              },
            ],
            [],
          ),
        )
        const supervisor = Context.get(services, PluginSupervisor.Service)
        const plugins = Context.get(services, Plugin.Service)

        yield* supervisor.reload

        expect(yield* Ref.get(received)).toEqual({ enabled: false })
        expect(yield* plugins.list()).toContainEqual({
          id: "builtin.configured",
          source: { type: "builtin" },
          status: "active",
          tui: false,
          scope: "member",
          configuration: {
            title: "Configured built-in",
            fields: [
              { key: "enabled", type: "boolean", default: true },
              {
                key: "mode",
                type: "string",
                default: "strict",
                when: [{ key: "enabled", op: "eq", value: true }],
              },
            ],
            values: { enabled: false },
            configured: true,
          },
        })
      }),
    ),
  )

  it.effect("keeps failed inventory schema-encodable for invalid and excess configuration definitions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const definitions = [
          {
            id: "builtin.external-configuration",
            configuration: {
              title: "External",
              fields: [
                { key: "login", type: "external", url: "/login", unexpected: true },
                { key: "token", type: "string", secret: true },
              ],
              unexpected: true,
            },
            effect: () => Effect.void,
          },
          {
            id: "builtin.secret-configuration",
            configuration: {
              title: "Secret",
              fields: [{ key: "token", type: "string", secret: true }],
            },
            effect: () => Effect.void,
          },
          {
            id: "builtin.excess-configuration",
            configuration: {
              title: "Excess",
              fields: [{ key: "enabled", type: "boolean", default: true, unexpected: true }],
              unexpected: true,
            },
            effect: () => Effect.die("activation failed"),
          },
        ] as unknown as readonly PluginDefinition<never>[]
        const services = yield* Layer.build(supervisorGraph(decode({}), {}, definitions, []))
        const supervisor = Context.get(services, PluginSupervisor.Service)
        yield* supervisor.reload

        const inventory = yield* Context.get(services, Plugin.Service).list()
        expect(inventory.map(({ status }) => status)).toEqual(["failed", "failed", "failed"])
        expect(inventory[0]).not.toHaveProperty("configuration")
        expect(inventory[1]).not.toHaveProperty("configuration")
        expect(inventory[2]).toMatchObject({
          configuration: {
            title: "Excess",
            fields: [{ key: "enabled", type: "boolean", default: true }],
            values: { enabled: true },
            configured: false,
          },
        })
        expect(inventory[2]?.configuration).not.toHaveProperty("unexpected")
        expect(inventory[2]?.configuration?.fields[0]).not.toHaveProperty("unexpected")

        const encoded = yield* Schema.encodeEffect(Schema.Array(PluginSchema.Info))(inventory)
        expect(yield* Schema.decodeUnknownEffect(Schema.Array(PluginSchema.Info))(encoded)).toEqual(inventory)
      }),
    ),
  )

  it.live("keeps the running generation when an updated local plugin fails to import", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-failure-")))
        const source = path.join(root, "plugin.ts")
        const journal = path.join(root, "journal.log")
        yield* Effect.promise(() => writeFile(source, moduleSource(journal)))
        const updates = yield* PubSub.unbounded<void>()
        const current = { value: decode({ plugins: [source] }) }
        const services = yield* Layer.build(supervisorGraph(current.value, {}, [], [], updates, current))
        const supervisor = Context.get(services, PluginSupervisor.Service)
        const plugins = Context.get(services, Plugin.Service)
        yield* supervisor.awaitActivation
        expect((yield* plugins.list())[0]?.status).toBe("active")

        yield* Effect.sleep("5 millis")
        yield* Effect.promise(() => writeFile(source, "export const broken ="))
        yield* Effect.promise(() => utimes(source, new Date(), new Date(Date.now() + 1_000)))
        yield* PubSub.publish(updates, undefined)
        yield* Effect.sleep("20 millis")
        yield* supervisor.awaitActivation
        // The broken revision never produced a generation, so the previous one keeps running beside the failure.
        expect(yield* plugins.list()).toEqual([
          { id: "demo.package", source: { type: "local", path: source }, status: "active", tui: false, scope: "member" },
          expect.objectContaining({ status: "failed", source: { type: "local", path: source } }),
        ])
        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).not.toContain("cleanup")

        // A later working revision replaces it and clears the failure.
        yield* Effect.promise(() => writeFile(source, moduleSource(journal, "fixed")))
        yield* Effect.promise(() => utimes(source, new Date(), new Date(Date.now() + 2_000)))
        yield* PubSub.publish(updates, undefined)
        yield* Effect.sleep("20 millis")
        yield* supervisor.awaitActivation
        expect(yield* plugins.list()).toEqual([
          { id: "demo.package", source: { type: "local", path: source }, status: "active", tui: false, scope: "member" },
        ])
        const log = yield* Effect.promise(() => readFile(journal, "utf8"))
        expect(log).toContain("cleanup:package:configured")
        expect(log).toContain("load:fixed:configured")
      }),
    ),
  )

  it.live(
    "activates Project Storage entrypoints with relative helpers beside configured local plugins and replaces v1 once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cacheRoot = yield* temporaryDirectory(".project-plugin-supervisor-")
          const journal = path.join(cacheRoot, "journal.log")
          const local = path.join(cacheRoot, "local.ts")
          const workspaceID = Workspace.ID.make("wrk_project_supervisor")
          const projectID = ProjectSchema.ID.make("prj_00000000000000000000000001")
          const storage = yield* Storage.Service
          const projectStorage = yield* ProjectStorage.make(workspaceID, projectID)
          const changes = yield* PubSub.unbounded<void>()
          yield* Effect.promise(() => writeFile(local, moduleSource(journal, "configured")))
          yield* writeStorage(projectStorage, "plugin/lib/helper.ts", `export const revision = "v1"`)
          yield* writeStorage(projectStorage, "plugin/demo.ts", projectModuleSource(journal))

          const context = yield* Layer.build(
            supervisorGraph(decode({ plugins: [local] }), {}, [], [], changes, undefined, {
              workspaceID,
              cacheRoot,
              projects: [project(projectID)],
              storage,
            }),
          )
          const supervisor = Context.get(context, PluginSupervisor.Service)
          const plugins = Context.get(context, Plugin.Service)
          const bus = Context.get(context, Bus.Service)
          yield* supervisor.awaitActivation
          expect((yield* plugins.list()).map((item) => item.source)).toEqual([
            { type: "local", path: local },
            { type: "project", projectID, path: "plugin/demo.ts" },
          ])
          const persisted = storage.scope({ workspaceID, pluginID: "demo.project" })
          expect(yield* persisted.get("generations")).toEqual(["v1"])

          const updates: Event.Payload[] = []
          const subscriber = yield* (yield* bus.subscribe(PluginSchema.Event.Updated)).pipe(
            Stream.filter((event) => event.type === PluginSchema.Event.Updated.type),
            Stream.runForEach((event) => Effect.sync(() => updates.push(event))),
            Effect.forkChild,
          )
          yield* writeStorage(projectStorage, "plugin/lib/helper.ts", `export const revision = "v2"`)
          yield* bus.publish(ProjectSchema.FileChanged, {
            projectID,
            path: ProjectDirectory.Path.make("plugin/lib/helper.ts"),
          })
          yield* PubSub.publish(changes, undefined)
          yield* Effect.sleep("20 millis")
          yield* supervisor.awaitActivation
          yield* Effect.sleep("150 millis")
          yield* Fiber.interrupt(subscriber)

          const log = yield* Effect.promise(() => readFile(journal, "utf8"))
          expect(log).toContain("project-load:v1")
          expect(log).toContain("project-cleanup:v1")
          expect(log).toContain("project-load:v2")
          expect(log).toContain("load:configured:configured")
          expect(updates).toHaveLength(1)
          expect(yield* persisted.get("generations")).toEqual(["v1", "v2"])
        }).pipe(Effect.provide(storageLayer)),
      ),
  )

  it.live("activates OpenAPI Project plugins and removes obsolete registrations on replacement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-external-server-")
        const workspaceID = Workspace.ID.make("wrk_project_external_server")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000008")
        const storageScope = yield* Scope.fork(yield* Scope.Scope)
        const storage = Context.get(yield* Layer.buildWithScope(storageLayer, storageScope), Storage.Service)
        const toolScope = yield* Scope.fork(yield* Scope.Scope)
        const tools = Context.get(
          yield* Layer.buildWithScope(Tool.layer.pipe(Layer.provide(PluginHooks.layer)), toolScope),
          Tool.Service,
        )
        const integrationScope = yield* Scope.fork(yield* Scope.Scope)
        const integrations = Context.get(
          yield* Layer.buildWithScope(
            Integration.layer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  Layer.succeed(Credential.Service, emptyCredentialService),
                  AppProcess.layer.pipe(Layer.provide(NodeServices.layer)),
                  busLayer,
                ),
              ),
            ),
            integrationScope,
          ),
          Integration.Service,
        )
        const identity = {
          pluginID: "project.example",
          integrationID: "example-api",
          namespace: "example",
          permissionPrefix: "example",
        }
        yield* integrations
          .transform((editor) => {
            editor.update(Integration.ID.make(identity.integrationID), (integration) => {
              integration.name = "Example API"
            })
            editor.method.update({
              integrationID: Integration.ID.make(identity.integrationID),
              method: { type: "key", label: "Bearer token" },
            })
          })
          .pipe(Effect.provideService(Scope.Scope, integrationScope))
        const source = (spec: unknown, authentication: unknown) => `
import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"
export default Plugin.define({
  id: ${JSON.stringify(identity.pluginID)},
  effect: (context) => Effect.asVoid(context.tool.openapi({
    spec: ${JSON.stringify(spec)},
    namespace: ${JSON.stringify(identity.namespace)},
    permissionPrefix: ${JSON.stringify(identity.permissionPrefix)},
    authentication: ${JSON.stringify(authentication)},
    expectedOrigin: "https://api.example.com",
  })),
})
`
        const pluginPath = ProjectDirectory.Path.make("plugin/external-example.ts")
        const authenticated = {
          openapi: "3.1.0",
          info: { title: "Example", revision: "1" },
          servers: [{ url: "https://api.example.com" }],
          components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
          security: [{ bearerAuth: [] }],
          paths: {
            "/status": {
              get: { operationId: "status", responses: { default: { description: "No content" } } },
            },
            "/obsolete": {
              get: {
                operationId: "obsolete",
                responses: {
                  "200": {
                    description: "ok",
                    content: { "application/json": { schema: { type: "object" } } },
                  },
                },
              },
            },
          },
        }
        yield* writeStorage(
          yield* ProjectStorage.make(workspaceID, projectID).pipe(Effect.provideService(Storage.Service, storage)),
          pluginPath,
          source(authenticated, {
            type: "integration",
            integrationID: identity.integrationID,
            schemes: { bearerAuth: { type: "bearer" } },
          }),
        )
        const supervisorScope = yield* Scope.fork(yield* Scope.Scope)
        const context = yield* Layer.buildWithScope(
          supervisorGraph(decode({}), {}, [], [], undefined, undefined, {
            workspaceID,
            cacheRoot,
            projects: [project(projectID)],
            storage,
            host: { integration: integrations, tool: tools },
          }),
          supervisorScope,
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation

        const active = yield* Context.get(context, Plugin.Service).list()
        expect(active).toHaveLength(1)
        expect(active[0]).toMatchObject({
          id: identity.pluginID,
          source: { type: "project", projectID, path: pluginPath },
          status: "active",
        })
        expect(yield* integrations.get(Integration.ID.make(identity.integrationID))).toMatchObject({
          id: identity.integrationID,
          name: "Example API",
          methods: [{ type: "key", label: "Bearer token" }],
        })
        const initialTools = yield* tools.snapshot()
        expect(initialTools.definitions.map((tool) => tool.name)).toEqual(["execute"])
        expect(initialTools.codeModeCatalog?.tools).toMatchObject([
          { name: identity.namespace, tools: [{ name: "obsolete" }, { name: "status" }] },
        ])
        expect(active[0]).toMatchObject({ tools: ["example.obsolete", "example.status"] })
        expect(yield* integrations.list()).toHaveLength(1)

        const directoryScope = yield* Scope.fork(yield* Scope.Scope)
        const directory = Context.get(
          yield* Layer.buildWithScope(
            ProjectDirectory.layer(workspaceID, projectID).pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Storage.Service, storage),
                  Layer.succeed(Bus.Service, Context.get(context, Bus.Service)),
                ),
              ),
            ),
            directoryScope,
          ),
          ProjectDirectory.Service,
        )
        const replacement = {
          openapi: "3.1.0",
          info: { title: "Example", revision: "2" },
          servers: [{ url: "https://api.example.com" }],
          paths: {
            "/current": {
              get: {
                operationId: "current",
                responses: {
                  "200": {
                    description: "Current operation",
                    content: { "application/json": { schema: { type: "object" } } },
                  },
                },
              },
            },
          },
        }
        yield* directory.write(pluginPath, {
          content: Stream.succeed(new TextEncoder().encode(source(replacement, { type: "none" }))),
        })
        yield* supervisor.reload

        expect(yield* integrations.get(Integration.ID.make(identity.integrationID))).toMatchObject({
          id: identity.integrationID,
          name: "Example API",
        })
        expect(yield* integrations.list()).toHaveLength(1)
        const currentTools = yield* tools.snapshot()
        expect(currentTools.definitions.map((tool) => tool.name)).toEqual(["execute"])
        expect(currentTools.codeModeCatalog?.tools).toMatchObject([
          { name: identity.namespace, tools: [{ name: "current" }] },
        ])
        expect((yield* Context.get(context, Plugin.Service).list())[0]).toMatchObject({ tools: ["example.current"] })
        yield* Scope.close(directoryScope, Exit.void)
        yield* Scope.close(supervisorScope, Exit.void)
        // Upstream cbef698861: registry teardown is terminal State shutdown, so surviving sibling reads retain
        // their last rebuilt value and no teardown notification is emitted.
        expect((yield* tools.snapshot()).codeModeCatalog?.tools).toMatchObject([
          { name: identity.namespace, tools: [{ name: "current" }] },
        ])
        yield* Scope.close(integrationScope, Exit.void)
        yield* Scope.close(toolScope, Exit.void)
        yield* Scope.close(storageScope, Exit.void)
      }),
    ),
  )

  it.live("reports syntax, import, and export failures with logical Project inventory sources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-plugin-failures-")
        const workspaceID = Workspace.ID.make("wrk_project_failures")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000002")
        const storage = yield* Storage.Service
        const projectStorage = yield* ProjectStorage.make(workspaceID, projectID)
        yield* writeStorage(projectStorage, "plugin/syntax.ts", "export default {")
        yield* writeStorage(projectStorage, "plugin/import.ts", `import "./missing.ts"`)
        yield* writeStorage(projectStorage, "plugin/export.ts", "export const value = 1")
        const context = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], undefined, undefined, {
            workspaceID,
            cacheRoot,
            projects: [project(projectID)],
            storage,
          }),
        )
        yield* Context.get(context, PluginSupervisor.Service).awaitActivation

        const inventory = yield* Context.get(context, Plugin.Service).list()
        expect(inventory).toEqual([
          expect.objectContaining({
            status: "failed",
            source: { type: "project", projectID, path: "plugin/export.ts" },
          }),
          expect.objectContaining({
            status: "failed",
            source: { type: "project", projectID, path: "plugin/import.ts" },
          }),
          expect.objectContaining({
            status: "failed",
            source: { type: "project", projectID, path: "plugin/syntax.ts" },
          }),
        ])
        // The loader's diagnosis names the Project path, never the materialized cache.
        expect(inventory[1]).toMatchObject({
          error: "ERR_MODULE_NOT_FOUND: Cannot find module './missing.ts' imported from plugin/import.ts",
        })
        expect(JSON.stringify(inventory)).not.toContain(cacheRoot)
      }).pipe(Effect.provide(storageLayer)),
    ),
  )

  it.live("keeps Project plugins unloaded while the Installation Policy turns plugins off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-plugin-policy-")
        const journal = path.join(cacheRoot, "journal.log")
        const workspaceID = Workspace.ID.make("wrk_project_policy")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000009")
        const storage = yield* Storage.Service
        const changes = yield* PubSub.unbounded<void>()
        const policy = { value: { plugins: "off" } as Installation.Policy }
        yield* writeStorage(yield* ProjectStorage.make(workspaceID, projectID), "plugin/demo.ts", idModuleWithCleanup(journal))
        const context = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], changes, undefined, {
            workspaceID,
            cacheRoot,
            projects: [project(projectID)],
            storage,
            policy,
          }),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        const plugins = Context.get(context, Plugin.Service)
        yield* supervisor.awaitActivation
        expect(yield* plugins.list()).toEqual([
          {
            source: { type: "project", projectID, path: "plugin/demo.ts" },
            status: "failed",
            error: "Blocked by Installation Policy",
            tui: false,
          },
        ])
        expect(yield* Effect.promise(() => readFile(journal, "utf8").catch(() => ""))).toBe("")

        // Lifting the lock activates the same Project file on the next generation.
        policy.value = {}
        yield* PubSub.publish(changes, undefined)
        yield* Effect.sleep("20 millis")
        yield* supervisor.awaitActivation
        expect((yield* plugins.list())[0]).toMatchObject({
          id: "deleted.project",
          source: { type: "project", projectID, path: "plugin/demo.ts" },
          status: "active",
        })
        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("load\n")
      }).pipe(Effect.provide(storageLayer)),
    ),
  )

  it.live("removes a deleted Project plugin scope and publishes authoritative inventory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-plugin-deleted-")
        const journal = path.join(cacheRoot, "journal.log")
        const workspaceID = Workspace.ID.make("wrk_project_deleted")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000004")
        const storage = yield* Storage.Service
        const changes = yield* PubSub.unbounded<void>()
        const projects = { value: [project(projectID)] as readonly ProjectSchema.Info[] }
        yield* writeStorage(
          yield* ProjectStorage.make(workspaceID, projectID),
          "plugin/demo.ts",
          idModuleWithCleanup(journal),
        )
        const context = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], changes, undefined, {
            workspaceID,
            cacheRoot,
            projects,
            storage,
          }),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        const plugins = Context.get(context, Plugin.Service)
        const bus = Context.get(context, Bus.Service)
        yield* supervisor.awaitActivation
        expect((yield* plugins.list())[0]).toMatchObject({
          id: "deleted.project",
          source: { type: "project", projectID, path: "plugin/demo.ts" },
          status: "active",
        })
        const updated = yield* (yield* bus.subscribe(PluginSchema.Event.Updated))
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("100 millis")

        projects.value = []
        yield* PubSub.publish(changes, undefined)
        yield* Effect.sleep("20 millis")
        yield* supervisor.awaitActivation

        expect(yield* plugins.list()).toEqual([])
        expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("cleanup\n")
        expect([...(yield* Fiber.join(updated))].map((event) => event.type)).toEqual(["plugin.updated"])
      }).pipe(Effect.provide(storageLayer)),
    ),
  )

  it.live("removes deleted Project failure inventory and publishes authoritative inventory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-plugin-failure-deleted-")
        const workspaceID = Workspace.ID.make("wrk_project_failure_deleted")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000005")
        const storage = yield* Storage.Service
        const changes = yield* PubSub.unbounded<void>()
        const projects = { value: [project(projectID)] as readonly ProjectSchema.Info[] }
        yield* writeStorage(
          yield* ProjectStorage.make(workspaceID, projectID),
          "plugin/broken.ts",
          "export const value = 1",
        )
        const context = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], changes, undefined, {
            workspaceID,
            cacheRoot,
            projects,
            storage,
          }),
        )
        const supervisor = Context.get(context, PluginSupervisor.Service)
        const plugins = Context.get(context, Plugin.Service)
        const bus = Context.get(context, Bus.Service)
        yield* supervisor.awaitActivation
        expect(yield* plugins.list()).toEqual([
          expect.objectContaining({
            status: "failed",
            source: { type: "project", projectID, path: "plugin/broken.ts" },
          }),
        ])
        const updated = yield* (yield* bus.subscribe(PluginSchema.Event.Updated))
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        yield* Effect.sleep("100 millis")

        projects.value = []
        yield* PubSub.publish(changes, undefined)
        yield* Effect.sleep("20 millis")
        yield* supervisor.awaitActivation

        expect(yield* plugins.list()).toEqual([])
        expect([...(yield* Fiber.join(updated))].map((event) => event.type)).toEqual(["plugin.updated"])
      }).pipe(Effect.provide(storageLayer)),
    ),
  )

  it.live("isolates Project activation between two Workspace supervisors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cacheRoot = yield* temporaryDirectory(".project-plugin-workspaces-")
        const projectID = ProjectSchema.ID.make("prj_00000000000000000000000003")
        const firstID = Workspace.ID.make("wrk_project_supervisor_first")
        const secondID = Workspace.ID.make("wrk_project_supervisor_second")
        const storage = yield* Storage.Service
        yield* writeStorage(yield* ProjectStorage.make(firstID, projectID), "plugin/demo.ts", idModule("first.project"))
        yield* writeStorage(
          yield* ProjectStorage.make(secondID, projectID),
          "plugin/demo.ts",
          idModule("second.project"),
        )
        const first = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], undefined, undefined, {
            workspaceID: firstID,
            cacheRoot,
            projects: [project(projectID)],
            storage,
          }),
        )
        const second = yield* Layer.build(
          supervisorGraph(decode({}), {}, [], [], undefined, undefined, {
            workspaceID: secondID,
            cacheRoot,
            projects: [project(projectID)],
            storage,
          }),
        )
        yield* Effect.all([
          Context.get(first, PluginSupervisor.Service).awaitActivation,
          Context.get(second, PluginSupervisor.Service).awaitActivation,
        ])

        expect((yield* Context.get(first, Plugin.Service).list())[0]).toMatchObject({
          id: "first.project",
          source: { type: "project", projectID, path: "plugin/demo.ts" },
        })
        expect((yield* Context.get(second, Plugin.Service).list())[0]).toMatchObject({
          id: "second.project",
          source: { type: "project", projectID, path: "plugin/demo.ts" },
        })
        expect(Context.get(first, Plugin.Service)).not.toBe(Context.get(second, Plugin.Service))
      }).pipe(Effect.provide(storageLayer)),
    ),
  )

  it.live("closes readiness before debounce and settles only the latest observed generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* PubSub.unbounded<void>()
        const current = { value: decode({ plugins: [] }) }
        const services = yield* Layer.build(supervisorGraph(current.value, {}, [], [], updates, current))
        const supervisor = Context.get(services, PluginSupervisor.Service)
        const plugins = Context.get(services, Plugin.Service)
        yield* supervisor.awaitActivation

        current.value = decode({ plugins: ["missing-one"] })
        yield* PubSub.publish(updates, undefined)
        const waiting = yield* supervisor.awaitActivation.pipe(Effect.as("ready"), Effect.forkChild)
        yield* Effect.sleep("20 millis")
        expect(waiting.pollUnsafe()).toBeUndefined()
        current.value = decode({ plugins: ["missing-two"] })
        yield* PubSub.publish(updates, undefined)
        yield* Fiber.join(waiting)
        expect((yield* plugins.list())[0]).toEqual(
          expect.objectContaining({ status: "failed", source: { type: "package", package: "missing-two" } }),
        )
      }),
    ),
  )

  it.live("hot reloads two Workspace-owned supervisors in the same PID and isolates their scopes", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-isolation-")))
      const source = path.join(root, "plugin.ts")
      const journal = path.join(root, "journal.log")
      const updatesA = yield* PubSub.unbounded<void>()
      const updatesB = yield* PubSub.unbounded<void>()
      const currentA = { value: decode({ plugins: [{ package: source, options: { label: "A" } }] }) }
      const currentB = { value: decode({ plugins: [{ package: source, options: { label: "B" } }] }) }
      yield* Effect.promise(() => writeFile(source, moduleSource(journal, "one")))
      const scopeA = yield* Scope.make()
      const scopeB = yield* Scope.make()
      const contextA = yield* Layer.buildWithScope(
        supervisorGraph(currentA.value, {}, [], [], updatesA, currentA),
        scopeA,
      )
      const contextB = yield* Layer.buildWithScope(
        supervisorGraph(currentB.value, {}, [], [], updatesB, currentB),
        scopeB,
      )
      const supervisorA = Context.get(contextA, PluginSupervisor.Service)
      const supervisorB = Context.get(contextB, PluginSupervisor.Service)
      yield* Effect.all([supervisorA.awaitActivation, supervisorB.awaitActivation])
      expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("load:one:A")
      expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("load:one:B")

      yield* Effect.sleep("5 millis")
      yield* Effect.promise(() => writeFile(source, moduleSource(journal, "two-longer")))
      yield* Effect.promise(() => utimes(source, new Date(), new Date(Date.now() + 1_000)))
      yield* Effect.all([PubSub.publish(updatesA, undefined), PubSub.publish(updatesB, undefined)])
      yield* Effect.sleep("20 millis")
      yield* Effect.all([supervisorA.awaitActivation, supervisorB.awaitActivation])
      expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("cleanup:one:A")
      expect(yield* Effect.promise(() => readFile(journal, "utf8"))).toContain("cleanup:one:B")
      expect(Context.get(contextA, Plugin.Service)).not.toBe(Context.get(contextB, Plugin.Service))

      yield* Scope.close(scopeA, Exit.void)
      yield* Effect.promise(() => writeFile(source, moduleSource(journal, "three-longest")))
      yield* PubSub.publish(updatesB, undefined)
      yield* supervisorB.awaitActivation
      const log = yield* Effect.promise(() => readFile(journal, "utf8"))
      expect(log).toContain("load:three-longest:B")
      expect(log).not.toContain("load:three-longest:A")
      yield* Scope.close(scopeB, Exit.void)
    }),
  )

  it.effect("projects checked package update state into plugin inventory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* PubSub.unbounded<PluginUpdate.Change>()
        const activated = yield* Ref.make<readonly Plugin.Generation[]>([])
        const context = yield* Layer.build(packageUpdateGraph({
          changes,
          check: () => Effect.succeed(true),
          activate: (plugins) => Ref.set(activated, plugins),
        }))
        yield* Context.get(context, PluginSupervisor.Service).awaitActivation
        yield* advance(() => (Ref.get(activated).pipe(Effect.runSync)[0]?.source as { readonly outdated?: true } | undefined)?.outdated === true)
        expect((yield* Ref.get(activated))[0]?.source).toMatchObject({ type: "package", package: "example", version: "1.0.0", outdated: true })

        yield* PubSub.publish(changes, { target: "example", outdated: false, updating: true })
        yield* advance(() => (Ref.get(activated).pipe(Effect.runSync)[0]?.source as { readonly updating?: true } | undefined)?.updating === true)
        yield* PubSub.publish(changes, { target: "example", outdated: false, updating: false })
        yield* advance(() => (Ref.get(activated).pipe(Effect.runSync)[0]?.source as { readonly updating?: true } | undefined)?.updating === undefined)
      }),
    ),
  )

  it.effect("checks only package targets and reloads when their installed revision changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* PubSub.unbounded<PluginUpdate.Change>()
        const sourceChanges = yield* PubSub.unbounded<void>()
        const checked: string[] = []
        const revision = { value: "one" }
        const activated = yield* Ref.make<readonly Plugin.Generation[]>([])
        const context = yield* Layer.build(packageUpdateGraph({
          changes,
          sourceChanges,
          check: (target) => Effect.sync(() => { checked.push(target); return false }),
          installed: () => Effect.succeed({ version: "1.0.0", revision: revision.value }),
          activate: (plugins) => Ref.set(activated, plugins),
        }))
        const supervisor = Context.get(context, PluginSupervisor.Service)
        yield* supervisor.awaitActivation
        yield* advance(() => checked.length > 0)
        expect(checked).toEqual(["example"])
        const initial = (yield* Ref.get(activated))[0]?.revision
        revision.value = "two"
        yield* PubSub.publish(sourceChanges, undefined)
        yield* advance(() => (Ref.get(activated).pipe(Effect.runSync)[0]?.revision) !== initial)
        expect((yield* Ref.get(activated))[0]?.revision).not.toBe(initial)
        yield* PubSub.publish(changes, { target: "untracked", outdated: true, updating: true })
        yield* TestClock.adjust("24 hours")
        yield* advance(() => checked.length >= 2)
        expect(checked.every((target) => target === "example")).toBe(true)
      }),
    ),
  )
})

/** Every supervisor activation reads the source snapshot once, so counting snapshots counts activations. */
function countingSource(snapshots: { count: number }, changes: Stream.Stream<void>): PluginSource.Interface {
  return PluginSource.Service.of({
    snapshot: () =>
      Effect.sync(() => {
        snapshots.count++
        return { operations: [], failures: [] }
      }),
    changes: () => changes,
  })
}

// Defers on a real macrotask so pubsub delivery and fiber hops complete between TestClock advances.
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))

/**
 * Drives pending TestClock timers to completion: stream debounces register their sleeps from separate
 * fiber hops that a single adjust can miss, so alternate real settles with adjusts until the condition holds.
 */
const advance = Effect.fnUntraced(function* (condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    yield* settle
    yield* TestClock.adjust("500 millis")
  }
  return yield* Effect.die(new Error("condition never became true after 100 advances"))
})

/** Registry stub with real hold/await readiness so `supervisor.awaitActivation` observes settled activation. */
function registryOf(registry: Pick<Plugin.Interface, "activate" | "list">): Plugin.Interface {
  const ready = Latch.makeUnsafe(true)
  const pending = new Set<object>()
  return Plugin.Service.of({
    ...registry,
    close: () => Effect.void,
    awaitActivation: ready.await,
    hold: () =>
      Effect.sync(() => {
        const token = {}
        pending.add(token)
        ready.closeUnsafe()
        return Effect.sync(() => {
          if (pending.delete(token) && pending.size === 0) ready.openUnsafe()
        })
      }),
  })
}

function supervisorTestGraph(source: PluginSource.Interface, registry: Plugin.Interface) {
  return PluginSupervisor.layerWith(Effect.succeed({ pre: [], post: [] })).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(PluginSource.Service, source),
        Layer.succeed(Plugin.Service, registry),
        Layer.succeed(
          PluginPackage.Service,
          PluginPackage.Service.of({ resolve: (target) => Effect.fail(new PluginPackage.ResolveError({ target })) }),
        ),
      ),
    ),
  )
}

function packageUpdateGraph(options: {
  readonly changes: PubSub.PubSub<PluginUpdate.Change>
  readonly sourceChanges?: PubSub.PubSub<void>
  readonly check: PluginUpdate.Interface["check"]
  readonly installed?: PluginUpdate.Interface["installed"]
  readonly activate: Plugin.Interface["activate"]
}) {
  const projectID = ProjectSchema.ID.make("prj_00000000000000000000000008")
  const projectPath = ProjectDirectory.Path.make("plugin/update.ts")
  const source = PluginSource.Service.of({
    snapshot: () => Effect.succeed({
      operations: [
        { type: "config.add" as const, target: "example", options: {}, configured: false },
        {
          type: "config.add" as const,
          target: path.join(process.cwd(), "test/fixtures/hot-reload-plugin.ts"),
          options: {},
          configured: false,
        },
        {
          type: "project.add" as const,
          key: `project:${projectID}:${projectPath}` as const,
          projectID,
          path: projectPath,
          entrypoint: "",
          revision: "one",
          plugin: { id: "project.update", effect: () => Effect.void },
        },
      ],
      failures: [],
    }),
    changes: () => options.sourceChanges ? Stream.fromPubSub(options.sourceChanges) : Stream.never,
  })
  const updates: PluginUpdate.Interface = {
    installed: options.installed ?? (() => Effect.succeed({ version: "1.0.0", revision: "one" })),
    check: options.check,
    update: (target) => Effect.fail(new PluginUpdate.DisabledError({ target })),
    changes: () => Stream.fromPubSub(options.changes),
  }
  return PluginSupervisor.layerWith(Effect.succeed({ pre: [], post: [] }), undefined, updates).pipe(
    Layer.provide(Layer.mergeAll(
      Layer.succeed(PluginSource.Service, source),
      Layer.succeed(Plugin.Service, registryOf({ activate: options.activate, list: () => Effect.succeed([]) })),
      Layer.succeed(
        PluginPackage.Service,
        PluginPackage.Service.of({ resolve: () => Effect.succeed(path.join(process.cwd(), "test/fixtures/hot-reload-plugin.ts")) }),
      ),
    )),
  )
}

function projectOperation(revision: string): PluginSource.Operation {
  const projectID = ProjectSchema.ID.make("prj_00000000000000000000000007")
  const pluginPath = ProjectDirectory.Path.make("plugin/reload.ts")
  return {
    type: "project.add",
    key: `project:${projectID}:${pluginPath}`,
    projectID,
    path: pluginPath,
    entrypoint: "",
    revision,
    plugin: { id: "reload.project", effect: () => Effect.void },
  }
}

const noCredential: Credential.Info | undefined = undefined
const emptyCredentialService = Credential.Service.of({
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

const temporaryDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(process.cwd(), prefix))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )

function definition(id: string, journal: string): PluginDefinition<never> {
  return { id, effect: () => Effect.sync(() => appendFileSync(journal, `${id}\n`)) }
}

function moduleSource(journal: string, revision = "package") {
  return `
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
export default {
  id: "demo.package",
  effect: (host) => Effect.gen(function* () {
    appendFileSync(${JSON.stringify(journal)}, "load:${revision}:" + String(host.options.label ?? "configured") + "\\n")
    yield* Effect.addFinalizer(() => Effect.sync(() => appendFileSync(${JSON.stringify(journal)}, "cleanup:${revision}:" + String(host.options.label ?? "configured") + "\\n")))
  }),
}
`
}

function promiseModuleSource(journal: string) {
  return `
import { appendFileSync } from "node:fs"
export const plugin = {
  id: "demo.promise",
  setup: () => {
    appendFileSync(${JSON.stringify(journal)}, "promise-load\\n")
    return () => appendFileSync(${JSON.stringify(journal)}, "promise-cleanup\\n")
  },
}
`
}

function projectModuleSource(journal: string) {
  return `
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
import { revision } from "./lib/helper.ts"
export default {
  id: "demo.project",
  effect: (host) => Effect.gen(function* () {
    const previous = yield* host.storage.get("generations")
    yield* host.storage.set("generations", [...(previous ?? []), revision])
    appendFileSync(${JSON.stringify(journal)}, "project-load:" + revision + "\\n")
    yield* Effect.addFinalizer(() => Effect.sync(() => appendFileSync(${JSON.stringify(journal)}, "project-cleanup:" + revision + "\\n")))
  }),
}
`
}

const idModule = (id: string) => `
import { Effect } from "effect"
export default { id: ${JSON.stringify(id)}, effect: () => Effect.void }
`

const idModuleWithCleanup = (journal: string) => `
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
export default {
  id: "deleted.project",
  effect: () => Effect.gen(function* () {
    appendFileSync(${JSON.stringify(journal)}, "load\\n")
    yield* Effect.addFinalizer(() => Effect.sync(() => appendFileSync(${JSON.stringify(journal)}, "cleanup\\n")))
  }),
}
`
