import { createData } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"

import { TestEvents, TestTransport, ids, json, owner } from "./fixture.js"

// These are protocol-valid UUID/project identifiers; @bymorning/client/solid does not
// depend on schema at test runtime, so retain their generated SDK brands here.
const eventID = "00000000-0000-4000-8000-000000000099" as SDK.WorkspaceEventItem["id"]
const projectID = "prj_00000000000000000000000000" as SDK.SessionInfo["projectID"]
const created = "2025-02-03T04:05:06.000Z"

const inbox: SDK.SessionInboxInfo = {
  id: ids.message,
  sessionID: ids.session,
  admittedSequence: 1,
  createdAt: new Date(created),
  type: "user",
  payload: { text: "durable prompt" },
  delivery: "queue",
}

describe("Workspace Event projection", () => {
  test("keeps an admitted prompt visible through promotion using the canonical dated Message", () => {
    const events = new TestEvents()
    const scoped = owner(() => createData({ api: () => new TestTransport().api, workspace: ids.workspace, event: events }))

    const admitted: Extract<SDK.WorkspaceEventItem, { type: "session.input.admitted" }> = {
      id: eventID,
      type: "session.input.admitted",
      created: 1,
      data: { sessionID: ids.session, item: inbox },
    }
    const promoted: Extract<SDK.WorkspaceEventItem, { type: "session.input.promoted" }> = {
      id: eventID,
      type: "session.input.promoted",
      created: 2,
      data: {
        sessionID: ids.session,
        inboxID: ids.message,
        message: { id: ids.message, sessionID: ids.session, sequence: 1, createdAt: created, type: "user", text: "durable prompt", admittedSequence: 1 },
      },
    }

    events.emit(admitted)
    expect(scoped.value.session.inbox.list(ids.session)).toEqual([inbox])
    events.emit(promoted)
    expect(scoped.value.session.inbox.list(ids.session)).toEqual([])
    expect(scoped.value.session.message.get(ids.session, ids.message)).toMatchObject({ text: "durable prompt", createdAt: new Date(created) })
    scoped.dispose()
  })

  test("projects live Permission and Form requests without starting an HTTP read", () => {
    const events = new TestEvents(); const transport = new TestTransport()
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    const permissionID = "per_live" as SDK.PermissionRequest["id"]
    const formID = "frm_live" as SDK.FormInfo["id"]
    const asked: Extract<SDK.WorkspaceEventItem, { type: "permission.v2.asked" }> = { id: eventID, type: "permission.v2.asked", created: 1, data: { id: permissionID, sessionID: ids.session, action: "read", resources: ["workspace"] } }
    const form: Extract<SDK.WorkspaceEventItem, { type: "form.created" }> = { id: eventID, type: "form.created", created: 2, data: { id: formID, sessionID: ids.session, title: "Confirm", fields: [{ key: "answer", type: "string" }] } }
    events.emit(asked); events.emit(form)
    expect(scoped.value.session.permission.list(ids.session)).toMatchObject([{ id: permissionID, action: "read" }])
    expect(scoped.value.session.form.list(ids.session)).toMatchObject([{ id: formID, title: "Confirm" }])
    expect(transport.requests).toEqual([])
    scoped.dispose()
  })

  test("reconciles create results and created/updated Session events into the root cache", async () => {
    const transport = new TestTransport()
    const createdSession: SDK.SessionInfo = { id: ids.other, projectID, title: "created", agent: "agent" as SDK.SessionInfo["agent"], model: { id: "model", provider: "provider" as SDK.SessionInfo["model"]["provider"] }, createdAt: new Date(created), updatedAt: new Date(created) }
    transport.when((request) => request.url.pathname === "/api/session" && request.init.method === "POST", json(createdSession, 201))
    const events = new TestEvents()
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))

    await scoped.value.session.create({ workspace: ids.workspace, projectID: createdSession.projectID })
    expect(scoped.value.session.list()).toContainEqual(createdSession)
    const updated = { ...createdSession, title: "renamed" }
    const event: Extract<SDK.WorkspaceEventItem, { type: "session.updated" }> = { id: eventID, type: "session.updated", created: 6, data: { sessionID: ids.other, session: updated } }
    events.emit(event)
    expect(scoped.value.session.list()).toContainEqual(updated)
    scoped.dispose()
  })

  test("keeps a known request-settlement rejection intact, invalidates only, then recovers on explicit sync", async () => {
    const transport = new TestTransport()
    const error: SDK.PermissionNotFoundError = { _tag: "Permission.NotFoundError", requestID: "per_missing", message: "already settled" }
    let lists = 0
    transport.when((request) => request.url.pathname.endsWith("/permission") && request.init.method === "GET", () => json(lists++ === 0 ? [{ id: "per_missing", sessionID: ids.session, action: "read", resources: [] }] : []))
    transport.when((request) => request.url.pathname.includes("/permission/") && request.init.method === "POST", json(error, 404))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    await scoped.value.session.permission.sync(ids.session)
    await expect(scoped.value.session.permission.reply({ sessionID: ids.session, requestID: "per_missing" as SDK.PermissionRequest["id"], reply: "once" })).rejects.toMatchObject(error)
    expect(transport.count(`/api/session/${ids.session}/permission`)).toBe(1)
    await scoped.value.session.permission.sync(ids.session)
    expect(scoped.value.session.permission.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("handles an already-settled Form the same way without an implicit recovery read", async () => {
    const transport = new TestTransport()
    const formID = "frm_missing" as SDK.FormInfo["id"]
    const error: SDK.FormAlreadySettledError = { _tag: "Form.AlreadySettledError", id: formID, message: "already settled" }
    let lists = 0
    transport.when((request) => request.url.pathname.endsWith("/form") && request.init.method === "GET", () => json(lists++ === 0 ? [{ id: formID, sessionID: ids.session, title: "Missing", fields: [{ key: "answer", type: "string" }] }] : []))
    transport.when((request) => request.url.pathname.includes("/form/") && request.init.method === "POST", json(error, 409))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    await scoped.value.session.form.sync(ids.session)
    await expect(scoped.value.session.form.reply({ sessionID: ids.session, formID, answer: { answer: "yes" } })).rejects.toMatchObject(error)
    expect(transport.count(`/api/session/${ids.session}/form`)).toBe(1)
    await scoped.value.session.form.sync(ids.session)
    expect(scoped.value.session.form.list(ids.session)).toEqual([])
    scoped.dispose()
  })
})
