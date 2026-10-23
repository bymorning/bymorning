import { describe, expect, it } from "vitest"

import type { SessionUI } from "../ui/session-model"
import { projectTimeline } from "./projection"
import { timelinePartKey } from "./timeline-row"

const preferences = { showAgent: true, showReasoning: true, showUsage: true }
const text = (id: string, value = "Answer"): SessionUI.TextPart => ({ type: "text", id, text: value })
const tool = (
  id: string,
  name: string,
  state: SessionUI.ToolState = { type: "succeeded" },
  metadata: SessionUI.JsonRecord = {},
): SessionUI.ToolPart => ({ type: "tool", id, name, input: {}, metadata, state })
const assistant = (id: string, parts: SessionUI.MessagePart[] = [text("text-1")]): SessionUI.AssistantMessage => ({
  id,
  parts,
  streaming: false,
  details: { model: "model" },
})
const turn = (id: string, messages = [assistant("assistant-1")]): SessionUI.Turn => ({
  type: "turn",
  id,
  user: { id, text: "Question" },
  assistant: messages,
  state: { type: "complete" },
})
const group = (projection: SessionUI.TimelineProjection, key: string) => {
  const row = projection.rowByKey.get(key)
  if (row?.type !== "assistant-part") throw new Error(`Expected assistant row ${key}`)
  return row.group
}
const entry = (projection: SessionUI.TimelineProjection, key: string) => {
  const value = group(projection, key)
  if (value.type !== "part") throw new Error(`Expected ordinary part ${key}`)
  return projection.partByKey.get(`${value.ref.messageID}:${value.ref.partID}`)!
}

