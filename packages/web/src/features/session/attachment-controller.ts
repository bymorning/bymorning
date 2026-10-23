import { createEffect, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { Project } from "@bymorning/schema/project"
import { useMutation, useMutationState, type QueryClient } from "@tanstack/solid-query"
import type { Data } from "../../context/data"
import { scopeKey, type ServerScope } from "../../runtime/server/scope"
import type { ComposerModel } from "./ui/session-composer"

export function createAttachmentController(source: {
  readonly scope: Accessor<Project.ID | undefined>
  readonly write: Data["projectDirectory"]["write"]
  readonly server: ServerScope
  readonly query: QueryClient
}): ComposerModel["attachments"] {
  type Upload = {
    readonly id: string
    readonly projectID: Project.ID
    readonly scope: ServerScope
    readonly file: File
  }
  const key = [...scopeKey(source.server), "project-directory", "attachment", crypto.randomUUID()]
  const mutation = useMutation(
    () => ({
      mutationKey: key,
      retry: false,
      // A selected attachment must remain ready even after the default five-minute GC.
      gcTime: Infinity,
      mutationFn: (input: Upload) =>
        source.write(input.projectID, input.file.name, input.file.type || "application/octet-stream", input.file),
    }),
    () => source.query,
  )
  const uploads = useMutationState(
    () => ({
      filters: { mutationKey: key, exact: true },
      select: (entry) => ({ variables: entry.state.variables as Upload | undefined, status: entry.state.status }),
    }),
    () => source.query,
  )
  const [store, setStore] = createStore({ items: [] as { id: string; path: string }[] })
  const release = (id?: string) => {
    const cache = source.query.getMutationCache()
    for (const entry of cache.findAll({ mutationKey: key, exact: true })) {
      if (id === undefined || (entry.state.variables as Upload | undefined)?.id === id) cache.remove(entry)
    }
  }
  onCleanup(() => release())
  let project = source.scope()
  createEffect(() => {
    const next = source.scope()
    if (next === project) return
    project = next
    release()
    setStore("items", [])
  })
  return {
    items: () =>
      store.items.map((item) => {
        const current = uploads().find((upload) => upload.variables?.id === item.id)
        return {
          ...item,
          state: current?.status === "success" ? "ready" : current?.status === "error" ? "error" : "uploading",
        }
      }),
    disabled: () => source.scope() === undefined,
    add: (files) => {
      const projectID = source.scope()
      if (!projectID) return
      for (const file of files) {
        const id = crypto.randomUUID()
        setStore("items", (items) => [...items, { id, path: file.name }])
        mutation.mutate({ id, projectID, scope: source.server, file })
      }
    },
    remove: (id) => {
      setStore("items", (items) => items.filter((item) => item.id !== id))
      release(id)
    },
  }
}
