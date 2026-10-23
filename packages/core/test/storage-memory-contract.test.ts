import { Storage } from "@bymorning/core/storage"
import { StorageContract } from "@bymorning/testing/contract/storage"
import { Effect } from "effect"

StorageContract.run(
  "memory",
  Effect.sync(() => Storage.memory()),
)
