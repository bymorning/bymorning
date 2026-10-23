import type { WorkspaceEventItem } from "@bymorning/client"
import type { Project } from "@bymorning/schema/project"
import { useQuery, type QueryClient } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { createStore } from "solid-js/store"
import { onCleanup } from "solid-js"
import {
  contentQuery,
  deleteDirectoryFile,
  directoryQuery,
  moveDirectoryFile,
  writeDirectory,
} from "../../project/directory"
import type { ServerScope } from "../../runtime/server/scope"
import { errorMessage } from "../../utils/error-message"
import type { DataState } from "./state"

/** A live notice that one Project File was written. */
export type ProjectFileChange = Extract<WorkspaceEventItem, { readonly type: "project.file.changed" }>

/** Transitional facade: QueryClient owns every response and request lifetime. */
export function createProjectDirectoryData(config: {
  readonly scope: ServerScope
  readonly query: QueryClient
  readonly ready: () => boolean
}) {
  const [revision, setRevision] = createStore({ value: 0 })
  onCleanup(config.query.getQueryCache().subscribe(() => setRevision("value", (value) => value + 1)))
  const paths = (projectID: Project.ID) => directoryQuery(config.scope, projectID)
  function list(projectID: Project.ID): ReadonlyArray<string>
  function list(projectID: Project.ID, signal: AbortSignal): Promise<ReadonlyArray<string>>
  function list(projectID: Project.ID, signal?: AbortSignal): ReadonlyArray<string> | Promise<ReadonlyArray<string>> {
    if (signal) return config.query.fetchQuery(paths(projectID))
    revision.value
    return config.query.getQueryData(paths(projectID).queryKey) ?? []
  }
  return {
    scope: config.scope,
    query: config.query,
    ready: config.ready,
    observe(projectID: () => Project.ID | undefined, active: () => boolean = () => true) {
      return useQuery(
        () => ({
          ...directoryQuery(config.scope, active() ? projectID() : undefined),
          enabled: config.ready() && active() && !!projectID(),
        }),
        () => config.query,
      )
    },
    content(
      projectID: () => Project.ID | undefined,
      path: () => string | undefined,
      active: () => boolean = () => true,
    ) {
      return useQuery(
        () => ({
          ...contentQuery(config.scope, projectID(), active() ? path() : undefined),
          enabled: config.ready() && active() && !!projectID() && path() !== undefined,
        }),
        () => config.query,
      )
    },
    state(projectID: Project.ID): DataState {
      revision.value
      const state = config.query.getQueryState(paths(projectID).queryKey)
      if (!state) return { state: "idle" }
      if (state.fetchStatus === "fetching") return { state: "loading" }
      if (state.status === "error") return { state: "error", message: errorMessage(state.error, "Request failed") }
      if (state.status === "success") return { state: "ready", refreshedAt: state.dataUpdatedAt }
      return { state: "idle" }
    },
    list,
    read: (projectID: Project.ID, path: string, _signal: AbortSignal) =>
      config.query.fetchQuery(contentQuery(config.scope, projectID, path)),
    async sync(projectID: Project.ID, _signal: AbortSignal) {
      await config.query.invalidateQueries({ queryKey: paths(projectID).queryKey, exact: true, refetchType: "none" })
      await config.query.fetchQuery(paths(projectID)).catch(() => undefined)
    },
    /**
     * Apply a Project File change written outside this client, such as by a Tool.
     *
     * Cached reads refresh wherever they live, as after a local upload: the query policy never
     * refetches on mount, so an invalidated listing or preview nobody currently observes would
     * otherwise stay stale until its next key change. Queries that were never read stay absent.
     */
    async apply(event: ProjectFileChange) {
      const content = contentQuery(config.scope, event.data.projectID, event.data.path).queryKey
      await Promise.all([
        config.query.invalidateQueries({
          queryKey: paths(event.data.projectID).queryKey,
          exact: true,
          refetchType: "all",
        }),
        config.query.invalidateQueries({ queryKey: content, exact: true, refetchType: "all" }),
      ])
    },
    async search(projectID: Project.ID, query: string, signal: AbortSignal) {
      if (!config.ready() || signal.aborted) return []
      const state = config.query.getQueryState(paths(projectID).queryKey)
      // Typing is a local projection, not an implicit retry of a failed read.
      if (state?.status === "error") throw state.error
      const values = await config.query.fetchQuery(paths(projectID))
      if (signal.aborted) return []
      return query ? fuzzysort.go(query, values, { limit: 10 }).map((result) => result.target) : values.slice(0, 10)
    },
    write: (projectID: Project.ID, path: string, contentType: string, file: File) =>
      writeDirectory(config.query, { scope: config.scope, projectID, path, contentType, file }),
    delete: (projectID: Project.ID, path: string) =>
      deleteDirectoryFile(config.query, { scope: config.scope, projectID, path }),
    move: (projectID: Project.ID, from: string, to: string) =>
      moveDirectoryFile(config.query, { scope: config.scope, projectID, from, to }),
  }
}
