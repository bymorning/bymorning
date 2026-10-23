/**
 * Node child-process driver for the Project plugin load path. The vitest
 * worker resolves dynamic imports through Vite, which hides how Node itself
 * resolves the bare `effect` and `@bymorning/plugin` imports of a plugin
 * materialized outside the repository; this script runs under plain Node
 * (`node --import tsx`) with the cache root under os.tmpdir().
 *
 *   load <cacheRoot>      materialize the Skill's probe plugin and import it with
 *                         Host.load alone, as the supervisor does: reports the
 *                         loader error without any host assistance
 *   activate <cacheRoot>  run the real source -> materializer -> supervisor ->
 *                         registry path and report the inventory
 *   table <cacheRoot>     as `activate`, after exposing an explicit module table
 *                         the way the application bundle does
 *
 * Output is one JSON document on stdout.
 */
import { Host } from "@bymorning/plugin/host"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import * as effect from "effect"
import { Context, Effect, Layer } from "effect"
import * as pluginEffect from "@bymorning/plugin/effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Plugin } from "../../src/plugin.js"
import { PluginSupervisor } from "../../src/plugin/supervisor.js"
import { ProjectStorage } from "../../src/project-storage.js"
import { Storage } from "../../src/storage.js"
import { decode, project, supervisorGraph, writeStorage } from "./plugin-graph.js"
import { layer as storageLayer } from "./storage.js"

const [mode, cacheRoot] = process.argv.slice(2)
if ((mode !== "load" && mode !== "activate" && mode !== "table") || cacheRoot === undefined) {
  throw new Error("usage: plugin-node-runtime.ts <load|activate|table> <cacheRoot>")
}

const identity = Symbol.for("bymorning/test/effect")
;(globalThis as Record<symbol, unknown>)[identity] = effect.Effect

/**
 * The Skill's trivial probe, plus a journal line recording whether its `effect`
 * is the host's instance and whether it arrived through the exposed table.
 */
const probe = (journal: string) => `
import { Plugin } from "@bymorning/plugin/effect"
import * as effect from "effect"
import { Effect } from "effect"
import { appendFileSync } from "node:fs"

export default Plugin.define({
  id: "project.example",
  effect: () =>
    Effect.sync(() => {
      const identity = Effect === globalThis[Symbol.for("bymorning/test/effect")] ? "same" : "different"
      const route = effect.tableSentinel === true ? "table" : "anchor"
      appendFileSync(${JSON.stringify(journal)}, identity + ":" + route + "\\n")
    }),
})
`

const load = async () => {
  const directory = path.join(cacheRoot, "wrk_node_runtime", "prj_00000000000000000000000001", "digest")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module" }))
  await writeFile(path.join(directory, "probe.ts"), probe(path.join(cacheRoot, "journal.log")))
  try {
    await Host.load(pathToFileURL(path.join(directory, "probe.ts")).href)
    return { loaded: true }
  } catch (error) {
    return {
      loaded: false,
      code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

const activate = Effect.scoped(
  Effect.gen(function* () {
    if (mode === "table") {
      const release = yield* Effect.promise(() =>
        Host.expose(
          cacheRoot,
          new Map<string, object>([
            ["effect", { ...effect, tableSentinel: true }],
            ["@bymorning/plugin/effect", pluginEffect],
          ]),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(release))
    }
    const journal = path.join(cacheRoot, "journal.log")
    const workspaceID = Workspace.ID.make("wrk_node_runtime")
    const projectID = ProjectSchema.ID.make("prj_00000000000000000000000001")
    const storage = yield* Storage.Service
    yield* writeStorage(yield* ProjectStorage.make(workspaceID, projectID), "plugin/probe.ts", probe(journal))
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
    const log = yield* Effect.promise(() => readFile(journal, "utf8").catch(() => ""))
    return { inventory, journal: log.trim() }
  }).pipe(Effect.provide(storageLayer)),
)

const result = mode === "load" ? await load() : await Effect.runPromise(activate)
process.stdout.write(`${JSON.stringify(result)}\n`)
