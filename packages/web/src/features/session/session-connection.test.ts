import { createComponent } from "solid-js"
import { ClientError } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import { Event } from "@bymorning/schema/event"
import { render, waitFor } from "@solidjs/testing-library"
import { QueryClientProvider } from "@tanstack/solid-query"
import { afterEach, expect, it } from "vitest"
import { TestTransport, ids, json, detail } from "../../../../client/test/solid/fixture"
import { createQuery } from "../../runtime/server/query"
import { createServer } from "../../runtime/server/sync"
import { createSessionConnection } from "./session-connection"
import type { SessionUI } from "./session-context"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const http = new TestTransport()
  http.when((r) => r.url.pathname === "/api/models", json([]))
  const query = createQuery()
  const server = createServer(
    { origin: "http://solid.test", identity: "test", workspace: ids.workspace, api: http.api },
    query,
  )
  cleanups.push(() => server.close())
  const connected = new Promise<void>((resolve) => server.connection.on("server.connected", () => resolve()))
  await http.receipt("/api/event")
  http.event({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
  await connected
  await server.bootstrap()
  await server.select(ids.session)
  let connection!: SessionUI.Interface
  const view = render(() =>
    createComponent(QueryClientProvider, {
      client: query,
      get children() {
        connection = createSessionConnection({
          server,
          client: http.api,
          sessionID: ids.session,
          agents: () => [],
          models: () => [],
        })
        return null
      },
    }),
  )
  cleanups.push(view.unmount)
  return { http, server, connection }
}

it("reads Forms and Permissions directly from the selected shared records", async () => {
  const { http, server, connection } = await setup()
  const form = {
    id: "frm_connection",
    sessionID: ids.session,
    title: "Questions",
    fields: [{ key: "answer", type: "string" }],
  }
  http.when((r) => r.url.pathname.endsWith("/form"), json([form]))
  http.when(
    (r) => r.url.pathname.endsWith("/permission"),
    json([{ id: "per_connection", sessionID: ids.session, action: "read", resources: ["workspace"] }]),
  )
  server.data.session.form.invalidate(ids.session)
  await server.data.session.form.sync(ids.session)
  server.data.session.permission.invalidate(ids.session)
  await server.data.session.permission.sync(ids.session)
  expect(connection.data.forms()).toEqual(server.data.session.form.list(ids.session))
  expect(connection.data.forms()).toHaveLength(1)
  expect(connection.data.permissions()).toEqual(server.data.session.permission.list(ids.session))
  expect(connection.data.permissions()).toMatchObject([{ action: "read" }])
})

it("reconciles a switched model from authoritative detail without relying on its live event", async () => {
  const { http, connection } = await setup()
  const model = { provider: Provider.Name.make("provider"), id: "alternate" }
  http.when((r) => r.url.pathname === `/api/session/${ids.session}`, json({ ...detail(), model }))
  http.when((r) => r.init.method === "POST", new Response(null, { status: 204 }))
  expect(await connection.selection.model(model)).toBe(true)
  const request = http.requests.find((r) => r.init.method === "POST")!
  expect(JSON.parse(String(request.init.body))).toMatchObject({ model })
  await waitFor(() => expect(connection.data.detail()).toMatchObject({ state: "ready", data: { model } }))
  expect(http.count(`/api/session/${ids.session}`)).toBe(2)
})

it("serializes rapid model changes and reconciles the final persisted selection", async () => {
  const { http, connection } = await setup()
  const alpha = { provider: Provider.Name.make("provider"), id: "alpha" }
  const beta = { provider: Provider.Name.make("provider"), id: "beta" }
  let persisted = alpha
  http.when(
    (r) => r.url.pathname === `/api/session/${ids.session}` && r.init.method === "GET",
    () => json({ ...detail(), model: persisted }),
  )
  http.when(
    (r) => r.url.pathname.startsWith(`/api/session/${ids.session}`) && r.init.method === "POST",
    (request) => {
      persisted = JSON.parse(String(request.init.body)).model
      return new Response(null, { status: 204 })
    },
  )

  expect(await Promise.all([connection.selection.model(alpha), connection.selection.model(beta)])).toEqual([true, true])

  const switches = http.requests
    .filter(
      (request) => request.url.pathname.startsWith(`/api/session/${ids.session}`) && request.init.method === "POST",
    )
    .map((request) => JSON.parse(String(request.init.body)).model)
  expect(switches).toEqual([alpha, beta])
  await waitFor(() => expect(connection.data.detail()).toMatchObject({ state: "ready", data: { model: beta } }))
})

it("preserves the original rejection object from native mutations", async () => {
  const { http, connection } = await setup()
  const error = new ClientError("Transport", { cause: new Error("transport unavailable") })
  http.when(
    (r) => r.init.method === "POST",
    () => Promise.reject(error),
  )
  await expect(connection.composer.compact()).rejects.toBe(error)
  await expect(connection.composer.cancel()).rejects.toBe(error)
  await expect(connection.composer.background()).rejects.toBe(error)
})

it("closing presentation leaves shared selection and transport alive", async () => {
  const { server, connection } = await setup()
  connection.close()
  connection.close()
  expect(server.data.session.get(ids.session)?.id).toBe(ids.session)
  expect(server.connection.state().state).not.toBe("disposed")
})

it("retains Forms and Permissions after rejected native replies and exposes the original SDK error", async () => {
  const { http, server, connection } = await setup()
  http.when(
    (r) => r.url.pathname.endsWith("/form"),
    json([{ id: "frm_reply", sessionID: ids.session, title: "Answer", fields: [{ key: "answer", type: "string" }] }]),
  )
  http.when(
    (r) => r.url.pathname.endsWith("/permission"),
    json([{ id: "per_reply", sessionID: ids.session, action: "read", resources: ["workspace"] }]),
  )
  server.data.session.form.invalidate(ids.session)
  server.data.session.permission.invalidate(ids.session)
  await Promise.all([server.data.session.form.sync(ids.session), server.data.session.permission.sync(ids.session)])
  const form = connection.data.forms()[0]!
  const permission = connection.data.permissions()[0]!
  const error = new ClientError("Transport", { cause: new Error("reply unavailable") })
  http.when(
    (r) => r.init.method === "POST",
    () => Promise.reject(error),
  )
  await expect(connection.form.reply(form, { answer: "yes" })).rejects.toBe(error)
  await expect(connection.form.cancel(form)).rejects.toBe(error)
  await expect(connection.permission.reply(permission, "once")).rejects.toBe(error)
  expect(connection.data.forms()).toEqual([form])
  expect(connection.data.permissions()).toEqual([permission])
  await waitFor(() => expect(connection.permission.pending(permission)).toBe(false))
  expect(connection.permission.error(permission)).toBeDefined()
})
