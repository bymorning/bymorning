import { createEffect, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

import type { SessionListGroup } from "./session-list-model"

const SESSION_LIST_HEADER_STICKY_TOP = 60
const SESSION_LIST_HEADER_TEXT_HEIGHT = 16
const SESSION_LIST_HEADER_FADE_DISTANCE = 16

export function createSessionListScrollController(groups: Accessor<ReadonlyArray<SessionListGroup>>) {
  const [state, setState] = createStore({ titleOpacity: {} as Partial<Record<string, number>> })
  const headerRefs = new Map<string, HTMLDivElement>()
  const headerOffsets = new Map<string, number>()
  let viewport: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let positionFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let stickyTop = SESSION_LIST_HEADER_STICKY_TOP

  createEffect(() => {
    const items = groups()
    const ids = new Set(items.map((group) => group.id))
    headerRefs.forEach((_, id) => {
      if (!ids.has(id)) headerRefs.delete(id)
    })
    headerOffsets.forEach((_, id) => {
      if (!ids.has(id)) headerOffsets.delete(id)
    })
    if (items.length === 0) {
      content = undefined
      bindResizeObserver()
    }
    queuePositionUpdate()
  })

  onCleanup(() => {
    if (positionFrame !== undefined) cancelAnimationFrame(positionFrame)
    resizeObserver?.disconnect()
  })

  function queuePositionUpdate() {
    if (typeof requestAnimationFrame === "undefined") {
      updatePositionCache()
      return
    }
    if (positionFrame !== undefined) return
    positionFrame = requestAnimationFrame(() => {
      positionFrame = undefined
      updatePositionCache()
    })
  }

  function updatePositionCache() {
    if (!viewport) return
    const header = groups()
      .map((group) => headerRefs.get(group.id))
      .find((element) => element !== undefined)
    if (header && typeof getComputedStyle === "function") {
      const top = Number.parseFloat(getComputedStyle(header).top)
      if (Number.isFinite(top)) stickyTop = top
    }
    // `offsetTop` is relative to the header's offset parent, which is not the scroll viewport when
    // content (the Overview onboarding) sits above the list; measure against the viewport instead.
    const origin = viewport.getBoundingClientRect().top - viewport.scrollTop
    groups().forEach((group) => {
      const element = headerRefs.get(group.id)
      if (element) headerOffsets.set(group.id, element.getBoundingClientRect().top - origin)
    })
    update(viewport.scrollTop)
  }

  function update(scrollTop: number) {
    const items = groups()
    items.forEach((group, index) => {
      const nextOffset = items
        .slice(index + 1)
        .map((item) => headerOffsets.get(item.id))
        .find((offset) => offset !== undefined)
      const fadeEnd = stickyTop + SESSION_LIST_HEADER_TEXT_HEIGHT
      const nextTop = nextOffset === undefined ? undefined : nextOffset - scrollTop
      const opacity =
        nextTop === undefined ? 1 : Math.max(0, Math.min(1, (nextTop - fadeEnd) / SESSION_LIST_HEADER_FADE_DISTANCE))
      setState("titleOpacity", group.id, Math.round(opacity * 1000) / 1000)
    })
  }

  function bindResizeObserver() {
    resizeObserver?.disconnect()
    if (typeof ResizeObserver === "undefined") return
    resizeObserver = new ResizeObserver(queuePositionUpdate)
    if (viewport) resizeObserver.observe(viewport)
    if (content) resizeObserver.observe(content)
  }

  function containWheel(event: WheelEvent) {
    if (!viewport || event.defaultPrevented || event.ctrlKey || !event.deltaY) return
    if (!(event.target instanceof Element)) return
    const scrollable = event.target.closest<HTMLElement>("[data-scrollable]")
    if (
      scrollable !== viewport &&
      scrollable &&
      (event.deltaY < 0
        ? scrollable.scrollTop > 0
        : scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight)
    )
      return
    event.preventDefault()
  }

  return {
    viewport: {
      setViewport: (element: HTMLDivElement) => {
        viewport = element
        bindResizeObserver()
        queuePositionUpdate()
      },
      update,
      containWheel,
      containOuterWheel: (event: WheelEvent) => {
        if (!viewport) return
        if (event.target instanceof Node && viewport.contains(event.target)) return
        containWheel(event)
      },
    },
    header: {
      setContent: (element: HTMLDivElement) => {
        content = element
        bindResizeObserver()
        queuePositionUpdate()
      },
      setHeader: (id: string, element: HTMLDivElement) => {
        headerRefs.set(id, element)
        queuePositionUpdate()
      },
      titleOpacity: (id: string) => state.titleOpacity[id] ?? 1,
    },
  }
}

export type SessionListScrollController = ReturnType<typeof createSessionListScrollController>
