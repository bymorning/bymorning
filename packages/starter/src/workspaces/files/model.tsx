import type { ID as ProjectID } from "@bymorning/schema/project"
import { createMutation, createQuery, queryOptions, useMutationState, useQueryClient } from "@tanstack/solid-query"
import {
  createComponent,
  createContext,
  createEffect,
  createMemo,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerScope } from "@/runtime/server/scope.js"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

type WriteInput = {
  readonly scope: ServerScope
  readonly projectID: ProjectID
  readonly path: string
  readonly draft: string
}

export const directoryQuery = (scope: ServerScope, projectID: ProjectID) =>
  queryOptions({
    queryKey: [scope.origin, scope.identity, scope.workspace, "project-directory", projectID] as const,
    queryFn: ({ signal }) => scope.api.project.directory.list({ workspace: scope.workspace, projectID }, { signal }),
  })

export const contentQuery = (scope: ServerScope, projectID: ProjectID, path: string) =>
  queryOptions({
    queryKey: [scope.origin, scope.identity, scope.workspace, "project-directory-content", projectID, path] as const,
    queryFn: ({ signal }) =>
      scope.api.project.directory.read({ workspace: scope.workspace, projectID, path }, { signal }),
  })

function text(bytes: Uint8Array): string | undefined {
  try {
    const value = decoder.decode(bytes)
    // Valid UTF-8 can still represent binary data. Control bytes are not useful
    // in this plain text editor, so refuse them rather than writing them back.
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? undefined : value
  } catch {
    return undefined
  }
}

