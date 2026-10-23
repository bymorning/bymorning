import type { Project } from "@bymorning/schema/project"
import { queryOptions, useMutation, type QueryClient } from "@tanstack/solid-query"
import { queryPolicy } from "../runtime/server/query"
import { scopeKey, type ServerScope } from "../runtime/server/scope"

export const directoryKey = (scope: ServerScope, projectID: Project.ID | undefined) =>
  [...scopeKey(scope), "project-directory", projectID] as const

export const directoryQuery = (scope: ServerScope, projectID: Project.ID | undefined) =>
  queryOptions({
    ...queryPolicy,
    queryKey: directoryKey(scope, projectID),
    enabled: projectID !== undefined,
    queryFn: async ({ signal }) => {
      if (!projectID) throw new Error("Project files are unavailable.")
      return (await scope.api.project.directory.list({ workspace: scope.workspace, projectID }, { signal })).paths
    },
  })

export const contentQuery = (scope: ServerScope, projectID: Project.ID | undefined, path: string | undefined) =>
  queryOptions({
    ...queryPolicy,
    queryKey: [...directoryKey(scope, projectID), "content", path] as const,
    enabled: projectID !== undefined && path !== undefined,
    queryFn: ({ signal }) => {
      if (!projectID || path === undefined) throw new Error("Project files are unavailable.")
      return scope.api.project.directory.read({ workspace: scope.workspace, projectID, path }, { signal })
    },
  })

export interface DirectoryWrite {
  readonly scope: ServerScope
  readonly projectID: Project.ID
  readonly path: string
  readonly contentType: string
  readonly file: File
}

export function directoryMutation(scope: ServerScope, client: QueryClient) {
  return useMutation(
    () => ({
      mutationKey: [...scopeKey(scope), "project-directory", "write"],
      retry: false,
      mutationFn: (input: DirectoryWrite) => writeDirectory(client, input),
    }),
    () => client,
  )
}

export async function writeDirectory(client: QueryClient, input: DirectoryWrite) {
  await input.scope.api.project.directory.write({
    workspace: input.scope.workspace,
    projectID: input.projectID,
    path: input.path,
    contentType: input.contentType,
    payload: new Uint8Array(await input.file.arrayBuffer()),
  })
  // A read started before the write must not settle over its successful refresh.
  await Promise.all([
    client.cancelQueries({ queryKey: directoryKey(input.scope, input.projectID), exact: true }),
    client.cancelQueries({ queryKey: contentQuery(input.scope, input.projectID, input.path).queryKey, exact: true }),
  ])
  await Promise.all([
    client.invalidateQueries({ queryKey: directoryKey(input.scope, input.projectID), exact: true, refetchType: "all" }),
    client.invalidateQueries({
      queryKey: contentQuery(input.scope, input.projectID, input.path).queryKey,
      exact: true,
      refetchType: "all",
    }),
  ])
}

export interface DirectoryDelete {
  readonly scope: ServerScope
  readonly projectID: Project.ID
  readonly path: string
}

export interface DirectoryMove {
  readonly scope: ServerScope
  readonly projectID: Project.ID
  readonly from: string
  readonly to: string
}

/** Delete one Project File, then refresh the listing and forget the removed file's cached bytes. */
export async function deleteDirectoryFile(client: QueryClient, input: DirectoryDelete) {
  await input.scope.api.project.directory.delete({
    workspace: input.scope.workspace,
    projectID: input.projectID,
    path: input.path,
  })
  await settleRemoved(client, input.scope, input.projectID, [input.path])
}

/** Move one Project File, then refresh the listing and forget the vacated path's cached bytes. */
export async function moveDirectoryFile(client: QueryClient, input: DirectoryMove) {
  await input.scope.api.project.directory.move({
    workspace: input.scope.workspace,
    projectID: input.projectID,
    from: input.from,
    to: input.to,
  })
  await settleRemoved(client, input.scope, input.projectID, [input.from])
  // Bytes cached for a file that once lived at the destination are no longer its content.
  await client.invalidateQueries({
    queryKey: contentQuery(input.scope, input.projectID, input.to).queryKey,
    exact: true,
    refetchType: "all",
  })
}

async function settleRemoved(
  client: QueryClient,
  scope: ServerScope,
  projectID: Project.ID,
  paths: ReadonlyArray<string>,
) {
  // A read started before the change must not settle over its refresh.
  await client.cancelQueries({ queryKey: directoryKey(scope, projectID), exact: true })
  // A vacated path has nothing to refetch; its bytes would only resurface stale content.
  for (const path of paths)
    client.removeQueries({ queryKey: contentQuery(scope, projectID, path).queryKey, exact: true })
  await client.invalidateQueries({ queryKey: directoryKey(scope, projectID), exact: true, refetchType: "all" })
}
