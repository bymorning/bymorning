import * as Workspace from "@bymorning/schema/workspace"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"

import { createWorkspaceQuery } from "./query"

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const workspace = Workspace.ID.create()
const otherWorkspace = Workspace.ID.create()

type Config = Parameters<typeof createWorkspaceQuery<{ id: string }, string>>[0]

function mountQuery(config: Partial<Config> & Pick<Config, "fetch">) {
  return createRoot((dispose) => {
    const query = createWorkspaceQuery<{ id: string }, string>({
      workspace: () => workspace,
      resource: { signal: new AbortController().signal },
      key: (args) => args.id,
      ...config,
    })
    return { instance: query(() => ({ id: "account" })), dispose }
  })
}

describe("createWorkspaceQuery", () => {
  it("loads the entry for the requested key and retains its data while refetching", async () => {
    const first = Promise.withResolvers<string>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("second")
    const mounted = mountQuery({ fetch })

    expect(mounted.instance.state()).toEqual({ state: "loading" })
    first.resolve("first")
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "first",
    })
    expect(fetch).toHaveBeenCalledWith(workspace, { id: "account" }, expect.anything())

    mounted.instance.refetch()
    expect(mounted.instance.state()).toEqual({
      state: "loading",
      refreshedAt: expect.any(Number),
      data: "first",
    })
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "second",
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    mounted.dispose()
  })

  it("keeps entries per key: unseen keys show no data while a revisited key resurfaces its entry", async () => {
    const fetch = vi.fn((_workspace: Workspace.ID, args: { cursor?: string | undefined }) =>
      Promise.resolve(`page:${args.cursor ?? "head"}`),
    )
    const [args, setArgs] = createSignal<{ cursor?: string | undefined }>({ cursor: undefined })
    const mounted = createRoot((dispose) => {
      const query = createWorkspaceQuery<{ cursor?: string | undefined }, string>({
        workspace: () => workspace,
        resource: { signal: new AbortController().signal },
        key: (args) => args.cursor ?? "head",
        fetch,
      })
      return { instance: query(args), dispose }
    })

    expect(mounted.instance.state()).toEqual({ state: "loading" })
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "page:head",
    })

    setArgs({ cursor: "next" })
    expect(mounted.instance.state()).toEqual({ state: "loading" })
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "page:next",
    })
    expect(fetch).toHaveBeenCalledTimes(2)

    setArgs({ cursor: undefined })
    expect(mounted.instance.state()).toEqual({
      state: "loading",
      refreshedAt: expect.any(Number),
      data: "page:head",
    })
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "page:head",
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    mounted.dispose()
  })

  it("discards results fetched for another workspace and aborts the in-flight request on switch", async () => {
    const [workspaceID, setWorkspaceID] = createSignal(workspace)
    const requests = [Promise.withResolvers<string>(), Promise.withResolvers<string>()]
    const signals: Array<AbortSignal> = []
    let call = 0
    const fetch = vi.fn((_workspace: Workspace.ID, _args: { id: string }, resource: { signal: AbortSignal }) => {
      signals.push(resource.signal)
      return requests[call++]!.promise
    })
    const mounted = createRoot((dispose) => {
      const query = createWorkspaceQuery<{ id: string }, string>({
        workspace: () => workspaceID(),
        resource: { signal: new AbortController().signal },
        key: (args) => args.id,
        fetch,
      })
      return { instance: query(() => ({ id: "account" })), dispose }
    })

    expect(mounted.instance.state()).toEqual({ state: "loading" })
    setWorkspaceID(otherWorkspace)
    expect(signals[0]!.aborted).toBe(true)
    expect(mounted.instance.state()).toEqual({ state: "loading" })

    requests[1]!.resolve("second")
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "second",
    })
    requests[0]!.resolve("first")
    await flush()
    expect(mounted.instance.state().data).toBe("second")
    expect(fetch).toHaveBeenCalledTimes(2)
    mounted.dispose()
  })

  it("keeps the retained data and reports the failure when a refresh rejects", async () => {
    const fetch = vi.fn<() => Promise<string>>().mockResolvedValueOnce("first")
    const mounted = mountQuery({ fetch })

    await flush()
    expect(mounted.instance.state()).toMatchObject({ state: "ready", data: "first" })

    fetch.mockRejectedValueOnce(new Error("Unavailable"))
    mounted.instance.refetch()
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "error",
      refreshedAt: expect.any(Number),
      message: "Unavailable",
      data: "first",
    })

    fetch.mockResolvedValueOnce("second")
    mounted.instance.refetch()
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "second",
    })
    mounted.dispose()
  })

  it("stays idle without fetching while args are undefined", async () => {
    const fetch = vi.fn<() => Promise<string>>().mockResolvedValue("loaded")
    const [args, setArgs] = createSignal<{ id: string } | undefined>(undefined)
    const mounted = createRoot((dispose) => {
      const query = createWorkspaceQuery<{ id: string }, string>({
        workspace: () => workspace,
        resource: { signal: new AbortController().signal },
        key: (args) => args.id,
        fetch,
      })
      return { instance: query(args), dispose }
    })

    expect(mounted.instance.state()).toEqual({ state: "idle" })
    mounted.instance.refetch()
    expect(fetch).not.toHaveBeenCalled()

    setArgs({ id: "account" })
    expect(mounted.instance.state()).toEqual({ state: "loading" })
    await flush()
    expect(mounted.instance.state()).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
      data: "loaded",
    })
    mounted.dispose()
  })

  it("aborts the active attempt when the query unmounts", async () => {
    const pending = Promise.withResolvers<string>()
    const signals: Array<AbortSignal> = []
    const fetch = vi.fn((_workspace: Workspace.ID, _args: { id: string }, resource: { signal: AbortSignal }) => {
      signals.push(resource.signal)
      return pending.promise
    })
    const mounted = mountQuery({ fetch })

    expect(fetch).toHaveBeenCalledTimes(1)
    mounted.dispose()
    expect(signals[0]!.aborted).toBe(true)
    pending.resolve("late")
    await flush()
    expect(mounted.instance.state()).toEqual({ state: "loading" })
  })
})
