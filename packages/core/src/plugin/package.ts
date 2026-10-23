export * as PluginPackage from "./package.js"

import { Context, Effect, Layer, Schema } from "effect"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { Host } from "@bymorning/plugin/host"
import { install } from "./package-install.js"

export interface Interface {
  readonly resolve: (target: string) => Effect.Effect<string, ResolveError>
}

export class ResolveError extends Schema.TaggedError<ResolveError>()("PluginPackage.ResolveError", {
  target: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginPackage") {}

/** Resolve installed packages, optionally acquiring missing packages into an explicit cache. */
export const configured = (config: { readonly directory?: string; readonly install?: boolean }) =>
  Layer.succeed(
    Service,
    Service.of({
      resolve: Effect.fn("PluginPackage.resolve")(function* (target: string) {
        const name = packageName(target)
        const local = yield* Effect.firstSuccessOf([
          resolveFrom(target, name, process.cwd()),
          // Compiled applications ship independently loadable packages beside the executable.
          resolveFrom(target, name, path.dirname(process.execPath)),
          resolveFrom(target, name, path.dirname(fileURLToPath(import.meta.url))),
        ]).pipe(Effect.option)
        if (local._tag === "Some") return local.value

        if (config.install === false) return yield* new ResolveError({ target, cause: "Package is not installed" })

        const directory = path.join(
          config.directory ?? path.join(os.homedir(), ".cache", "bymorning", "plugins"),
          encodeURIComponent(target),
        )
        yield* install(target, directory).pipe(Effect.mapError((cause) => new ResolveError({ target, cause })))
        return yield* resolveFrom(target, name, directory)
      }),
    }),
  )

/** Default installation package resolver. */
export const layer = configured({})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

function resolveFrom(target: string, name: string, directory: string) {
  return Effect.try({
    try: () => {
      const entrypoints = Host.resolve({ directory, name })
      if (entrypoints.server === undefined) throw new Error("Package has no server entrypoint")
      return entrypoints.server
    },
    catch: (cause) => new ResolveError({ target, cause }),
  })
}

function packageName(target: string) {
  if (!target.startsWith("@")) return target.split("@")[0]!
  const separator = target.lastIndexOf("@")
  return separator > target.indexOf("/") ? target.slice(0, separator) : target
}
