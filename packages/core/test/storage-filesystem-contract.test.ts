import { Storage } from "@bymorning/core/storage"
import { StorageContract } from "@bymorning/testing/contract/storage"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

StorageContract.run(
  "filesystem",
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(path.join(tmpdir(), "bymorning-storage-"))),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    return Storage.filesystem({ directory })
  }),
)
