export * as ProjectStorage from "./project-storage.js"

import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Layer } from "effect"
import { Storage } from "./storage.js"

/** Metadata for one object relative to the bound Project namespace. */
export type Item = Storage.Item

/** Storage authority scoped to one Project. */
export interface Interface extends Omit<Storage.Object, "list" | "getRange"> {
  readonly list: Effect.Effect<ReadonlyArray<Item>, Storage.OperationError>
}

/** Storage authority scoped to one Project. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ProjectStorage") {}

/** Build Project-scoped storage over the shared Storage authority. */
export const make = Effect.fn("ProjectStorage.make")(function* (workspaceID: Workspace.ID, projectID: Project.ID) {
  const { object: storage } = yield* Storage.Service
  const prefix = Storage.path({ workspaces: workspaceID }, { projects: projectID })

  return {
    set: Effect.fn("ProjectStorage.set")((path: Storage.Path, input: Storage.SetInput) =>
      storage.set([...prefix, ...path], input),
    ),
    get: Effect.fn("ProjectStorage.get")((path: Storage.Path) => storage.get([...prefix, ...path])),
    remove: Effect.fn("ProjectStorage.remove")((path: Storage.Path) => storage.remove([...prefix, ...path])),
    list: Effect.gen(function* () {
      const prefixKey = yield* Storage.key(prefix).pipe(Effect.orDie)
      return (yield* storage.list(prefix).pipe(Effect.catchTag("Storage.InvalidPathError", Effect.die)))
        .filter((item) => item.key !== prefixKey)
        .map((item) => ({ ...item, key: item.key.slice(prefixKey.length) }))
    }).pipe(Effect.withSpan("ProjectStorage.list")),
  } satisfies Interface
})

/** Build a ProjectStorage service Layer over the shared Storage authority. */
export const layer = (workspaceID: Workspace.ID, projectID: Project.ID): Layer.Layer<Service, never, Storage.Service> =>
  Layer.effect(Service, make(workspaceID, projectID))
