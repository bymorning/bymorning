export * as ProjectMaterializer from "./project-materializer.js"

import { ProjectDirectory } from "@bymorning/schema/project-directory"
import type { Project } from "@bymorning/schema/project"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Option, Schema, Stream } from "effect"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ProjectStorage } from "../project-storage.js"
import type { Storage } from "../storage.js"

/** Materializer-owned disappearance or local cache I/O failure. */
export class OperationError extends Schema.TaggedError<OperationError>()("ProjectMaterializer.OperationError", {
  message: Schema.String,
  reason: Schema.Literals(["missing", "filesystem"]),
  cause: Schema.Defect(),
}) {}

export interface Generation {
  readonly digest: string
  readonly directory: string
  readonly entrypoints: readonly ProjectDirectory.Path[]
}

export interface Interface {
  readonly materialize: (input: {
    readonly storage: ProjectStorage.Interface
    readonly items: readonly ProjectStorage.Item[]
  }) => Effect.Effect<Generation, Storage.InvalidPathError | Storage.OperationError | OperationError>
}

export const make = (cacheRoot: string, workspaceID: Workspace.ID, projectID: Project.ID): Interface => ({
  materialize: Effect.fn("ProjectMaterializer.materialize")(function* ({ storage, items }) {
    const objects = items
      .filter((item) => !item.marker && item.key.startsWith("plugin/"))
      .sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)))
    const files = yield* Effect.forEach(
      objects,
      (item) =>
        storage.get(item.key.split("/")).pipe(
          Effect.flatMap((entry) =>
            Effect.gen(function* () {
              if (Option.isNone(entry))
                return yield* new OperationError({
                  message: "Listed Project object disappeared",
                  reason: "missing",
                  cause: new Error(`Listed Project object disappeared: ${item.key}`),
                })
              return yield* Stream.mkUint8Array(entry.value.body)
            }),
          ),
          Effect.map((bytes) => ({ path: item.key, bytes })),
        ),
      { concurrency: 8 },
    )
    const hash = createHash("sha256")
    for (const file of files) {
      hash.update(lengthPrefix(Buffer.byteLength(file.path)))
      hash.update(file.path)
      hash.update(lengthPrefix(file.bytes.length))
      hash.update(file.bytes)
    }
    const digest = hash.digest("hex")
    const parent = path.join(cacheRoot, workspaceID, projectID)
    const directory = path.join(parent, digest)
    const generation = { digest, directory, entrypoints: entrypoints(objects.map((item) => item.key)) }

    yield* fsOperation(() => mkdir(parent, { recursive: true }))
    if (yield* exists(directory)) return generation

    yield* Effect.acquireUseRelease(
      fsOperation(() => mkdtemp(path.join(parent, ".staging-"))),
      (staging) =>
        Effect.gen(function* () {
          for (const file of files) {
            const destination = path.join(staging, file.path.slice("plugin/".length))
            yield* fsOperation(() => mkdir(path.dirname(destination), { recursive: true }))
            yield* fsOperation(() => writeFile(destination, file.bytes))
          }
          // Node decides a `.ts` file's module system from the nearest package.json;
          // declare the generation ESM so the cache location cannot change it.
          if (!files.some((file) => file.path === "plugin/package.json")) {
            yield* fsOperation(() =>
              writeFile(path.join(staging, "package.json"), JSON.stringify({ type: "module" }) + "\n"),
            )
          }
          yield* fsOperation(() => rename(staging, directory)).pipe(
            Effect.catchIf(isExistingDestination, () => Effect.void),
          )
        }),
      (staging) => fsOperation(() => rm(staging, { recursive: true, force: true })).pipe(Effect.orDie),
    )
    return generation
  }),
})

// Loadable Project entrypoints among object keys: immediate `plugin/<name>.ts` files and `plugin/<name>/index.ts`.
export const entrypoints = (keys: readonly string[]): readonly ProjectDirectory.Path[] =>
  keys
    .filter((key) => /^plugin\/[^/]+\.ts$|^plugin\/[^/]+\/index\.ts$/.test(key))
    .map((key) => ProjectDirectory.Path.make(key))

const lengthPrefix = (length: number) => {
  const buffer = Buffer.allocUnsafe(8)
  buffer.writeBigUInt64BE(BigInt(length))
  return buffer
}

const fsOperation = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new OperationError({
        message: "Project materialization failed",
        reason: "filesystem",
        cause,
      }),
  })

const exists = (directory: string) =>
  Effect.promise(() =>
    stat(directory).then(
      (info) => info.isDirectory(),
      () => false,
    ),
  )

const isExistingDestination = (error: OperationError) => {
  const cause = error.cause
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return false
  return cause.code === "EEXIST" || cause.code === "ENOTEMPTY"
}
