/** Shared Project archive fixtures for backend, SDK, and browser tests. */
export * as ProjectArchive from "./project-archive.js"

import type { Project } from "@bymorning/schema/project"
import { Effect } from "effect"
import type { TestApp } from "../application.js"

/** Archive a Project through the real SDK; the fixture must already be logged in. */
export const archive = Effect.fn("ProjectArchive.archive")(function* (app: TestApp.Interface, projectID: Project.ID) {
  return yield* Effect.tryPromise(() => app.client.project.update({ projectID, archived: true }))
})

/** Restore an archived Project through the real SDK. */
export const restore = Effect.fn("ProjectArchive.restore")(function* (app: TestApp.Interface, projectID: Project.ID) {
  return yield* Effect.tryPromise(() => app.client.project.update({ projectID, archived: false }))
})

/** The Workspace's Default Project: its first Project, provisioned at login. */
export const defaultProject = Effect.fn("ProjectArchive.defaultProject")(function* (app: TestApp.Interface) {
  const [first] = yield* Effect.tryPromise(() => app.client.project.list())
  if (first === undefined) return yield* Effect.die(new Error("The Workspace has no Project"))
  return first
})
