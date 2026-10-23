import { createData } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"

import { TestEvents, TestTransport, ids, owner } from "./fixture.js"

const eventID = "00000000-0000-4000-8000-000000000097" as SDK.WorkspaceEventItem["id"]

describe("final data audit", () => {
  test("keeps Run state live after its Session is evicted", () => {
    const events = new TestEvents()
    const scoped = owner(() => createData({ api: () => new TestTransport().api, workspace: ids.workspace, event: events }))
    events.emit({ id: eventID, type: "session.run.started", created: 1, data: { sessionID: ids.session } })
    scoped.value.session.evict(ids.session)
    events.emit({ id: eventID, type: "session.run.succeeded", created: 2, data: { sessionID: ids.session } })
    expect(scoped.value.session.active.get(ids.session)).toBe("idle")
    expect(scoped.value.session.message.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("reports an unknown direct mutation defect and preserves its identity", async () => {
    const events = new TestEvents()
    const defect = new Error("unexpected accessor failure")
    const reports: unknown[] = []
    let fail = false
    const transport = new TestTransport()
    const scoped = owner(() => createData({
      api: () => { if (fail) throw defect; return transport.api },
      workspace: ids.workspace,
      event: events,
      report: (cause) => reports.push(cause),
    }))
    fail = true
    await expect(scoped.value.project.create({} as SDK.ProjectCreateInput)).rejects.toBe(defect)
    expect(reports).toEqual([defect])
    scoped.dispose()
  })
})
