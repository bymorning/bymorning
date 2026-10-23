export * as Host from "./host.js"

import { mkdir, realpath } from "node:fs/promises"
import * as Module from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { importModule, resolveModule } from "@bymorning/util/runtime-import"
import runtime from "./host-runtime.js"

export interface Target {
  readonly directory: string
  readonly name?: string
}

export interface Entrypoints {
  readonly server?: string
  readonly tui?: string
}

export function resolve(target: Target): Entrypoints {
  const entry = (subpaths: readonly string[]) => {
    for (const subpath of subpaths) {
      const specifier = target.name
        ? [target.name, subpath].filter(Boolean).join("/")
        : path.resolve(target.directory, subpath || "index")
      try {
        return resolveModule(specifier, target.directory)
      } catch (error) {
        const missing =
          typeof error === "object" && error !== null &&
          (("code" in error &&
            ["ENOENT", "ENOTDIR", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(String(error.code))) ||
            ("message" in error && String(error.message).includes("Cannot find module")))
        if (!missing) throw error
      }
    }
    return undefined
  }
  return { server: entry(["server", ""]), tui: entry(["tui"]) }
}

export function load(entrypoint: string): Promise<unknown> {
  return importModule(entrypoint)
}

/** The one process-wide table the generated shim modules read. */
const registry = Symbol.for("@bymorning/plugin/host/modules")
const scheme = "bymorning-host:"
const anchor = import.meta.url
const modules = new Map<string, object>()
const roots = new Map<string, number>()
let hooks: Module.ModuleHooks | undefined

/**
 * Serve the process's own `effect`, `@bymorning/plugin`, and `@bymorning/schema`
 * instances to plugins imported from beneath `root`, so a materialized Project
 * plugin loads without a `node_modules` ancestor. Idempotent per root; the
 * returned function releases this registration.
 */
export async function expose(root: string, table?: ReadonlyMap<string, object>): Promise<() => void> {
  if (typeof Module.registerHooks !== "function") return () => {}
  const directory = path.resolve(root)
  await mkdir(directory, { recursive: true })
  // Node reports module parents by real path; match that spelling.
  const url = pathToFileURL(`${await realpath(directory)}${path.sep}`).href
  for (const [specifier, namespace] of table ?? runtime) modules.set(specifier, namespace)
  ;(globalThis as unknown as Record<symbol, unknown>)[registry] = modules
  roots.set(url, (roots.get(url) ?? 0) + 1)
  hooks ??= Module.registerHooks({ resolve: resolveHook, load: loadHook })
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (roots.get(url) ?? 1) - 1
    if (count > 0) roots.set(url, count)
    else roots.delete(url)
    if (roots.size === 0 && hooks !== undefined) {
      hooks.deregister()
      hooks = undefined
    }
  }
}

const bare = (specifier: string) => !/^(?:\.{1,2}(?:[\\/]|$)|[\\/]|#|[a-zA-Z][\w+.-]*:)/.test(specifier)

const covered = (parent: string | undefined) =>
  parent !== undefined && roots.keys().some((root) => parent.startsWith(root))

const resolveHook: Module.ResolveHookSync = (specifier, context, next) => {
  if (!bare(specifier) || Module.isBuiltin(specifier) || !covered(context.parentURL)) return next(specifier, context)
  if (modules.has(specifier)) return { url: `${scheme}${specifier}`, format: "module", shortCircuit: true }
  return next(specifier, { ...context, parentURL: anchor })
}

const loadHook: Module.LoadHookSync = (url, context, next) => {
  if (!url.startsWith(scheme)) return next(url, context)
  const specifier = url.slice(scheme.length)
  const namespace = modules.get(specifier)
  if (namespace === undefined) return next(url, context)
  return { format: "module", source: shim(specifier, namespace), shortCircuit: true }
}

/**
 * An ES module re-exporting one namespace from the registry. Local bindings
 * are positional so an export named `Symbol` or `globalThis` cannot shadow the
 * lookup; export names are string literals so any export name is valid.
 */
function shim(specifier: string, namespace: object): string {
  const names = Object.keys(namespace).filter((name) => name !== "default")
  return [
    `const __m = globalThis[Symbol.for(${JSON.stringify(registry.description)})].get(${JSON.stringify(specifier)})`,
    ...names.map((name, index) => `const __x${index} = __m[${JSON.stringify(name)}]`),
    `export { ${names.map((name, index) => `__x${index} as ${JSON.stringify(name)}`).join(", ")} }`,
    ...("default" in namespace ? ["export default __m.default"] : []),
    "",
  ].join("\n")
}
