import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Schema } from "effect"
import { PackageInstall } from "../plugin/package-install.js"

export interface Installed {
  readonly version: string
  readonly revision: string
}

export interface Registry {
  readonly installed: (target: string) => Effect.Effect<Installed | undefined, RegistryError>
  readonly latest: (target: string) => Effect.Effect<Installed | undefined, RegistryError>
  readonly install: (target: string) => Effect.Effect<void, RegistryError>
}

export class RegistryError extends Schema.TaggedError<RegistryError>()("PluginUpdate.RegistryError", {
  target: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Tags, ranges, and unpinned targets can acquire a newer release. */
export const mutable = (target: string) => {
  if (/#(?:[a-f\d]{40})$/i.test(target)) return false
  const name = packageName(target)
  const spec = target.slice(name.length)
  if (!spec || spec === "@") return true
  const value = spec.startsWith("@") ? spec.slice(1) : spec
  return !/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value)
}

export const production = (directory?: string): Registry => {
  const root = (target: string) =>
    path.join(directory ?? path.join(os.homedir(), ".cache", "bymorning", "plugins"), encodeURIComponent(target))
  return {
    installed: (target) =>
      Effect.tryPromise({
        try: async () => {
          const manifest = JSON.parse(await readFile(path.join(root(target), "node_modules", packageName(target), "package.json"), "utf8"))
          if (typeof manifest.version !== "string") return undefined
          const revision = typeof manifest._resolved === "string" ? manifest._resolved : typeof manifest._integrity === "string" ? manifest._integrity : manifest.version
          return { version: manifest.version, revision }
        },
        catch: (cause) => new RegistryError({ target, cause }),
      }).pipe(
        Effect.catch((error) =>
          isMissing(error.cause) ? Effect.succeed(undefined as undefined) : Effect.fail(error),
        ),
      ),
    latest: (target) =>
      Effect.tryPromise({
        try: async () => {
          const stdout = await command("bun", ["pm", "view", packageName(target), "version"])
          const version = stdout.trim()
          return version ? { version, revision: version } : undefined
        },
        catch: (cause) => new RegistryError({ target, cause }),
      }),
    install: (target) => PackageInstall.install(target, root(target)).pipe(Effect.mapError((cause) => new RegistryError({ target, cause }))),
  }
}

function packageName(target: string) {
  if (!target.startsWith("@")) return target.split("@")[0]!
  const separator = target.lastIndexOf("@")
  return separator > target.indexOf("/") ? target.slice(0, separator) : target
}

function command(file: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, (cause, stdout) => cause === null ? resolve(stdout) : reject(cause))
  })
}

function isMissing(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"
}
