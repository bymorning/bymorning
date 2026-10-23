import { describe, expect, it } from "@effect/vitest"
import { Share as ShareSchema } from "@bymorning/schema/share"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer } from "effect"
import { Database } from "../src/database.js"
import { Share } from "../src/share.js"
import { Storage } from "../src/storage.js"

const storage = Storage.layer({
  configure: (editor) => {
    const provider = Storage.memory()
    editor.add(provider)
    editor.default.set(provider.id)
  },
})

const database = Layer.succeed(
  Database.Service,
  Database.Service.of({
    use: () => Effect.die("Share.get must not access Database for a missing token"),
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: () => Effect.void,
  }),
)

const layer = Layer.provide(Share.layer, Layer.merge(storage, database))

describe("Share.get", () => {
  it.effect("fails with NotFoundError for a missing token", () =>
    Effect.gen(function* () {
      const share = yield* Share.Service
      const workspaceID = Workspace.ID.make("wrk_share")
      const token = ShareSchema.Token.make("00000000-0000-4000-8000-000000000000")

      const error = yield* share.get({ workspaceID, token }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Share.NotFoundError)
      expect(error).toMatchObject({
        _tag: "Share.NotFoundError",
        workspaceID,
        token,
      })
    }).pipe(Effect.provide(layer)),
  )
})
