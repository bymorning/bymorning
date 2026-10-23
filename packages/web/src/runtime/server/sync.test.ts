import { ByMorning, type ByMorningClient } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as Session from "@bymorning/schema/session"
import { QueryObserver } from "@tanstack/solid-query"
import { describe, expect, it, vi } from "vitest"
import { createServer } from "./sync"
import { createQuery, recoverDirectory } from "./query"
import { scopeKey, type ServerScope } from "./scope"
import { workspaceQuery } from "../workspace"

function fixture() {
  const api = ByMorning.make({ baseUrl: "http://configured.example/api/" })
  let signal: AbortSignal | undefined
  const subscribe: ByMorningClient["event"]["subscribe"] = (_input, options) =>
    (async function* () {
      signal = options?.signal
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
    })()
  const scope: ServerScope = {
    origin: "http://configured.example/api/",
    identity: "generation-1",
    workspace: Workspace.ID.create(),
    api: { ...api, event: { subscribe } },
  }
  return { scope, signal: () => signal }
}

describe("server lifetime", () => {
  it("enables file queries after the initial handshake without activating Data bootstrap", async () => {
    const { scope } = fixture()
    const gate = Promise.withResolvers<void>()
    const api: ByMorningClient = {
      ...scope.api,
      event: {
        subscribe: (_input, options) =>
          (async function* () {
            await gate.promise
            yield { type: "server.connected", data: {} } as never
            await new Promise<void>((resolve) =>
              options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
            )
          })(),
      },
    }
    const query = createQuery()
    const refetch = vi.spyOn(query, "refetchQueries")
    const list = vi.spyOn(api.project, "list")
    const server = createServer({ ...scope, api }, query)
    expect(server.queryReady()).toBe(false)
    gate.resolve()
    await vi.waitFor(() => expect(server.queryReady()).toBe(true))
    expect(server.state().state).toBe("loading")
    expect(list).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
    await server.close()
  })
  it("stages bootstrap and awaits query cancellation before disposing the detached root", async () => {
    const { scope, signal } = fixture()
    const list = vi.spyOn(scope.api.project, "list")
    const query = createQuery()
    const gate = Promise.withResolvers<void>()
    vi.spyOn(query, "cancelQueries").mockReturnValue(gate.promise)
    const server = createServer(scope, query)
    expect(list).not.toHaveBeenCalled()
    expect(server.queryReady()).toBe(false)
    const mutations = query.getMutationCache()
    mutations.build(query, { mutationKey: [...scopeKey(scope), "project-directory", "write"] })
    const other = mutations.build(query, {
      mutationKey: [...scopeKey({ ...scope, identity: "other" }), "project-directory", "write"],
    })
    const closing = server.close()
    expect(signal()?.aborted).toBe(false)
    gate.resolve()
    await closing
    expect(signal()?.aborted).toBe(true)
    expect(server.connection.state().state).toBe("disposed")
    expect(mutations.getAll()).toEqual([other])
    expect(server.close()).toBe(closing)
  })

  it("evicts an obsolete selection without clearing the newer selection", async () => {
    const { scope } = fixture()
    const server = createServer(scope, createQuery())
    const a = Session.ID.make(crypto.randomUUID()),
      b = Session.ID.make(crypto.randomUUID())
    const gate = Promise.withResolvers<void>()
    const evict = vi.spyOn(server.data.session, "evict")
    for (const part of [
      server.data.session.detail,
      server.data.session.message,
      server.data.session.inbox,
      server.data.session.permission,
      server.data.session.form,
    ]) {
      vi.spyOn(part, "sync").mockImplementation((id) => (id === a ? gate.promise : Promise.resolve()))
    }
    const first = server.select(a)
    await server.select(b)
    gate.resolve()
    await first
    expect(evict).toHaveBeenCalledWith(a)
    expect(evict).not.toHaveBeenCalledWith(b)
    await server.close()
  })

  const ready = async (server: ReturnType<typeof createServer>) => {
    for (const part of [
      server.data.project,
      server.data.agent,
      server.data.model,
      server.data.session,
      server.data.session.active,
    ])
      vi.spyOn(part, "sync").mockResolvedValue()
    await server.bootstrap()
  }

  it("marks a selection ready once detail and Messages land while the remaining lists are still loading", async () => {
    const { scope } = fixture()
    const server = createServer(scope, createQuery())
    await ready(server)
    const id = Session.ID.make(crypto.randomUUID())
    const gate = Promise.withResolvers<void>()
    const started: string[] = []
    const parts = {
      detail: server.data.session.detail,
      message: server.data.session.message,
      inbox: server.data.session.inbox,
      permission: server.data.session.permission,
      form: server.data.session.form,
    }
    for (const [name, part] of Object.entries(parts)) {
      vi.spyOn(part, "sync").mockImplementation(() => {
        started.push(name)
        return name === "detail" || name === "message" ? Promise.resolve() : gate.promise
      })
    }
    const evict = vi.spyOn(server.data.session, "evict")
    await server.select(id)
    // One round trip: every read starts together, and the gate waits only for detail + Messages.
    expect(started.slice(0, 5)).toEqual(["detail", "message", "inbox", "permission", "form"])
    expect(server.state()).toEqual({ state: "ready" })
    await server.select(undefined)
    expect(evict).toHaveBeenCalledWith(id)
    gate.resolve()
    await server.close()
  })

  it("keeps a ready selection when a secondary list read fails after the gate", async () => {
    const { scope } = fixture()
    const server = createServer(scope, createQuery())
    await ready(server)
    const id = Session.ID.make(crypto.randomUUID())
    const failure = Promise.withResolvers<void>()
    for (const part of [server.data.session.detail, server.data.session.message, server.data.session.permission])
      vi.spyOn(part, "sync").mockResolvedValue()
    vi.spyOn(server.data.session.inbox, "sync").mockReturnValue(failure.promise)
    vi.spyOn(server.data.session.form, "sync").mockResolvedValue()
    await server.select(id)
    expect(server.state()).toEqual({ state: "ready" })
    failure.reject(new Error("inbox unavailable"))
    await failure.promise.catch(() => undefined)
    await Promise.resolve()
    expect(server.state()).toEqual({ state: "ready" })
    await server.close()
  })

  it("keeps a blocked transport gated and exposes its error", async () => {
    const { scope } = fixture()
    const error = { _tag: "UnauthorizedError" as const }
    scope.api.event.subscribe = () =>
      (async function* () {
        throw error
      })()
    const server = createServer(scope, createQuery())
    await vi.waitFor(() => expect(server.connection.state().state).toBe("blocked"))
    expect(server.queryReady()).toBe(false)
    expect(server.state()).toEqual({ state: "error", error })
    await server.close()
  })

  it("keeps bootstrap errors independent of successful selection and ignores obsolete bootstrap completion", async () => {
    const { scope } = fixture()
    const server = createServer(scope, createQuery())
    const first = Promise.withResolvers<void>()
    const error = new Error("catalog unavailable")
    const parts = [
      server.data.project,
      server.data.agent,
      server.data.model,
      server.data.session,
      server.data.session.active,
    ]
    for (const part of parts) vi.spyOn(part, "sync").mockResolvedValue()
    vi.mocked(server.data.project.sync).mockReturnValueOnce(first.promise).mockRejectedValueOnce(error)
    const obsolete = server.bootstrap()
    await expect(server.bootstrap()).rejects.toBe(error)
    await server.select(undefined)
    first.resolve()
    await obsolete
    expect(server.state()).toEqual({ state: "error", error })
    await server.bootstrap()
    expect(server.state()).toEqual({ state: "ready" })
    await server.close()
  })

  it("isolates replacement scopes while the old scope's cancellation is pending", async () => {
    const old = fixture(),
      next = fixture()
    const query = createQuery()
    const gate = Promise.withResolvers<void>()
    vi.spyOn(query, "cancelQueries").mockReturnValueOnce(gate.promise)
    const previous = createServer(old.scope, query)
    query.setQueryData([...scopeKey(old.scope), "project-directory"], ["old"])
    const closing = previous.close()
    const current = createServer(next.scope, query)
    const key = [...scopeKey(next.scope), "project-directory"]
    query.setQueryData(key, ["new"])
    gate.resolve()
    await closing
    expect(old.signal()?.aborted).toBe(true)
    expect(next.signal()?.aborted).toBe(false)
    expect(query.getQueryData(key)).toEqual(["new"])
    await current.close()
  })
})