function createFileModel(props: {
  readonly scope: Accessor<ServerScope>
  readonly projectID: Accessor<ProjectID | undefined>
  readonly connected: Accessor<boolean>
}) {
  const client = useQueryClient()
  const [store, setStore] = createStore<{
    selected?: string
    filter: string
    drafts: Record<string, string>
    active?: { readonly scope: string; readonly projectID: ProjectID }
  }>({ filter: "", drafts: {} })

  const scopeKey = (scope: ServerScope) => `${scope.origin}:${scope.identity}:${scope.workspace}`
  const activeProject = () => {
    const projectID = props.projectID()
    const active = store.active
    return projectID !== undefined && active?.projectID === projectID && active.scope === scopeKey(props.scope())
  }

  // An enabled observer fetches when it first becomes enabled. Once a resource
  // has activated, keep it enabled across a temporary disconnect so reconnect
  // recovery remains exclusively owned by ServerSync. A different project that
  // is selected offline has no activation and cannot start a request.
  createEffect(() => {
    const scope = props.scope()
    const projectID = props.projectID()
    if (props.connected() && projectID !== undefined) setStore("active", { scope: scopeKey(scope), projectID })
  })

  const directory = createQuery(() => {
    const scope = props.scope()
    const projectID = props.projectID()
    return {
      ...directoryQuery(scope, projectID as ProjectID),
      enabled: projectID !== undefined && activeProject(),
    }
  })
  const paths = createMemo(() => directory.data?.paths ?? [])
  const selected = createMemo(() => {
    const path = store.selected
    return path && paths().includes(path) ? path : undefined
  })
  const content = createQuery(() => {
    const scope = props.scope()
    const projectID = props.projectID()
    const path = selected()
    return {
      ...contentQuery(scope, projectID as ProjectID, path ?? ""),
      enabled: projectID !== undefined && path !== undefined && activeProject(),
    }
  })
  const contentText = createMemo(() => (content.data ? text(content.data) : undefined))

  createEffect(() => {
    const scope = props.scope()
    const projectID = props.projectID()
    // A provider is normally keyed by this identity, but reset local state too:
    // drafts must never cross a project or authenticated scope boundary.
    void `${scope.origin}:${scope.identity}:${scope.workspace}:${projectID ?? ""}`
    setStore({ selected: undefined, filter: "", drafts: {} })
  })

  createEffect(() => {
    const path = selected()
    const value = contentText()
    if (path && value !== undefined && store.drafts[path] === undefined) setStore("drafts", path, value)
  })

  const write = createMutation(() => ({
    mutationKey: ["project-directory-write"],
    retry: false,
    mutationFn: async (input: WriteInput) => {
      // The only accepted paths are directory results from this scope/project.
      // Capture every request identity before the async write starts.
      const listed = client.getQueryData(directoryQuery(input.scope, input.projectID).queryKey)?.paths
      if (!listed?.includes(input.path)) throw new Error("That file is no longer available.")
      await input.scope.api.project.directory.write({
        workspace: input.scope.workspace,
        projectID: input.projectID,
        path: input.path,
        payload: encoder.encode(input.draft),
        contentType: "text/plain; charset=utf-8",
      })
    },
    onSuccess: async (_value, input) => {
      await Promise.all([
        client.invalidateQueries({
          ...contentQuery(input.scope, input.projectID, input.path),
          exact: true,
          refetchType: "active",
        }),
        client.invalidateQueries({
          ...directoryQuery(input.scope, input.projectID),
          exact: true,
          refetchType: "active",
        }),
      ])
    },
  }))
  // MutationObserver follows only its most recently invoked mutation. The
  // MutationCache retains every active/completed write, so use its native
  // projection to retain the latest result for each file while another file is
  // being saved.
  const writes = useMutationState(() => ({
    filters: { mutationKey: ["project-directory-write"], exact: true },
    select: (mutation) => ({
      variables: mutation.state.variables as WriteInput | undefined,
      status: mutation.state.status,
      error: mutation.state.error,
      submittedAt: mutation.state.submittedAt,
    }),
  }))

  const filtered = createMemo(() => {
    const needle = store.filter.trim().toLocaleLowerCase()
    if (!needle) return paths()
    return paths().filter((path) => fuzzy(path.toLocaleLowerCase(), needle))
  })
  const select = (path: string) => {
    if (props.connected() && paths().includes(path)) setStore("selected", path)
  }
  const writeState = createMemo(() => {
    const scope = props.scope()
    const projectID = props.projectID()
    const path = selected()
    const draft = path ? store.drafts[path] : undefined
    const current =
      projectID === undefined || path === undefined
        ? undefined
        : writes()
            .filter((write) => target(write.variables, scope, projectID, path))
            .sort((left, right) => right.submittedAt - left.submittedAt)[0]
    return {
      pending: current?.status === "pending",
      // Editing after a failed write explicitly clears the stale error for the
      // new draft; saving again creates the next native mutation record.
      error: current?.status === "error" && current.variables?.draft === draft ? current.error : undefined,
    }
  })
  const save = () => {
    const projectID = props.projectID()
    const path = selected()
    const draft = path ? store.drafts[path] : undefined
    if (!props.connected() || !projectID || !path || draft === undefined || contentText() === undefined) return
    write.mutate({ scope: props.scope(), projectID, path, draft })
  }

  return {
    directory,
    content,
    write,
    writeState,
    paths,
    filtered,
    selected,
    connected: props.connected,
    filter: () => store.filter,
    setFilter: (filter: string) => setStore("filter", filter),
    select,
    draft: () => {
      const path = selected()
      return path ? store.drafts[path] : undefined
    },
    setDraft: (draft: string) => {
      const path = selected()
      if (path && contentText() !== undefined) setStore("drafts", path, draft)
    },
    text: contentText,
    save,
  }
}

export type FileModel = ReturnType<typeof createFileModel>

const FileContext = createContext<FileModel>()

export function FileProvider(
  props: ParentProps<{
    readonly scope: Accessor<ServerScope>
    readonly projectID: Accessor<ProjectID | undefined>
    /** The server stream must be connected before directory I/O is enabled. */
    readonly connected: Accessor<boolean>
  }>,
) {
  const model = createFileModel(props)
  return createComponent(FileContext.Provider, {
    value: model,
    get children() {
      return props.children
    },
  })
}

export function useFile(): FileModel {
  const model = useContext(FileContext)
  if (!model) throw new Error("FileProvider is missing")
  return model
}

function fuzzy(value: string, query: string) {
  let cursor = 0
  for (const character of query) {
    cursor = value.indexOf(character, cursor)
    if (cursor === -1) return false
    cursor += 1
  }
  return true
}

function target(input: WriteInput | undefined, scope: ServerScope, projectID: ProjectID, path: string) {
  return (
    input !== undefined &&
    input.projectID === projectID &&
    input.path === path &&
    input.scope.origin === scope.origin &&
    input.scope.identity === scope.identity &&
    input.scope.workspace === scope.workspace
  )
}
