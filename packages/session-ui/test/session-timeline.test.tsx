import { cleanup, render } from "@solidjs/testing-library"
import type { Message, SessionID } from "@bymorning/client/solid"
import { afterEach, describe, expect, it } from "vitest"

import { SessionTimeline } from "../src/index.js"
import type { SessionUI } from "../src/model.js"

afterEach(cleanup)

const sessionID = "session-fixture" as SessionID
const message = (index: number): Extract<Message, { type: "user" }> => ({
  id: `message-${index}` as Message["id"],
  sessionID,
  sequence: index,
  createdAt: new Date(index),
  type: "user",
  text: `message ${index}`,
  admittedSequence: index,
})
const timeline = (count: number): readonly SessionUI.Row[] =>
  Array.from({ length: count }, (_, index) => ({ type: "message", key: `message:${index}`, message: message(index) }))

describe("SessionTimeline", () => {
  it("renders every caller-owned canonical row when virtualization is disabled", () => {
    const rows = timeline(1_000)
    const view = render(() => (
      <SessionTimeline
        sessionID={() => sessionID}
        rows={() => rows}
        loading={() => false}
        error={() => undefined}
        virtual={false}
      />
    ))

    expect(view.container.querySelectorAll("[data-timeline-key]")).toHaveLength(1_000)
    expect(view.container.querySelector("[data-timeline-key='message:0']")).toHaveTextContent("message 0")
    expect(view.container.querySelector("[data-timeline-key='message:999']")).toHaveTextContent("message 999")
  })

  it("bounds mounted DOM for a 1,000-row virtual transcript without mutating row order", () => {
    const rows = timeline(1_000)
    const view = render(() => (
      <SessionTimeline
        sessionID={() => sessionID}
        rows={() => rows}
        loading={() => false}
        error={() => undefined}
        virtual
      />
    ))
    const mounted = [...view.container.querySelectorAll<HTMLElement>("[data-timeline-key]")]

    expect(mounted.length).toBeLessThan(100)
    expect(mounted.map((row) => row.dataset.timelineKey)).toEqual(
      mounted
        .map((row) => row.dataset.timelineKey)
        .toSorted((left, right) => (left ?? "").localeCompare(right ?? "", undefined, { numeric: true })),
    )
  })
})
