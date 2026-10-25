import { cleanup, render, screen } from "@solidjs/testing-library"
import { createComponent, createSignal, type Accessor } from "solid-js"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  TimelineOlderError,
  timelineCachedMeasurements,
  timelineMeasuredSize,
  timelineVirtualIndexes,
} from "./virtualizer"
import { TimelineRow } from "./timeline-row"
import { projectTimeline } from "./projection"
import type { SessionUI } from "../ui/session-model"

afterEach(cleanup)

describe("timeline virtual indexes", () => {
  it("quantizes subpixel measures without oscillating across a whole pixel", () => {
    expect(timelineMeasuredSize(32.4, undefined)).toBe(32)
    expect(timelineMeasuredSize(32.6, 32)).toBe(32)
    expect(timelineMeasuredSize(31.6, 32)).toBe(32)
    expect(timelineMeasuredSize(33.2, 32)).toBe(33)
    expect(timelineMeasuredSize(180.4, 60)).toBe(180)
  })

  it("rejects legacy fallback snapshots and reconciles authoritative sizes by current key order", () => {
    const legacy = {
      measurements: [
        { index: 0, key: "a", start: 0, size: 60, end: 60, lane: 0 },
        { index: 1, key: "b", start: 60, size: 60, end: 120, lane: 0 },
      ],
      disclosure: {},
    }
    expect(timelineCachedMeasurements([{ key: "a" }, { key: "b" }], legacy)).toEqual([])

    expect(
      timelineCachedMeasurements([{ key: "b" }, { key: "new" }, { key: "a" }], {
        version: 1,
        measurements: [
          { key: "removed", size: 90 },
          { key: "a", size: 24 },
          { key: "b", size: 378 },
        ],
        disclosure: {},
      }),
    ).toEqual([
      { index: 0, key: "b", start: 0, size: 378, end: 378, lane: 0 },
      { index: 2, key: "a", start: 0, size: 24, end: 24, lane: 0 },
    ])
  })

  it("drops grouped measurements after a tool re-keys to an ordinary row", () => {
    expect(
      timelineCachedMeasurements([{ key: "user-message:user-1" }, { key: "assistant-part:part:assistant-1:read-1" }], {
        version: 1,
        measurements: [
          { key: "user-message:user-1", size: 40 },
          { key: "assistant-part:context:assistant-1:read-1", size: 240 },
        ],
        disclosure: {},
      }),
    ).toEqual([{ index: 0, key: "user-message:user-1", start: 0, size: 40, end: 40, lane: 0 }])
  })

  it("includes active and focused rows outside overscan without invalid indexes", () => {
    expect(timelineVirtualIndexes({ startIndex: 20, endIndex: 24, overscan: 2, count: 100 }, [99, 3, -1, 100])).toEqual(
      [3, 18, 19, 20, 21, 22, 23, 24, 25, 26, 99],
    )
  })

  it("preserves reactive row accessor props", () => {
    const gap = () => ({ type: "turn-gap", key: "turn-gap", turnID: "turn" }) as SessionUI.TimelineRow
    const thinking = () => ({ type: "thinking", key: "thinking", turnID: "turn" }) as SessionUI.TimelineRow
    const [row, setRow] = createSignal<Accessor<SessionUI.TimelineRow>>(gap)
    const projection = () => projectTimeline([], { showAgent: true, showReasoning: true, showUsage: true })
    const view = render(() =>
      createComponent(TimelineRow, {
        get row() {
          return row()
        },
        projection,
        projectFiles: [],
        onFileOpen: () => undefined,
      }),
    )

    expect(view.container.querySelector('[data-timeline-row="TurnGap"]')).not.toBeNull()
    setRow(() => thinking)
    expect(view.container.querySelector('[data-timeline-row="Thinking"]')).not.toBeNull()
  })

  it("surfaces an older-history failure as an accessible retry control", async () => {
    const retry = vi.fn(async () => true)
    render(() => createComponent(TimelineOlderError, { error: "History request failed", loading: false, retry }))

    expect(screen.getByRole("alert")).toHaveTextContent("History request failed")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))

    expect(retry).toHaveBeenCalledOnce()
  })
})
