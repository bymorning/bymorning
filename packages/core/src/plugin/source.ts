export * as PluginSource from "./source.js"

import { Host } from "@bymorning/plugin/host"
import type { ConfigPlugin } from "@bymorning/schema/config/plugin"
import { Plugin } from "@bymorning/schema/plugin"
import { Deleted, FileChanged } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import type { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Cause, Context, Effect, Layer, PubSub, Scope, Stream } from "effect"
import { watch } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Bus } from "../bus.js"
import { Actor } from "../actor.js"
import { Config } from "../config.js"
import { applyLock } from "../config/lock.js"
import { Installation } from "../installation.js"
import { Project } from "../project.js"
import { ProjectStorage } from "../project-storage.js"
import { Storage } from "../storage.js"
import { ProjectMaterializer } from "./project-materializer.js"
import { resolveConfigurationTarget, targetSource } from "./source-target.js"
import { PluginStartup } from "./startup.js"

export type Operation =
  | {
      readonly type: "config.add"
      readonly target: string
      readonly options: Readonly<Record<string, unknown>>
      readonly configured: boolean
      readonly mtime?: number
    }
  | {
      readonly type: "config.remove"
      readonly target: string
    }
  | {
      readonly type: "project.add"
      readonly key: `project:${import("@bymorning/schema/project").ID}:${ProjectDirectory.Path}`
      readonly projectID: import("@bymorning/schema/project").ID
      readonly path: ProjectDirectory.Path
      readonly entrypoint: string
      readonly revision: string
      readonly plugin?: import("@bymorning/plugin/effect/plugin").Plugin
    }

export type Failure = Extract<Plugin.Info, { readonly status: "failed" }>

export interface Snapshot {
  readonly operations: readonly Operation[]
  readonly failures: readonly Failure[]
}

/** Inventory row for a plugin the Installation Policy keeps off the load path. */
export const blocked = "Blocked by Installation Policy"

