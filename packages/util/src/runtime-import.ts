import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** Runtime-neutral dynamic module loading used by plugin entrypoint resolution. */
export function importModule(specifier: string): Promise<unknown> {
  return import(specifier)
}

/** Resolve relative to a package directory in both production Bun and Node-based test runners. */
export function resolveModule(specifier: string, directory: string): string {
  const resolved =
    typeof Bun === "undefined"
      ? createRequire(path.join(directory, "package.json")).resolve(specifier)
      : Bun.resolveSync(specifier, directory)
  return resolved.startsWith("node:") ? resolved : pathToFileURL(resolved).href
}

declare const Bun: { resolveSync(specifier: string, directory: string): string }
