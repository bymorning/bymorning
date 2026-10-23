import { createSignal, onCleanup } from "solid-js"

import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "../../../ui/scroll-view"
const endEpsilon = 0.5
const upwardKeys = new Set(["up", "page-up", "home"])

interface TimelineHistoryInteraction {
  readonly ready: () => boolean
  readonly messages: () => ReadonlyArray<unknown>
  readonly more: () => boolean
  readonly loading: () => boolean
  readonly olderError: () => string | undefined
  readonly loadOlder: () => Promise<boolean>
}

export function createTimelineInteraction(input: { readonly history: TimelineHistoryInteraction }) {
  const [pinned, setPinned] = createSignal(true)
  const [overflow, setOverflow] = createSignal(false)
  const [jump, setJump] = createSignal(false)
  const [composerHeight, setComposerHeight] = createSignal(0)
  let viewport: HTMLDivElement | undefined
  let contentObserver: ResizeObserver | undefined
  let composerObserver: ResizeObserver | undefined
  let pointerHeld = false
  let explicitNavigation = false
  let touchStart: number | undefined
  let scrollTop = 0
  let maxScroll = 0
  let stateFrame: number | undefined
  let fillFrame: number | undefined
  let continuationFrame: number | undefined
  let composerFollowFrame: number | undefined
  let loadPending: Promise<boolean> | undefined
  let scrollToEnd = () => {}
  let revealMessage = (_id: string) => {}
  let userScrollListener = () => {}
  let resumeListener = () => {}
  let selectionDocument: Document | undefined
  let releasePointer: (() => void) | undefined

  const ownsGesture = (target: EventTarget | null) => {
    const owner = target instanceof Element ? target.closest("[data-scrollable]") : undefined
    return !owner || owner === viewport
  }
  const updateScrollState = () => {
    if (!viewport) return
    const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const distance = maximum - viewport.scrollTop
    setOverflow(maximum > 1)
    setJump(maximum > 1 && distance > Math.max(400, viewport.clientHeight))
  }
  const scheduleScrollState = () => {
    if (stateFrame !== undefined) return
    stateFrame = requestAnimationFrame(() => {
      stateFrame = undefined
      updateScrollState()
    })
  }
  const scheduleFill = () => {
    if (fillFrame !== undefined) return
    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined
      if (!viewport || !pinned() || !input.history.ready() || input.history.loading() || !input.history.more()) return
      if (viewport.scrollHeight > viewport.clientHeight + 1) return
      void loadOlder()
    })
  }
  async function loadOlder(): Promise<boolean> {
    if (loadPending) return loadPending
    if (input.history.loading() || !input.history.more()) return false
    const before = input.history.messages().length
    loadPending = input.history.loadOlder()
    const loaded = await loadPending
    loadPending = undefined
    scheduleScrollState()
    if (input.history.messages().length <= before) return loaded
    if (pinned()) {
      scheduleFill()
      return loaded
    }
    if (!viewport || viewport.scrollTop >= 200 || !input.history.more()) return loaded
    if (continuationFrame !== undefined) cancelAnimationFrame(continuationFrame)
    continuationFrame = requestAnimationFrame(() => {
      continuationFrame = undefined
      if (pinned() || !viewport || viewport.scrollTop >= 200 || !input.history.more()) return
      void loadOlder()
    })
    return loaded
  }
  const unpin = () => {
    if (!viewport || viewport.scrollHeight - viewport.clientHeight <= 1) return
    setPinned(false)
  }
  const onSelectionInteraction = () => {
    const selection = selectionDocument?.getSelection()
    if (!selection?.toString() || !viewport || !selection.anchorNode || !viewport.contains(selection.anchorNode)) return
    unpin()
  }
  const setViewportRef = (element: HTMLDivElement | undefined) => {
    if (selectionDocument) selectionDocument.removeEventListener("selectionchange", onSelectionInteraction)
    viewport = element
    selectionDocument = element?.ownerDocument
    if (selectionDocument) selectionDocument.addEventListener("selectionchange", onSelectionInteraction)
    if (!element) return
    element.style.overflowAnchor = "none"
    scrollTop = element.scrollTop
    maxScroll = element.scrollHeight - element.clientHeight
    scheduleScrollState()
    scheduleFill()
  }
  const setContentRef = (element: HTMLDivElement | undefined) => {
    contentObserver?.disconnect()
    if (!element || typeof ResizeObserver === "undefined") return
    contentObserver = new ResizeObserver(() => {
      scheduleScrollState()
      scheduleFill()
    })
    contentObserver.observe(element)
  }
  const setComposerRef = (element: HTMLElement | undefined) => {
    composerObserver?.disconnect()
    if (!element) {
      setComposerHeight(0)
      return
    }
    // The composer overlaps the timeline only by its negative top margin; the rest of it
    // shrinks the timeline viewport. Reserving its full height would push short transcripts
    // out of view whenever the composer grows, such as while a Form is open.
    const overlap = () => {
      const margin = -parseFloat(getComputedStyle(element).marginTop)
      return Number.isFinite(margin) ? Math.max(0, margin) : Number.POSITIVE_INFINITY
    }
    // Growth beyond the overlap still shrinks the viewport, so following the end tracks the full height.
    let measured = 0
    const update = (height: number) => {
      const next = Math.ceil(height)
      if (next === measured) return
      const delta = next - measured
      measured = next
      const stick = viewport
        ? pinned() || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 10 + Math.max(0, delta)
        : false
      setComposerHeight(Math.ceil(Math.min(height, overlap())))
      if (stick)
        queueMicrotask(() => {
          scrollToEnd()
          if (composerFollowFrame !== undefined) cancelAnimationFrame(composerFollowFrame)
          composerFollowFrame = requestAnimationFrame(() => {
            composerFollowFrame = undefined
            if (pinned()) scrollToEnd()
          })
        })
      scheduleScrollState()
      scheduleFill()
    }
    update(element.getBoundingClientRect().height)
    if (typeof ResizeObserver === "undefined") return
    composerObserver = new ResizeObserver(([entry]) =>
      update(entry?.contentRect.height ?? element.getBoundingClientRect().height),
    )
    composerObserver.observe(element)
  }

  onCleanup(() => {
    if (stateFrame !== undefined) cancelAnimationFrame(stateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
    if (continuationFrame !== undefined) cancelAnimationFrame(continuationFrame)
    if (composerFollowFrame !== undefined) cancelAnimationFrame(composerFollowFrame)
    contentObserver?.disconnect()
    composerObserver?.disconnect()
    selectionDocument?.removeEventListener("selectionchange", onSelectionInteraction)
    releasePointer?.()
    viewport = undefined
  })

  return {
    pinned,
    overflow,
    jump,
    composerHeight,
    loading: input.history.loading,
    olderError: input.history.olderError,
    pin: () => {
      if (!explicitNavigation) setPinned(true)
    },
    unpin,
    unpinExplicit: () => {
      explicitNavigation = true
      setPinned(false)
    },
    resume: () => {
      explicitNavigation = false
      setPinned(true)
      scrollToEnd()
      resumeListener()
    },
    toBottom: () => {
      explicitNavigation = false
      setPinned(true)
      scrollToEnd()
    },
    scroller: () => viewport,
    setViewportRef,
    setContentRef,
    setComposerRef,
    setScrollToEnd: (scroll: () => void) => {
      scrollToEnd = scroll
    },
    revealMessage: (id: string) => revealMessage(id),
    setRevealMessage: (reveal: (id: string) => void) => {
      revealMessage = reveal
    },
    setUserScrollListener: (listener: () => void) => {
      userScrollListener = listener
    },
    setResumeListener: (listener: () => void) => {
      resumeListener = listener
    },
    scheduleScrollState,
    loadOlder,
    onScrollIntent: (direction: "up" | "down") => {
      explicitNavigation = false
      userScrollListener()
      if (direction === "up") unpin()
    },
    onWheel: (event: WheelEvent) => {
      if (!ownsGesture(event.target)) return
      explicitNavigation = false
      userScrollListener()
      if (event.deltaY < 0) unpin()
    },
    onTouchStart: (event: TouchEvent) => {
      if (!ownsGesture(event.target)) return
      explicitNavigation = false
      userScrollListener()
      touchStart = event.touches[0]?.clientY
    },
    onTouchMove: (event: TouchEvent) => {
      if (!ownsGesture(event.target)) return
      explicitNavigation = false
      const current = event.touches[0]?.clientY
      if (current === undefined || touchStart === undefined || current <= touchStart) return
      touchStart = current
      unpin()
    },
    onPointerDown: (event: PointerEvent) => {
      if (!ownsGesture(event.target)) return
      explicitNavigation = false
      userScrollListener()
      pointerHeld = true
      releasePointer?.()
      const release = () => {
        pointerHeld = false
        window.removeEventListener("pointerup", release)
        window.removeEventListener("pointercancel", release)
        if (releasePointer === release) releasePointer = undefined
      }
      releasePointer = release
      window.addEventListener("pointerup", release)
      window.addEventListener("pointercancel", release)
    },
    onKeyDown: (event: KeyboardEvent & { readonly currentTarget: HTMLDivElement }) => {
      const key = scrollKey(event)
      if (
        !key ||
        !isScrollKeyTarget(event.target, key) ||
        scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget
      )
        return
      explicitNavigation = false
      userScrollListener()
      if (upwardKeys.has(key)) unpin()
    },
    onScroll: (event: Event & { readonly currentTarget: HTMLDivElement }) => {
      const root = event.currentTarget
      const previousTop = scrollTop
      const previousMax = maxScroll
      scrollTop = root.scrollTop
      maxScroll = root.scrollHeight - root.clientHeight
      const atEnd = maxScroll - scrollTop <= endEpsilon
      const arrived = scrollTop > previousTop + endEpsilon || maxScroll < previousMax
      if (!explicitNavigation && (maxScroll <= 1 || (atEnd && arrived))) setPinned(true)
      else if (pointerHeld && scrollTop < previousTop - endEpsilon) unpin()
      scheduleScrollState()
      if (!pinned() && root.scrollTop < 200) void loadOlder()
    },
    onSelectionInteraction,
    notifyContentChange: () => {
      scheduleScrollState()
      scheduleFill()
    },
  }
}

export type TimelineInteraction = ReturnType<typeof createTimelineInteraction>
