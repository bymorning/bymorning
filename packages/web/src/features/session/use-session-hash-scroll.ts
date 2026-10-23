import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"

import type { TimelineInteraction } from "./timeline/interaction"
import { messageIDFromHash } from "./message-id-from-hash"

type UserMessage = { readonly id: string; readonly text: string }

export function useSessionHashScroll(input: {
  readonly sessionKey: () => string
  readonly sessionID: () => string | undefined
  readonly messagesReady: () => boolean
  readonly visibleUserMessages: () => ReadonlyArray<UserMessage>
  readonly historyMore: () => boolean
  readonly historyLoading: () => boolean
  readonly loadMore: () => Promise<boolean>
  readonly interaction: TimelineInteraction
}) {
  const location = useLocation()
  const navigate = useNavigate()
  return createSessionHashScroll({
    ...input,
    route: {
      hash: () => location.hash,
      replace: (hash) => navigate(location.pathname + location.search + hash, { replace: true }),
    },
  })
}

export function createSessionHashScroll(input: {
  readonly sessionKey: () => string
  readonly sessionID: () => string | undefined
  readonly messagesReady: () => boolean
  readonly visibleUserMessages: () => ReadonlyArray<UserMessage>
  readonly historyMore: () => boolean
  readonly historyLoading: () => boolean
  readonly loadMore: () => Promise<boolean>
  readonly interaction: TimelineInteraction
  readonly route: { readonly hash: () => string; readonly replace: (hash: string) => void }
}) {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageByID = createMemo(() => new Map(visibleUserMessages().map((message) => [message.id, message])))
  let currentMessageID: string | undefined
  let ownerSessionKey = input.sessionKey()
  let scrollMark = 0
  let messageMark = 0
  let scrollRestoration: History["scrollRestoration"] | undefined
  const frames = new Set<number>()
  const queue = (run: () => void) => {
    const frame = requestAnimationFrame(() => {
      frames.delete(frame)
      run()
    })
    frames.add(frame)
  }
  const cancel = () => {
    frames.forEach(cancelAnimationFrame)
    frames.clear()
  }
  const anchor = (id: string) => `message-${id}`
  const clearMessageHash = () => {
    cancel()
    currentMessageID = undefined
    if (!input.route.hash()) return
    input.route.replace("")
  }
  const updateHash = (id: string) => {
    const hash = `#${anchor(id)}`
    if (input.route.hash() === hash) return
    input.route.replace(hash)
  }
  const scrollToElement = (element: HTMLElement, behavior: ScrollBehavior) => {
    const root = input.interaction.scroller()
    if (!root) return false
    const target = element.getBoundingClientRect()
    const viewport = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    root.scrollTo({ top: Math.max(0, target.top - viewport.top + root.scrollTop - inset), behavior })
    return true
  }
  const seek = (id: string, behavior: ScrollBehavior, left = 4, reveal = true): boolean => {
    if (reveal) input.interaction.revealMessage(id)
    const root = input.interaction.scroller()
    const element = root?.ownerDocument.getElementById(anchor(id))
    if (element) {
      const scrolled = scrollToElement(element, behavior)
      // The target virtualizer can finish its centered reveal on the following frame.
      if (left > 0 || root?.querySelector("[data-timeline-settling]"))
        queue(() => seek(id, behavior, Math.max(0, left - 1), false))
      return scrolled
    }
    if (left <= 0) return false
    queue(() => seek(id, behavior, left - 1))
    return false
  }
  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    currentMessageID = message?.id
  }
  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    cancel()
    if (currentMessageID !== message.id) setActiveMessage(message)
    input.interaction.revealMessage(message.id)
    seek(message.id, behavior)
    updateHash(message.id)
  }
  const applyHash = (behavior: ScrollBehavior) => {
    const hash = input.route.hash().slice(1)
    if (!hash) {
      input.interaction.toBottom()
      input.interaction.scheduleScrollState()
      return
    }
    const messageID = messageIDFromHash(hash)
    if (messageID) {
      input.interaction.unpinExplicit()
      const message = messageByID().get(messageID)
      if (message) scrollToMessage(message, behavior)
      return
    }
    const root = input.interaction.scroller()
    const target = root?.ownerDocument.getElementById(hash)
    if (target) {
      input.interaction.unpin()
      scrollToElement(target, behavior)
      return
    }
    input.interaction.toBottom()
    input.interaction.scheduleScrollState()
  }
  const cursor = () => {
    const root = input.interaction.scroller()
    if (!root) return currentMessageID
    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const rows = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((element) => {
        const id = element.dataset.messageId
        if (!id) return
        const rect = element.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)
    const shown = rows.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id
    const near = [...shown].sort((left, right) => {
      const difference = Math.abs(left.top - line) - Math.abs(right.top - line)
      return difference || left.top - right.top
    })[0]
    if (near) return near.id
    return rows.filter((item) => item.top <= line).at(-1)?.id ?? rows[0]?.id ?? currentMessageID
  }
  const navigateMessage = (offset: number) => {
    const messages = visibleUserMessages()
    if (messages.length === 0) return
    const current = currentMessageID && messageMark === scrollMark ? currentMessageID : cursor()
    const base = current ? messages.findIndex((message) => message.id === current) : messages.length
    const target = (base === -1 ? messages.length : base) + offset
    if (target < 0 || target > messages.length) return
    if (target === messages.length) {
      input.interaction.resume()
      return
    }
    input.interaction.unpinExplicit()
    scrollToMessage(messages[target]!, "auto")
  }
  input.interaction.setUserScrollListener(() => {
    scrollMark += 1
  })
  input.interaction.setResumeListener(clearMessageHash)
  createEffect(() => {
    const key = input.sessionKey()
    if (key === ownerSessionKey) return
    ownerSessionKey = key
    currentMessageID = undefined
    scrollMark = 0
    messageMark = 0
  })
  createEffect(() => {
    input.route.hash()
    if (!input.sessionID() || !input.messagesReady()) return
    cancel()
    queue(() => applyHash("auto"))
  })
  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return
    visibleUserMessages()
    const targetID = messageIDFromHash(input.route.hash())
    if (!targetID) return
    const message = messageByID().get(targetID)
    if (!message || (currentMessageID === targetID && messageMark === scrollMark)) return
    input.interaction.unpinExplicit()
    cancel()
    queue(() => scrollToMessage(message, "auto"))
  })
  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return
    visibleUserMessages()
    const targetID = messageIDFromHash(input.route.hash())
    if (!targetID || messageByID().has(targetID) || !input.historyMore() || input.historyLoading()) return
    void input.loadMore()
  })
  onMount(() => {
    if (!("scrollRestoration" in window.history)) return
    scrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"
  })
  onCleanup(() => {
    cancel()
    if (scrollRestoration) window.history.scrollRestoration = scrollRestoration
    input.interaction.setUserScrollListener(() => {})
    input.interaction.setResumeListener(() => {})
  })

  return { applyHash, clearMessageHash, navigateMessage, scrollToMessage }
}
