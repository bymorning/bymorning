import { Storage } from "@bymorning/core/storage"
import { Layer } from "effect"

/** Explicit in-memory provider acquisition at the trusted test boundary. */
export const layer = Storage.layer({
  configure: (editor) => {
    editor.add(Storage.memory())
    editor.default.set(Storage.ID.make("memory"))
  },
}).pipe(Layer.orDie)
