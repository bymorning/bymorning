import type { MessageListResponse } from "@bymorning/client"
import { createEffect, createSignal, on, type Accessor } from "solid-js"

import type { SessionUI } from "../session-context"
import { isDurableMessage } from "../../../context/session-state"

type Message = MessageListResponse["data"][number]
const leadingTurnPageDelay = 200
const leadingTurnPageLimit = 3

export function createTimelineHistory(input: {
  readonly transcript: Accessor<SessionUI.Transcript>
  readonly loadOlder: () => Promise<void>
}) {
  const [prepared, setPrepared] = createSignal(false)
  let preparing = false
  createEffect(
    on([input.transcript, prepared], ([transcript, isPrepared]) => {
      if (transcript.state !== "ready" || isPrepared || preparing) return
      if (!leadingTurnNeedsParent(transcript.data.map((entry) => entry.message).filter(isDurableMessage))) {
        setPrepared(true)
        return
      }
      preparing = true
      void enrichLeadingTurn({
        messages: () => {
          const current = input.transcript()
          return current.state === "ready" ? current.data.map((entry) => entry.message).filter(isDurableMessage) : []
        },
        more: () => {
          const current = input.transcript()
          return current.state === "ready" && current.cursor !== undefined
        },
        loading: () => {
          const current = input.transcript()
          return current.state === "loading" || (current.state === "ready" && current.loadingOlder)
        },
        loadMore: input.loadOlder,
        pause: () => new Promise((resolve) => setTimeout(resolve, leadingTurnPageDelay)),
        maxPages: leadingTurnPageLimit,
      })
        .catch(() => undefined)
        .finally(() => {
          preparing = false
          setPrepared(true)
        })
    }),
  )
  return {
    ready: () => {
      const transcript = input.transcript()
      return (
        transcript.state === "ready" &&
        (prepared() || !leadingTurnNeedsParent(transcript.data.map((entry) => entry.message).filter(isDurableMessage)))
      )
    },
    messages: () => {
      const transcript = input.transcript()
      return transcript.state === "ready" ? transcript.data.map((entry) => entry.message).filter(isDurableMessage) : []
    },
    more: () => {
      const transcript = input.transcript()
      return transcript.state === "ready" && transcript.cursor !== undefined
    },
    loading: () => {
      const transcript = input.transcript()
      return transcript.state === "loading" || (transcript.state === "ready" && transcript.loadingOlder)
    },
    olderError: () => {
      const transcript = input.transcript()
      return transcript.state === "ready" ? transcript.olderError : undefined
    },
    loadOlder: () =>
      input.loadOlder().then(
        () => true,
        () => false,
      ),
  }
}

export async function enrichLeadingTurn(input: {
  readonly messages: Accessor<ReadonlyArray<Message>>
  readonly more: Accessor<boolean>
  readonly loading: Accessor<boolean>
  readonly loadMore: () => Promise<void>
  readonly pause: () => Promise<void>
  readonly maxPages: number
}) {
  const load = async (pages: number): Promise<void> => {
    if (pages >= input.maxPages || !leadingTurnNeedsParent(input.messages()) || !input.more()) return
    await input.pause()
    if (!leadingTurnNeedsParent(input.messages()) || !input.more()) return
    if (input.loading()) return load(pages)
    await input.loadMore()
    return load(pages + 1)
  }
  return load(0)
}

export function leadingTurnNeedsParent(messages: ReadonlyArray<Message>) {
  const assistant = messages.findIndex((message) => message.type === "assistant")
  if (assistant === -1) return false
  const boundary = messages.findIndex((message) => message.type === "user")
  return boundary === -1 || assistant < boundary
}

export type TimelineHistory = ReturnType<typeof createTimelineHistory>
