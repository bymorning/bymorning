import type { MessageListResponse } from "@bymorning/client"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"

import type { SessionUI } from "../session-context"
import { createTimelineHistory, enrichLeadingTurn, leadingTurnNeedsParent } from "./model"

type Message = MessageListResponse["data"][number]
const user = (sequence: number) =>
  ({ type: "user", id: `user-${sequence}`, sessionID: "session", sequence, text: "prompt" }) as unknown as Message
const assistant = (sequence: number) =>
  ({
    type: "assistant",
    id: `assistant-${sequence}`,
    sessionID: "session",
    sequence,
    model: { provider: "test", id: "model" },
    content: [],
  }) as unknown as Message

describe("timeline history model", () => {
  it("reports older-load success without replacing the transcript error source", async () => {
    const [transcript] = createSignal<SessionUI.Transcript>({
      state: "ready",
      data: [],
      cursor: "older",
      loadingOlder: false,
      olderError: "offline",
    })
    const loadOlder = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce()
    let history!: ReturnType<typeof createTimelineHistory>
    const dispose = createRoot((dispose) => {
      history = createTimelineHistory({ transcript, loadOlder })
      return dispose
    })

    await expect(history.loadOlder()).resolves.toBe(false)
    expect(history.olderError()).toBe("offline")
    await expect(history.loadOlder()).resolves.toBe(true)
    dispose()
  })

  it("recognizes and fills a leading partial assistant turn with bounded pages", async () => {
    const pages: Message[][] = [[assistant(1)], [user(0)]]
    const messages: Message[] = [assistant(2), user(3)]
    let pauses = 0
    let loads = 0

    expect(leadingTurnNeedsParent(messages)).toBe(true)
    await enrichLeadingTurn({
      messages: () => messages,
      more: () => pages.length > 0,
      loading: () => false,
      loadMore: async () => {
        messages.unshift(...pages.shift()!)
        loads += 1
      },
      pause: async () => {
        pauses += 1
      },
      maxPages: 3,
    })

    expect({ loads, pauses }).toEqual({ loads: 2, pauses: 2 })
    expect(leadingTurnNeedsParent(messages)).toBe(false)
  })

  it("holds history readiness until leading-turn preparation finishes", async () => {
    const [transcript, setTranscript] = createSignal<SessionUI.Transcript>({
      state: "ready",
      data: [assistant(2), user(3)].map((message) => ({ message, parts: {}, origin: "server" as const, revision: 0 })),
      cursor: "older",
      loadingOlder: false,
    })
    const loadOlder = vi.fn(async () => {
      setTranscript((current) =>
        current.state === "ready"
          ? {
              ...current,
              data: [{ message: user(1), parts: {}, origin: "server", revision: 0 }, ...current.data],
              cursor: undefined,
              loadingOlder: false,
            }
          : current,
      )
    })
    let history!: ReturnType<typeof createTimelineHistory>
    const dispose = createRoot((dispose) => {
      history = createTimelineHistory({ transcript, loadOlder })
      return dispose
    })

    expect(history.ready()).toBe(false)
    await vi.waitFor(() => expect(history.ready()).toBe(true), { timeout: 500 })
    expect(loadOlder).toHaveBeenCalledOnce()
    dispose()
  })
})
