import type { WorkspaceEventItem } from "@bymorning/client"
import { createRoot } from "solid-js"
import { describe, expect, it } from "vitest"
import { createSidebarController, parseSidebar, type SidebarRequest } from "./sidebar-controller"

const success = (input: {
  readonly sessionID: string
  readonly name: string
  readonly result?: unknown
}): WorkspaceEventItem =>
  ({
    id: "evt_1",
    type: "session.tool.success",
    created: 0,
    data: {
      sessionID: input.sessionID,
      messageID: "msg_1",
      callID: "call_1",
      name: input.name,
      input: {},
      content: [],
      ...(input.result === undefined ? {} : { result: input.result }),
    },
  }) as unknown as WorkspaceEventItem

/** Drives the subscriber from a fixed list, then lets its microtasks drain. */
async function apply(events: ReadonlyArray<WorkspaceEventItem>, sessionID = "session_a") {
  const applied: SidebarRequest[] = []
  const dispose = createRoot((dispose) => {
    createSidebarController({
      subscribe: async function* () {
        for (const event of events) yield event
      },
      sessionID: () => sessionID,
      apply: (request) => applied.push(request),
    })
    return dispose
  })
  // One macrotask turn drains every microtask the async iteration queued.
  await new Promise((resolve) => setTimeout(resolve, 0))
  dispose()
  return applied
}

describe("parseSidebar", () => {
  it("reads an open request with a file", () => {
    expect(parseSidebar({ open: true, path: "dashboards/status.html" })).toEqual({
      open: true,
      path: "dashboards/status.html",
    })
  })

  it("reads an open request with no file", () => {
    expect(parseSidebar({ open: true })).toEqual({ open: true })
  })

  it("drops a path when the request closes, so closing never reopens on a file", () => {
    expect(parseSidebar({ open: false, path: "dashboards/status.html" })).toEqual({ open: false })
  })

  it("rejects payloads that are not a sidebar result", () => {
    for (const value of [undefined, null, "open", 1, [], {}, { open: "true" }, { path: "a.md" }])
      expect(parseSidebar(value)).toBeUndefined()
  })

  it("ignores a non-string or empty path rather than selecting nothing", () => {
    expect(parseSidebar({ open: true, path: "" })).toEqual({ open: true })
    expect(parseSidebar({ open: true, path: 7 })).toEqual({ open: true })
  })
})

describe("createSidebarController", () => {
  it("applies a sidebar Tool result for this Session", async () => {
    expect(
      await apply([
        success({ sessionID: "session_a", name: "sidebar", result: { open: true, path: "reports/q3.md" } }),
      ]),
    ).toEqual([{ open: true, path: "reports/q3.md" }])
  })

  it("ignores other Tools", async () => {
    expect(
      await apply([success({ sessionID: "session_a", name: "write", result: { open: true, path: "reports/q3.md" } })]),
    ).toEqual([])
  })

  it("ignores another Session, so a background subagent cannot move this sidebar", async () => {
    expect(
      await apply([
        success({ sessionID: "session_b", name: "sidebar", result: { open: true, path: "reports/q3.md" } }),
      ]),
    ).toEqual([])
  })

  it("ignores a result it cannot read instead of guessing a state", async () => {
    expect(await apply([success({ sessionID: "session_a", name: "sidebar", result: { open: "yes" } })])).toEqual([])
  })

  it("applies each request in order", async () => {
    expect(
      await apply([
        success({ sessionID: "session_a", name: "sidebar", result: { open: true, path: "a.md" } }),
        success({ sessionID: "session_a", name: "read", result: "unrelated" }),
        success({ sessionID: "session_a", name: "sidebar", result: { open: false } }),
      ]),
    ).toEqual([{ open: true, path: "a.md" }, { open: false }])
  })
})