describe("narrow Query ownership", () => {
  it("forwards discovery cancellation and separates authentication generations", async () => {
    const { scope } = fixture()
    const query = createQuery()
    let signal: AbortSignal | undefined
    vi.spyOn(scope.api.workspace, "list").mockImplementation((options) => {
      signal = options?.signal
      return new Promise(() => {})
    })
    const options = workspaceQuery(scope)
    const pending = query.fetchQuery(options).catch(() => undefined)
    await query.cancelQueries()
    await pending
    expect(signal?.aborted).toBe(true)
    expect(workspaceQuery({ ...scope, identity: "generation-2" }).queryKey).not.toEqual(options.queryKey)
    query.clear()
  })

  it("recovers only active directory keys, independently of cached errors", async () => {
    const { scope } = fixture()
    const query = createQuery()
    const loads = Array.from({ length: 5 }, () => vi.fn(async () => "fresh"))
    const keys = [
      [...scopeKey(scope), "project-directory", "p"],
      [...scopeKey(scope), "project-directory", "p", "content", "file"],
      [...scopeKey(scope), "project-directory", "inactive"],
      [...scopeKey(scope), "session"],
      [scope.origin, "other-identity", scope.workspace, "project-directory", "p"],
    ]
    const off = keys.map((queryKey, index) => {
      query.setQueryData(queryKey, "cached")
      const observer = new QueryObserver(query, { queryKey, queryFn: loads[index]! })
      return index === 2 ? () => undefined : observer.subscribe(() => {})
    })
    loads[0]!.mockRejectedValue(new Error("paths failed"))
    await recoverDirectory(query, scope)
    expect(loads.map((load) => load.mock.calls.length)).toEqual([1, 1, 0, 0, 0])
    expect(query.getQueryData(keys[1]!)).toBe("fresh")
    expect(query.getQueryState(keys[0]!)?.status).toBe("error")
    off.forEach((stop) => stop())
    query.clear()
  })
})
