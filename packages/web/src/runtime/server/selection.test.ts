import { Event } from "@bymorning/schema/event"
import { describe, expect, it } from "vitest"
import { TestTransport, detail, ids, json, message, session } from "../../../../client/test/solid/fixture"
import { createQuery } from "./query"
import { createServer } from "./sync"

describe("selected shared history", () => {
  it("bootstraps every root inventory page without retaining Session detail", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname === "/api/models", json([]))
    transport.when(
      (request) => request.url.pathname === "/api/session",
      (request) =>
        json(
          request.url.searchParams.has("cursor")
            ? { data: [session(ids.other)] }
            : { data: [session()], cursor: "next-page" },
        ),
    )
    const query = createQuery()
    const server = createServer(
      { api: transport.api, origin: "http://solid.test", workspace: ids.workspace, identity: "pages" },
      query,
    )
    try {
      expect(transport.count("/api/session")).toBe(0)
      await server.bootstrap()
      expect(server.data.session.list().map((row) => row.id)).toEqual([ids.session, ids.other])
      expect(server.data.session.more()).toBe(false)
      expect(server.data.session.get(ids.session)).toBeUndefined()
      expect(server.bootstrapState()).toEqual({ state: "ready" })
    } finally {
      await server.close()
      query.clear()
    }
  })

  it("retains only selected live Messages and recovers another selection through the real SDK", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname === "/api/models", json([]))
    const query = createQuery()
    const server = createServer(
      { api: transport.api, origin: "http://solid.test", workspace: ids.workspace, identity: "test" },
      query,
    )
    try {
      await transport.receipt("/api/event")
      const connected = new Promise<void>((resolve) => {
        const off = server.connection.on("server.connected", () => {
          off()
          resolve()
        })
      })
      transport.event({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
      await connected
      await server.bootstrap()
      await server.select(ids.session)
      const deliver = async (sessionID: typeof ids.session) => {
        const observed = new Promise<void>((resolve) => {
          const off = server.connection.on("session.input.promoted", () => {
            off()
            resolve()
          })
        })
        transport.event({
          id: Event.ID.make(crypto.randomUUID()),
          type: "session.input.promoted",
          created: Date.now(),
          data: { sessionID, inboxID: ids.message, message: { ...message(), sessionID, type: "user" } },
        })
        await observed
      }
      await deliver(ids.other)
      expect(server.data.session.message.list(ids.other)).toEqual([])
      await deliver(ids.session)
      expect(server.data.session.message.list(ids.session).map((row) => row.id)).toEqual([ids.message])
      await server.select(ids.other)
      expect(server.data.session.message.list(ids.session)).toEqual([])
      expect(server.data.session.get(ids.other)?.id).toBe(ids.other)
      await server.select(undefined)
      expect(server.data.session.get(ids.other)).toBeUndefined()
    } finally {
      await server.close()
      query.clear()
    }
  })

  it("ignores a stale Session release after a newer selection has taken over", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname === "/api/models", json([]))
    const query = createQuery()
    const server = createServer(
      { api: transport.api, origin: "http://solid.test", workspace: ids.workspace, identity: "release" },
      query,
    )
    try {
      await server.bootstrap()
      await server.select(ids.session)
      const pending = server.select(ids.other)
      server.release(ids.session)
      await pending
      expect(server.data.session.get(ids.other)?.id).toBe(ids.other)
      server.release(ids.session)
      expect(server.data.session.get(ids.other)?.id).toBe(ids.other)
    } finally {
      await server.close()
      query.clear()
    }
  })

  it("selects a previously unselected Session while another Session's live events keep arriving", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname === "/api/models", json([]))
    const query = createQuery()
    const server = createServer(
      { api: transport.api, origin: "http://solid.test", workspace: ids.workspace, identity: "live-select" },
      query,
    )
    try {
      await transport.receipt("/api/event")
      const connected = new Promise<void>((resolve) => {
        const off = server.connection.on("server.connected", () => {
          off()
          resolve()
        })
      })
      transport.event({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
      await connected
      await server.bootstrap()
      await server.select(ids.session)
      transport.event({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.run.started",
        created: Date.now(),
        data: { sessionID: ids.other },
      })
      transport.event({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.run.started",
        created: Date.now(),
        data: { sessionID: ids.session },
      })
      const gate = Promise.withResolvers<Response>()
      transport.when((request) => request.url.pathname === `/api/session/${ids.other}`, gate.promise)
      const selecting = server.select(ids.other)
      await transport.receipt(`/api/session/${ids.other}`)
      transport.event({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.text.delta",
        created: Date.now(),
        data: { sessionID: ids.session, messageID: ids.message, partID: "text", text: "live" },
      })
      transport.event({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.run.started",
        created: Date.now(),
        data: { sessionID: ids.other },
      })
      const flushed = new Promise<void>((resolve) => {
        const off = server.connection.on("session.run.succeeded", () => {
          off()
          resolve()
        })
      })
      transport.event({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.run.succeeded",
        created: Date.now(),
        data: { sessionID: ids.session },
      })
      await flushed
      server.release(ids.session)
      gate.resolve(json({ ...session(ids.other), usage: detail(ids.other).usage }))
      await selecting
      expect(server.data.session.get(ids.other)?.id).toBe(ids.other)
      expect(server.data.session.message.list(ids.session)).toEqual([])
    } finally {
      await server.close()
      query.clear()
    }
  })
})
