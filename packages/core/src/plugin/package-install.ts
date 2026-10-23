export * as PackageInstall from "./package-install.js"

import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { Effect, Schema } from "effect"

export class InstallError extends Schema.TaggedError<InstallError>()("PluginPackage.InstallError", {
  cause: Schema.Defect(),
}) {}

/** Install a plugin target into an isolated package root. */
export const install = (target: string, directory: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/package.json`, '{"private":true,"type":"module"}')
      await new Promise<void>((resolve, reject) => {
        execFile("bun", ["add", "--ignore-scripts", "--cwd", directory, target], (cause) =>
          cause === null ? resolve() : reject(cause),
        )
      })
    },
    catch: (cause) => new InstallError({ cause }),
  })
