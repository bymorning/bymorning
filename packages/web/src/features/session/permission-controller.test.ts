/* oxlint-disable typescript/no-unsafe-type-assertion -- Controller fixtures implement only the exercised session seam. */
import { createRoot, createSignal } from "solid-js"
import { waitFor } from "@solidjs/testing-library"
import { Permission } from "@bymorning/schema/permission"
import { Session } from "@bymorning/schema/session"
import { describe, expect, it, vi } from "vitest"
import { QueryClient, useMutation } from "@tanstack/solid-query"

import { createController as createPermissionController } from "./permission-controller"

type Source = Parameters<typeof createPermissionController>[0]
function createController(source: Omit<Source, "permission"> & { permission: Pick<Source["permission"], "reply"> }) {
  const query = new QueryClient()
  const mutation = useMutation(
    () => ({ mutationFn: (args: Parameters<Source["permission"]["reply"]>) => source.permission.reply(...args) }),
    () => query,
  )
  return createPermissionController({
    ...source,
    permission: {
      reply: (...args) => mutation.mutateAsync(args),
      pending: (request) => mutation.variables?.[0].id === request.id && mutation.isPending,
      error: (request) => (mutation.variables?.[0].id === request.id ? mutation.error?.message : undefined),
    },
  })
}

const request = {
  id: "permission",
  action: "filesystem.read",
  resources: ["/tmp/a"],
  source: { messageID: "message", callID: "call" },
}
const emptyTranscript = () => ({ state: "ready" as const, data: [], loadingOlder: false })

