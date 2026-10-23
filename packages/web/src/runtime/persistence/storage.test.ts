import * as Workspace from "@bymorning/schema/workspace"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it } from "vitest"

import { Persist, persisted, safeSyncStorage, type SyncStorage } from "./storage"

describe("Persist", () => {
  it("builds stable scope keys", () => {
    const workspaceID = Workspace.ID.create()

    expect(Persist.global("layout").key).toBe("bymorning.layout")
    expect(Persist.workspace(workspaceID, "layout").key).toBe(`bymorning.workspace:${workspaceID}:layout`)
    expect(Persist.project(workspaceID, "project-id", "files").key).toBe(
      `bymorning.workspace:${workspaceID}:project:project-id:files`,
    )
    expect(Persist.session(workspaceID, "project-id", "session-id", "prompt").key).toBe(
      `bymorning.workspace:${workspaceID}:project:project-id:session:session-id:prompt`,
    )
    expect(Persist.draft("draft-id", "prompt").key).toBe("bymorning.draft:draft-id:prompt")
  })
})

describe("persisted", () => {
  it("persists a signal through a target", () =>
    createRoot((dispose) => {
      const values = new Map<string, string>()
      const storage: SyncStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      }
      const target = Persist.global("test")
      const signal = createSignal("initial")
      const state = persisted<string, typeof signal>(target, signal, {
        storage,
        serialize: (value) => value,
        deserialize: (value) => value,
      })

      state[1]("updated")
      expect(values.get(target.key)).toBe("updated")
      const fallback = createSignal("fallback")
      expect(
        persisted<string, typeof fallback>(target, fallback, {
          storage,
          serialize: (value) => value,
          deserialize: (value) => value,
        })[0](),
      ).toBe("updated")
      dispose()
    }))

  it("absorbs synchronous storage failures", () => {
    const storage = safeSyncStorage({
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    })

    expect(storage.getItem("key")).toBeNull()
    expect(() => storage.setItem("key", "value")).not.toThrow()
    expect(() => storage.removeItem("key")).not.toThrow()
  })
})