describe("timeline projection", () => {
  it("scopes part lifecycle keys to semantic assistant rows", () => {
    expect(timelinePartKey("assistant-part:part:assistant-1:call", "call")).not.toBe(
      timelinePartKey("assistant-part:part:assistant-2:call", "call"),
    )
  })

  it("uses reference row keys and reuses an unchanged projection", () => {
    const first = projectTimeline([turn("user-1")], preferences)
    const second = projectTimeline([turn("user-1")], preferences, first.rows)

    expect(second.rows).toBe(first.rows)
    expect(second.rows.map((row) => row.key)).toEqual(["user-message:user-1", "assistant-part:part:assistant-1:text-1"])
    expect(second.messageFirstRowIndex.get("user-1")).toBe(0)
    expect(second.messageFirstRowIndex.get("assistant-1")).toBe(1)
    expect(second.activeLastRowKey).toBe("assistant-part:part:assistant-1:text-1")
  })

  it("updates streaming payload without replacing structural rows", () => {
    const first = projectTimeline(
      [turn("user-1", [{ ...assistant("assistant-1", [text("text-1", "A")]), streaming: true }])],
      preferences,
    )
    const second = projectTimeline(
      [turn("user-1", [{ ...assistant("assistant-1", [text("text-1", "AB")]), streaming: true }])],
      preferences,
      first.rows,
    )

    expect(second.rowByKey.get("user-message:user-1")).toBe(first.rowByKey.get("user-message:user-1"))
    expect(second.rowByKey.get("assistant-part:part:assistant-1:text-1")).toBe(
      first.rowByKey.get("assistant-part:part:assistant-1:text-1"),
    )
    expect(entry(second, "assistant-part:part:assistant-1:text-1").part).toMatchObject({ text: "AB" })
  })

  it("updates user payload without replacing its structural row", () => {
    const initial = turn("user-1")
    const first = projectTimeline([initial], preferences)
    const second = projectTimeline(
      [
        {
          ...initial,
          user: {
            ...initial.user!,
            agents: [{ name: "review", mention: { start: 0, end: 8, text: "Question" } }],
          },
        },
      ],
      preferences,
      first.rows,
    )

    expect(second.rowByKey.get("user-message:user-1")).toBe(first.rowByKey.get("user-message:user-1"))
    expect(second.userByID.get("user-1")?.agents).toHaveLength(1)
  })

  it("assigns one settled footer to the final non-empty text part across the complete turn", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          {
            ...assistant("assistant-1", [text("first", "First"), text("second", "Second")]),
            details: {
              agent: "explore",
              model: "First Model",
              durationMs: 1_000,
              usage: { tokens: 1_250, cost: 0.01, costComplete: true },
            },
          },
          {
            ...assistant("assistant-2", [text("blank", "  "), text("final", "Final answer")]),
            details: {
              agent: "build",
              model: "Final Model",
              durationMs: 2_000,
              usage: { tokens: 750, cost: 0.02, costComplete: true },
            },
          },
        ]),
      ],
      preferences,
    )
    const entries = projection.rows.flatMap((row) => {
      if (row.type !== "assistant-part" || row.group.type !== "part") return []
      const value = projection.partByKey.get(`${row.group.ref.messageID}:${row.group.ref.partID}`)
      return value ? [value] : []
    })

    expect(entries.filter((entry) => entry.copyText !== undefined)).toEqual([
      expect.objectContaining({
        messageID: "assistant-2",
        copyText: "Final answer",
        details: "build · Final Model · 2s · 2,000 tokens · $0.03",
      }),
    ])
  })

  it("ANDs usage completeness and labels a mixed turn subtotal", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          {
            ...assistant("assistant-1"),
            details: { model: "First", usage: { tokens: 10, cost: 0.01, costComplete: true } },
          },
          {
            ...assistant("assistant-2", [text("final")]),
            details: { model: "Final", usage: { tokens: 20, cost: 0.02, costComplete: false } },
          },
        ]),
      ],
      preferences,
    )

    expect(entry(projection, "assistant-part:part:assistant-2:final").details).toContain(
      "30 tokens · at least $0.03 (known subtotal; pricing incomplete)",
    )
  })

  it("suppresses a footer until a streaming turn settles", () => {
    const streaming = {
      ...turn("user-1", [{ ...assistant("assistant-1", [text("answer", "Growing answer")]), streaming: true }]),
      state: { type: "working" } as const,
    }
    const active = projectTimeline([streaming], preferences)
    const settled = projectTimeline(
      [
        {
          ...streaming,
          assistant: streaming.assistant.map((message) => ({ ...message, streaming: false })),
          state: { type: "complete" },
        },
      ],
      preferences,
      active.rows,
    )
    const activeEntry = entry(active, "assistant-part:part:assistant-1:answer")
    const settledEntry = entry(settled, "assistant-part:part:assistant-1:answer")

    expect(activeEntry.copyText).toBeUndefined()
    expect(settledEntry.copyText).toBe("Growing answer")
  })

  it("hides turn usage without hiding the remaining assistant metadata", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          {
            ...assistant("assistant-1", [text("answer")]),
            details: {
              agent: "build",
              model: "Model",
              durationMs: 2_000,
              usage: { tokens: 123, cost: 0.04, costComplete: true },
            },
          },
        ]),
      ],
      { ...preferences, showUsage: false },
    )
    const value = entry(projection, "assistant-part:part:assistant-1:answer")

    expect(value.details).toBe("build · Model · 2s")
  })

  it("uses turn duration and marks the selected footer interrupted", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [
            { ...assistant("assistant-1", [text("first")]), details: { model: "First", completedAt: 4_000 } },
            {
              ...assistant("assistant-2", [text("final")]),
              details: { agent: "build", model: "Final", completedAt: 8_400 },
            },
          ]),
          user: { id: "user-1", text: "Question", createdAt: 2_000 },
          state: { type: "interrupted" } as const,
        },
      ],
      preferences,
    )
    const value = entry(projection, "assistant-part:part:assistant-2:final")

    expect(value).toMatchObject({
      copyText: "Answer",
      details: "build · Final · 6s",
      interrupted: true,
    })
  })

  it("retains a leading assistant and keeps its identity when its user root arrives", () => {
    const message = assistant("assistant-1")
    const leading = projectTimeline(
      [{ type: "turn", id: "assistant-1", assistant: [message], state: { type: "complete" } }],
      preferences,
    )
    const attached = projectTimeline([turn("user-1", [message])], preferences, leading.rows)
    const key = "assistant-part:part:assistant-1:text-1"

    expect(leading.rows.map((row) => row.key)).toEqual([key])
    expect(attached.rows[0]?.key).toBe("user-message:user-1")
    expect(attached.rowByKey.get(key)).not.toBe(leading.rowByKey.get(key))
    expect(attached.rowByKey.get(key)?.key).toBe(leading.rowByKey.get(key)?.key)
  })

  it("keeps notices inside the surrounding turn and adds gaps only between turns", () => {
    const projection = projectTimeline(
      [
        { ...turn("user-1"), assistant: [] },
        { type: "notice", id: "notice-1", kind: "system", text: "Changed" },
        { type: "turn", id: "assistant-1", assistant: [assistant("assistant-1")], state: { type: "complete" } },
        turn("user-2", [assistant("assistant-2")]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "notice:notice-1",
      "assistant-part:part:assistant-1:text-1",
      "turn-gap:user-2",
      "user-message:user-2",
      "assistant-part:part:assistant-2:text-1",
    ])
    expect(projection.rowByKey.get("notice:notice-1")?.turnID).toBe("user-1")
  })

  it("groups adjacent context operations and respects content boundaries", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [
            tool("read-1", "read"),
            tool("grep-1", "grep"),
            text("text-1", "Result"),
            tool("list-1", "list"),
          ]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:read-1",
      "assistant-part:part:assistant-1:text-1",
      "assistant-part:context:assistant-1:list-1",
    ])
    const first = group(projection, "assistant-part:context:assistant-1:read-1")
    expect(first.type === "context" ? first.refs.map((ref) => ref.partID) : []).toEqual(["read-1", "grep-1"])
  })

  it("keeps patch and edit groups separate and leaves loaded reads ungrouped", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [
            tool("loaded", "read", { type: "succeeded" }, { loaded: ["src/a.ts"] }),
            tool("patch-1", "patch"),
            tool("patch-2", "patch"),
            tool("edit-1", "edit"),
          ]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:loaded",
      "assistant-part:part:assistant-1:patch-1",
      "assistant-part:part:assistant-1:edit-1",
    ])
    expect(group(projection, "assistant-part:part:assistant-1:loaded").type).toBe("part")
    expect(group(projection, "assistant-part:part:assistant-1:patch-1").type).toBe("file")
  })

  it.each(["read", "glob", "grep", "list"])("shows a failed %s separately from successful exploration", (name) => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [
            tool("before", "read"),
            tool("failure", name, { type: "failed", message: "File not found: missing.txt" }),
            tool("after", "list"),
          ]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:before",
      "assistant-part:part:assistant-1:failure",
      "assistant-part:context:assistant-1:after",
    ])
    expect(entry(projection, "assistant-part:part:assistant-1:failure").part).toMatchObject({
      name,
      state: { type: "failed", message: "File not found: missing.txt" },
    })
  })

  it.each(["interrupted", "stopped"] as const)("does not report an %s read as explored", (type) => {
    const projection = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read", { type })])])],
      preferences,
    )

    expect(entry(projection, "assistant-part:part:assistant-1:read-1").part).toMatchObject({ state: { type } })
  })

  it("re-keys one read row from context to ordinary when loaded metadata arrives", () => {
    const grouped = projectTimeline([turn("user-1", [assistant("assistant-1", [tool("read-1", "read")])])], preferences)
    const ordinary = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [tool("read-1", "read", { type: "succeeded" }, { loaded: ["a.ts"] })]),
        ]),
      ],
      preferences,
      grouped.rows,
    )

    expect(grouped.rows[1]?.key).toBe("assistant-part:context:assistant-1:read-1")
    expect(ordinary.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:read-1",
    ])
    expect(ordinary.rowByKey.has("assistant-part:context:assistant-1:read-1")).toBe(false)
    expect(ordinary.partByKey.get("assistant-1:read-1")?.part).toMatchObject({ metadata: { loaded: ["a.ts"] } })
  })

  it.each(["edit", "patch"])("keeps one failed %s row key while changing it from file to ordinary", (name) => {
    const grouped = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool(`${name}-1`, name, { type: "running" })])])],
      preferences,
    )
    const ordinary = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool(`${name}-1`, name, { type: "failed", message: "failed" })])])],
      preferences,
      grouped.rows,
    )

    expect(grouped.rows[1]?.key).toBe(`assistant-part:part:assistant-1:${name}-1`)
    expect(group(grouped, `assistant-part:part:assistant-1:${name}-1`).type).toBe("file")
    expect(ordinary.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      `assistant-part:part:assistant-1:${name}-1`,
    ])
    expect(group(ordinary, `assistant-part:part:assistant-1:${name}-1`).type).toBe("part")
    expect(ordinary.partByKey.get(`assistant-1:${name}-1`)?.part).toMatchObject({ state: { type: "failed" } })
  })

  it("preserves a context group key as members append or its first member disappears", () => {
    const first = projectTimeline([turn("user-1", [assistant("assistant-1", [tool("read-1", "read")])])], preferences)
    const appended = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read"), tool("grep-1", "grep")])])],
      preferences,
      first.rows,
    )
    const removed = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("grep-1", "grep")])])],
      preferences,
      appended.rows,
    )

    expect(appended.rows[1]?.key).toBe("assistant-part:context:assistant-1:read-1")
    expect(removed.rows[1]?.key).toBe("assistant-part:context:assistant-1:read-1")
  })

  it("does not collide group keys when a context group splits", () => {
    const first = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read"), tool("grep-1", "grep")])])],
      preferences,
    )
    const split = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read"), text("separator"), tool("grep-1", "grep")])])],
      preferences,
      first.rows,
    )

    expect(split.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:read-1",
      "assistant-part:part:assistant-1:separator",
      "assistant-part:context:assistant-1:grep-1",
    ])
    expect(new Set(split.rows.map((row) => row.key)).size).toBe(split.rows.length)
  })

  it("reserves an existing group key for its natural owner after a split", () => {
    const first = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read"), tool("grep-1", "grep")])])],
      preferences,
    )
    const split = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("grep-1", "grep"), text("separator"), tool("read-1", "read")])])],
      preferences,
      first.rows,
    )

    expect(split.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:grep-1",
      "assistant-part:part:assistant-1:separator",
      "assistant-part:context:assistant-1:read-1",
    ])
  })

  it("keeps the earliest prior identity when context groups merge", () => {
    const first = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("read-1", "read"), text("separator"), tool("grep-1", "grep")])])],
      preferences,
    )
    const merged = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("grep-1", "grep"), tool("read-1", "read")])])],
      preferences,
      first.rows,
    )

    expect(merged.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:read-1",
    ])
  })

  it("preserves grouped identity when history attaches the same parts to another turn", () => {
    const message = assistant("assistant-1", [tool("read-1", "read"), tool("grep-1", "grep")])
    const first = projectTimeline([turn("user-1", [message])], preferences)
    const moved = projectTimeline([turn("user-2", [message])], preferences, first.rows)

    expect(moved.rows[1]?.key).toBe("assistant-part:context:assistant-1:read-1")
    expect(moved.rows[1]?.turnID).toBe("user-2")
  })

  it("keeps repeated tool IDs unique across assistant messages", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [tool("same", "read")]),
          assistant("assistant-2", [text("separator"), tool("same", "grep")]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:context:assistant-1:same",
      "assistant-part:part:assistant-2:separator",
      "assistant-part:context:assistant-2:same",
    ])
  })

  it("hides unsupported transient tools and blank content from rows", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [
            text("blank", " \n "),
            { type: "reasoning", id: "reasoning", text: "\t" },
            tool("todo", "todowrite", { type: "running" }),
            tool("question", "question", { type: "running" }),
          ]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual(["user-message:user-1"])
    expect(projection.messageFirstRowIndex.has("assistant-1")).toBe(false)
  })

  it("shows active thinking when reasoning is hidden even after visible output", () => {
    const projection = projectTimeline([{ ...turn("user-1"), state: { type: "working" } }], {
      showAgent: true,
      showReasoning: false,
      showUsage: true,
    })

    expect(projection.rows.at(-1)).toMatchObject({ type: "thinking", key: "thinking:user-1" })
  })

  it("shows thinking after settled tools while the turn is still working", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [
            { ...assistant("assistant-1", [tool("read-1", "read", { type: "succeeded" })]), streaming: true },
          ]),
          state: { type: "working" },
        },
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.type)).toEqual(["user-message", "assistant-part", "thinking"])
  })

  it("suppresses redundant thinking while a subagent is visibly running", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [assistant("assistant-1", [tool("subagent", "subagent", { type: "running" })])]),
          state: { type: "working" },
        },
      ],
      { ...preferences, showReasoning: false },
    )

    expect(projection.rows.map((row) => row.type)).toEqual(["user-message", "assistant-part"])
  })

  it("keeps the latest non-queued turn active while a queued input is visible", () => {
    const projection = projectTimeline(
      [turn("user-1"), { ...turn("user-2", []), state: { type: "queued" } }],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:text-1",
      "turn-gap:user-2",
      "user-message:user-2",
    ])
    expect(projection.activeLastRowKey).toBe("assistant-part:part:assistant-1:text-1")
  })

  it("keeps backgroundable tools as ordinary transcript rows without synthetic presentation rows", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          assistant("assistant-1", [
            tool("subagent-1", "subagent", { type: "running" }),
            tool("subagent-2", "subagent", { type: "running" }),
          ]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.type)).toEqual(["user-message", "assistant-part", "assistant-part"])
    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:subagent-1",
      "assistant-part:part:assistant-1:subagent-2",
    ])
  })

  it.each([
    { state: { type: "interrupted" } as const, key: "turn-divider:user-1", type: "turn-divider" },
    {
      state: { type: "failed", failure: { type: "generic", message: "Provider failed" } } as const,
      key: "error:user-1",
      type: "error",
    },
  ])("projects representable $state.type state as a $type row", ({ state, key, type }) => {
    const projection = projectTimeline([{ ...turn("user-1"), state }], preferences)

    expect(projection.rows.at(-1)).toMatchObject({ key, type, turnID: "user-1" })
    expect(projection.activeLastRowKey).toBe(key)
  })

  it("keeps a failed execution before notices appended later", () => {
    const projection = projectTimeline(
      [
        { ...turn("user-1", []), state: { type: "failed", failure: { type: "generic", message: "Provider failed" } } },
        { type: "notice", id: "notice", kind: "selection", text: "Model changed" },
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual(["user-message:user-1", "error:user-1", "notice:notice"])
    expect(projection.activeLastRowKey).toBe("notice:notice")
  })

  it("removes a stale failure when a later assistant continuation recovers", () => {
    const projection = projectTimeline(
      [
        { ...turn("user-1"), state: { type: "failed", failure: { type: "generic", message: "Temporary" } } },
        { type: "notice", id: "notice", kind: "selection", text: "Model changed" },
        { type: "turn", id: "assistant-2", assistant: [assistant("assistant-2")], state: { type: "complete" } },
      ],
      preferences,
    )

    expect(projection.rows.some((row) => row.type === "error")).toBe(false)
    expect(projection.rows.map((row) => row.key)).toContain("assistant-part:part:assistant-2:text-1")
  })

  it("keeps an interruption boundary when a later assistant continues", () => {
    const projection = projectTimeline(
      [
        turn("user-1", [
          { ...assistant("assistant-1", [text("before")]), error: { type: "interrupted" } },
          assistant("assistant-2", [text("after")]),
        ]),
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:before",
      "turn-divider:user-1:assistant-1",
      "assistant-part:part:assistant-2:after",
    ])
  })

  it("does not add an interruption divider when compaction explains the continuation", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [{ ...assistant("assistant-1", [text("before")]), error: { type: "interrupted" } }]),
          state: { type: "interrupted" },
        },
        { type: "notice", id: "compaction", kind: "compaction", text: "Session compacted" },
        {
          type: "turn",
          id: "assistant-2",
          assistant: [assistant("assistant-2", [text("after")])],
          state: { type: "complete" },
        },
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:before",
      "notice:compaction",
      "assistant-part:part:assistant-2:after",
    ])
  })

  it("keeps repeated interruption boundaries uniquely keyed", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [{ ...assistant("assistant-1", [text("first")]), error: { type: "interrupted" } }]),
          state: { type: "interrupted" },
        },
        { type: "notice", id: "notice", kind: "system", text: "Continue" },
        {
          type: "turn",
          id: "assistant-2",
          assistant: [{ ...assistant("assistant-2", [text("second")]), error: { type: "interrupted" } }],
          state: { type: "interrupted" },
        },
      ],
      preferences,
    )
    const dividers = projection.rows.filter((row) => row.type === "turn-divider")

    expect(dividers.map((row) => row.key)).toEqual([
      "turn-divider:user-1:assistant-1",
      "turn-divider:user-1:assistant-2",
    ])
    expect(new Set(projection.rows.map((row) => row.key)).size).toBe(projection.rows.length)
  })

  it("keeps every consecutive interruption boundary", () => {
    const projection = projectTimeline(
      [
        {
          ...turn("user-1", [
            { ...assistant("assistant-1", [text("first")]), error: { type: "interrupted" } },
            { ...assistant("assistant-2", [text("second")]), error: { type: "interrupted" } },
          ]),
          state: { type: "interrupted" },
        },
      ],
      preferences,
    )

    expect(projection.rows.map((row) => row.key)).toEqual([
      "user-message:user-1",
      "assistant-part:part:assistant-1:first",
      "turn-divider:user-1:assistant-1",
      "assistant-part:part:assistant-2:second",
      "turn-divider:user-1:assistant-2",
    ])
  })

  it("does not group interrupted file tools as successful edits", () => {
    const projection = projectTimeline(
      [turn("user-1", [assistant("assistant-1", [tool("edit", "edit", { type: "interrupted" })])])],
      preferences,
    )

    expect(group(projection, "assistant-part:part:assistant-1:edit").type).toBe("part")
  })

  it("reuses semantically unchanged structured rows", () => {
    const message = (input: SessionUI.JsonRecord, metadata: SessionUI.JsonRecord): SessionUI.AssistantMessage => ({
      id: "assistant-1",
      streaming: false,
      parts: [{ type: "tool", id: "tool-1", name: "lookup", input, metadata, state: { type: "succeeded" } }],
    })
    const first = projectTimeline(
      [turn("user-1", [message({ path: "file.ts", offset: 1 }, { count: 1, cached: true })])],
      preferences,
    )
    const second = projectTimeline(
      [turn("user-1", [message({ offset: 1, path: "file.ts" }, { cached: true, count: 1 })])],
      preferences,
      first.rows,
    )

    expect(second.rows).toBe(first.rows)
  })

  it("reuses equal structured failures and replaces changed failure context", () => {
    const failed = (model: string): SessionUI.Item => ({
      ...turn("user-1", []),
      state: { type: "failed", failure: { type: "policy", agent: "Build", model } },
    })
    const first = projectTimeline([failed("Model A")], preferences)
    const equal = projectTimeline([failed("Model A")], preferences, first.rows)
    const changed = projectTimeline([failed("Model B")], preferences, equal.rows)

    expect(equal.rows).toBe(first.rows)
    expect(changed.rows.at(-1)).not.toBe(first.rows.at(-1))
    expect(changed.rows.at(-1)).toMatchObject({ failure: { model: "Model B" } })
  })
})