describe("permission controller", () => {
  it("shows a child permission in the parent and replies using the child request", async () => {
    const parentID = Session.ID.make(crypto.randomUUID())
    const childID = Session.ID.make(crypto.randomUUID())
    const child = Permission.Request.make({
      id: Permission.ID.create(),
      sessionID: childID,
      action: "websearch",
      resources: ["cats"],
    })
    const reply = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue([child, { ...child, id: "unrelated", sessionID: "other" }])
    let dispose!: () => void
    const controller = createRoot((cleanup) => {
      dispose = cleanup
      return createController({
        data: { permissions: () => [], transcript: emptyTranscript },
        permission: { reply },
        children: {
          sessionID: parentID,
          sessions: () => [{ id: childID, parentID, title: "Research" }],
          revision: () => 0,
          connected: () => true,
          list,
        },
      })
    })
    try {
      await waitFor(() => expect(controller.item()?.id).toBe(child.id))
      expect(controller.item()?.title).toContain("Research")
      list.mockResolvedValue([])
      await controller.reply("once")
      expect(reply).toHaveBeenCalledWith(child, "once")
      await waitFor(() => expect(controller.item()).toBeUndefined())
    } finally {
      dispose()
    }
  })

  it("projects a narrow item, disables duplicate replies, and retains failure", async () => {
    const [permissions] = createSignal([request])
    const [transcript] = createSignal({
      state: "ready" as const,
      loadingOlder: false,
      data: [{ message: { id: "message", type: "assistant", content: [{ type: "tool", id: "call", name: "read" }] } }],
    })
    let reject!: (cause: Error) => void
    const reply = vi.fn(() => new Promise<void>((_, fail) => (reject = fail)))
    const controller = createRoot(() =>
      createController({
        data: { permissions, transcript },
        permission: { reply },
      } as never),
    )
    expect(controller.item()).toEqual({
      id: "permission",
      title: "Called read",
      action: "filesystem.read",
      resources: ["/tmp/a"],
    })
    const first = controller.reply("once")
    await controller.reply("reject")
    expect(reply).toHaveBeenCalledOnce()
    expect(controller.pending()).toBe(true)
    reject(new Error("Connection lost"))
    await first
    expect(controller.item()?.id).toBe("permission")
    expect(controller.error()).toBe("Connection lost")
    expect(controller.pending()).toBe(false)
  })

  it("scopes failure and pending state to the active request", async () => {
    const next = { ...request, id: "next", action: "filesystem.write" }
    const [permissions, setPermissions] = createSignal([request])
    let reject!: (cause: Error) => void
    let resolve!: () => void
    const reply = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_, fail) => (reject = fail)))
      .mockImplementationOnce(() => new Promise<void>((done) => (resolve = done)))
    const controller = createRoot(() =>
      createController({ data: { permissions, transcript: emptyTranscript }, permission: { reply } } as never),
    )

    const old = controller.reply("once")
    setPermissions([next])
    expect(controller.pending()).toBe(false)
    expect(controller.error()).toBeUndefined()
    const current = controller.reply("reject")
    expect(controller.pending()).toBe(true)
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    reject(new Error("old failure"))
    await old
    expect(controller.pending()).toBe(true)
    expect(controller.error()).toBeUndefined()
    expect(reply.mock.calls[0]?.[0]).toBe(request)
    expect(reply.mock.calls[1]?.[0]).toBe(next)
    resolve()
    await current
    expect(controller.pending()).toBe(false)
  })

  it("keeps a rematerialized same-ID request pending and suppresses duplicate replies", async () => {
    const [permissions, setPermissions] = createSignal([request])
    let resolve!: () => void
    const reply = vi.fn(() => new Promise<void>((done) => (resolve = done)))
    const controller = createRoot(() =>
      createController({ data: { permissions, transcript: emptyTranscript }, permission: { reply } } as never),
    )

    const active = controller.reply("once")
    setPermissions([{ ...request, resources: ["/tmp/b"] }])
    expect(controller.pending()).toBe(true)
    await controller.reply("reject")
    expect(reply).toHaveBeenCalledOnce()
    resolve()
    await active
    expect(controller.pending()).toBe(false)
  })

  it("applies same-ID completion to the rematerialized request", async () => {
    const [permissions, setPermissions] = createSignal([request])
    let reject!: (cause: Error) => void
    const reply = vi.fn(() => new Promise<void>((_, fail) => (reject = fail)))
    const controller = createRoot(() =>
      createController({ data: { permissions, transcript: emptyTranscript }, permission: { reply } } as never),
    )

    const active = controller.reply("once")
    setPermissions([{ ...request, action: "filesystem.write" }])
    await waitFor(() => expect(reply).toHaveBeenCalledOnce())
    reject(new Error("offline"))
    await active
    expect(controller.item()?.action).toBe("filesystem.write")
    expect(controller.error()).toBe("offline")
  })

  it("does not expose an earlier failure after a different-ID request replacement", async () => {
    const [permissions, setPermissions] = createSignal([request])
    const reply = vi.fn().mockRejectedValue(new Error("offline"))
    const controller = createRoot(() =>
      createController({ data: { permissions, transcript: emptyTranscript }, permission: { reply } } as never),
    )
    await controller.reply("once")
    expect(controller.error()).toBe("offline")
    setPermissions([{ ...request, id: "next", action: "filesystem.write" }])
    expect(controller.error()).toBeUndefined()
    expect(controller.item()?.action).toBe("filesystem.write")
  })

  it("looks up a permission tool by its exact message and updates when the part arrives", () => {
    const [permissions] = createSignal([request])
    const [transcript, setTranscript] = createSignal({ state: "ready", data: [], loadingOlder: false } as never)
    const controller = createRoot(() =>
      createController({ data: { permissions, transcript }, permission: { reply: vi.fn() } } as never),
    )

    expect(controller.item()?.title).toBe("filesystem.read")
    setTranscript({
      state: "ready",
      loadingOlder: false,
      data: [
        { message: { id: "other", type: "assistant", content: [{ type: "tool", id: "call", name: "wrong" }] } },
        { message: { id: "message", type: "assistant", content: [{ type: "tool", id: "call", name: "read" }] } },
      ],
    } as never)
    expect(controller.item()?.title).toBe("Called read")
  })
})
