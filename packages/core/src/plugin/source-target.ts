import type { Plugin } from "@bymorning/schema/plugin"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Return the Config target which identifies a Workspace-configurable source. */
export function configurationTarget(source: Plugin.Source, id: Plugin.ID) {
  if (source.type === "builtin") return id
  if (source.type === "package") return source.package
  if (source.type === "local") return source.path
}

/** The inventory source a resolved configured target denotes. */
export const targetSource = (target: string): Plugin.Source =>
  path.isAbsolute(target) ? { type: "local", path: target } : { type: "package", package: target }

/** Resolve a persisted Config target to the identity used by PluginSource. */
export function resolveConfigurationTarget(target: string, base = process.cwd()) {
  if (target.startsWith("file://")) return fileURLToPath(target)
  if (target.startsWith("./") || target.startsWith("../")) return path.resolve(base, target)
  return target
}