export interface Interface {
  // @effect-diagnostics-next-line lazyEffect:off
  readonly snapshot: () => Effect.Effect<Snapshot, never, Scope.Scope>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly changes: () => Stream.Stream<void>
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginSource") {}

const sourceLayer = (workspaceID: Workspace.ID, cacheRoot: string, project?: { readonly projects: Project.Interface; readonly storage: Storage.Interface }) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const bus = yield* Bus.Service
      const installation = yield* Installation.Service
      const configuredChanges = yield* PubSub.unbounded<void>()
      // Open the live boundary before the supervisor's initial snapshot so a
      // project write cannot be lost between loading and following changes.
      const projectChanges = yield* bus.subscribe([Deleted, FileChanged])
      // Watchers belong to this source, not to whichever caller's Scope
      // snapshot() runs under; a per-generation caller scope would otherwise
      // close them while `watched` still suppresses re-acquisition.
      const sourceScope = yield* Effect.scope
      const watched = new Set<string>()
      // Materialized Project plugins import `effect` and `@bymorning/plugin`
      // from a cache with no node_modules ancestor; serve the host's own
      // instances there for as long as this source exists.
      if (project !== undefined) {
        yield* Effect.acquireRelease(
          Effect.tryPromise(() => Host.expose(cacheRoot)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to expose host modules to project plugins", { cacheRoot, cause }).pipe(
                Effect.as(() => {}),
              ),
            ),
          ),
          (release) => Effect.sync(release),
        )
      }

      const configured = Effect.fn("PluginSource.configured")(function* (policy: Installation.Policy) {
        // The Installation Policy lock is mandatory on the load path, not only
        // on the Config view; a dropped target is reported, never loaded.
        const entries = yield* config.entries()
        const failures: Failure[] = []
        const operations: Extract<Operation, { readonly type: `config.${string}` }>[] = []
        for (const entry of entries) {
          const admitted = new Set(applyLock(entry.info, policy).plugins ?? [])
          const base = entry.path === undefined ? process.cwd() : path.dirname(entry.path)
          for (const input of entry.info.plugins ?? []) {
            const operation = parse(input)
            if (operation.type === "config.remove") {
              if (admitted.has(input)) operations.push(operation)
              continue
            }
            const target = resolveConfigurationTarget(operation.target, base)
            if (admitted.has(input)) operations.push({ ...operation, target })
            else if (!selector(operation.target)) {
              failures.push({ source: targetSource(target), status: "failed", error: blocked, tui: false })
            }
          }
        }
        const versioned = yield* Effect.forEach(operations, (operation) => {
          if (operation.type === "config.remove" || !path.isAbsolute(operation.target)) {
            return Effect.succeed(operation)
          }
          // A missing or unreadable target is a load failure for that plugin, not an activation defect.
          return Effect.tryPromise(() => stat(operation.target)).pipe(
            Effect.map((info) => ({ ...operation, mtime: Math.trunc(info.mtimeMs) })),
            Effect.orElseSucceed(() => operation),
          )
        })

        for (const operation of versioned) {
          if (operation.type !== "config.add" || !path.isAbsolute(operation.target) || watched.has(operation.target)) {
            continue
          }
          const directory = yield* Effect.tryPromise(() => stat(operation.target)).pipe(
            Effect.map((info) => info.isDirectory()),
            Effect.orElseSucceed(() => true),
          )
          if (directory) continue
          watched.add(operation.target)
          // Node can still deliver an event already queued when close() runs, so
          // the listener stops publishing as soon as the watcher is released.
          let open = true
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              watch(operation.target, () => {
                if (open) PubSub.publishUnsafe(configuredChanges, undefined)
              }),
            ),
            (watcher) =>
              Effect.sync(() => {
                open = false
                watcher.close()
              }),
          ).pipe(Scope.provide(sourceScope))
        }
        return { operations: versioned, failures }
      })

      return Service.of({
        snapshot: Effect.fn("PluginSource.snapshot")(function* () {
          // The Workspace activation and its member composition may observe
          // Config through different retained instances. Refresh the persisted
          // document into this instance before snapshotting so a config.update
          // committed through another graph still bumps the generation here.
          // A refresh failure keeps the last entries and records a safe inventory
          // row; the supervisor retains its running generation and retries later.
          const refreshFailure = yield* config.refresh.pipe(
            Effect.as(undefined as Failure | undefined),
            Effect.catchCause((cause) => {
              if (Cause.hasInterrupts(cause)) return Effect.interrupt
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              return Effect.logWarning("failed to refresh plugin config", { ref, cause }).pipe(
                Effect.as({
                  source: { type: "builtin" as const },
                  status: "failed" as const,
                  error: "Plugin config refresh failed",
                  ref,
                  tui: false,
                }),
              )
            }),
          )
          const policy = yield* installation.policy.get
          const sources = yield* configured(policy)
          const operations = Array<Operation>(...sources.operations)
          const failures = Array<Failure>(...(refreshFailure === undefined ? [] : [refreshFailure]), ...sources.failures)
          // Archived Projects keep their plugins so restoring returns them to how they were.
          const listed =
            project === undefined
              ? []
              : [...(yield* project.projects.list()), ...(yield* project.projects.list({ archived: true }))]
          for (const item of listed) {
            if (project === undefined) continue
            const projectStorage = yield* ProjectStorage.make(workspaceID, item.id).pipe(
              Effect.provideService(Storage.Service, project.storage),
            )
            const result = yield* Effect.gen(function* () {
              const items = yield* projectStorage.list
              // Plugins off is installation-wide: Project plugins are Plugins, so
              // they are reported and never materialized or loaded.
              if (policy.plugins === "off") {
                return {
                  entrypoints: ProjectMaterializer.entrypoints(items.filter((item) => !item.marker).map((item) => item.key)),
                } as const
              }
              return yield* ProjectMaterializer.make(cacheRoot, workspaceID, item.id).materialize({
                storage: projectStorage,
                items,
              })
            }).pipe(Effect.exit)
            if (result._tag === "Failure") {
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              yield* Effect.logWarning("failed to materialize project plugins", {
                ref,
                cause: result.cause,
                projectID: item.id,
              })
              failures.push({
                source: { type: "project", projectID: item.id },
                status: "failed",
                error: "Plugin project source failed",
                ref,
                tui: false,
              })
              continue
            }
            for (const entrypoint of result.value.entrypoints) {
              if (!("directory" in result.value)) {
                failures.push({
                  source: { type: "project", projectID: item.id, path: entrypoint },
                  status: "failed",
                  error: blocked,
                  tui: false,
                })
                continue
              }
              operations.push({
                type: "project.add",
                key: `project:${item.id}:${entrypoint}`,
                projectID: item.id,
                path: entrypoint,
                entrypoint: path.join(result.value.directory, entrypoint.slice("plugin/".length)),
                revision: result.value.digest,
              })
            }
          }
          return { operations, failures }
        }),
        changes: () =>
          Stream.merge(
            Stream.merge(config.changes(), Stream.fromPubSub(configuredChanges)),
            projectChanges.pipe(
              Stream.filter(
                (event) =>
                  event.type === Deleted.type ||
                  (event.type === FileChanged.type && event.data.path.startsWith("plugin/")),
              ),
              Stream.map(() => undefined),
            ),
          ),
      })
    }),
  )

/** Workspace configuration sources, without member/project discovery. */
export const workspaceLayer = (workspaceID: Workspace.ID) => sourceLayer(workspaceID, "")

/** Member sources additionally discover project declarations. */
export const layer = (workspaceID: Workspace.ID, cacheRoot: string) => Layer.unwrap(
  Effect.gen(function* () {
    return sourceLayer(workspaceID, cacheRoot, { projects: yield* Project.Service, storage: yield* Storage.Service })
  }),
)

/**
 * Canonical Plugin-owned source. The member binding supplies identity and the
 * private startup declaration supplies only installation cache policy.
 */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const owner = yield* Actor.Binding.Service
      const startup = yield* PluginStartup.Service
      return layer(
        owner.workspaceID,
        startup.directory === undefined
          ? ".bymorning/plugins/materialized"
          : path.join(startup.directory, "plugins/materialized"),
      )
    }),
  ),
  deps: [Actor.binding, PluginStartup.node, Config.node, Installation.node, Project.node, Storage.node, Bus.node],
})

/** Wildcard selectors name no plugin, so dropping one is not an inventory failure. */
const selector = (target: string) => target === "*" || target.endsWith(".*")

function parse(input: ConfigPlugin.Plugin): Extract<Operation, { readonly type: `config.${string}` }> {
  if (typeof input !== "string")
    return { type: "config.add", target: input.package, options: input.options ?? {}, configured: true }
  if (!input.startsWith("-")) return { type: "config.add", target: input, options: {}, configured: false }
  if (input.length === 1) throw new Error("Plugin remove operation requires a target")
  return { type: "config.remove", target: input.slice(1) }
}
