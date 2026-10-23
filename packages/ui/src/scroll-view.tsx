import { createEffect, mergeProps, onCleanup, onMount, Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"

import "./scroll-view.css"

export type ScrollViewThumbVisibility = "hover" | "scroll"
export type ScrollViewScrollIntent = "up" | "down"

export interface ScrollViewProps extends ComponentProps<"div"> {
  readonly viewportRef?: (element: HTMLDivElement) => void
  readonly thumbVisibility?: ScrollViewThumbVisibility
  readonly thumbContainer?: HTMLElement
  readonly thumbHoverTarget?: HTMLElement
  readonly fill?: boolean
  readonly containOverscroll?: boolean
  readonly onScrollIntent?: (direction: ScrollViewScrollIntent) => void
}

type ScrollDirection = "page-down" | "page-up" | "home" | "end" | "up" | "down"

export const scrollKey = (
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): ScrollDirection | undefined => {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined
  if (event.shiftKey && event.key !== " ") return undefined

  switch (event.key) {
    case "PageDown":
      return "page-down"
    case "PageUp":
      return "page-up"
    case "Home":
      return "home"
    case "End":
      return "end"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case " ":
      return event.shiftKey ? "page-up" : "page-down"
  }
  return undefined
}

export function canScrollKey(element: HTMLElement, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const up = key === "up" || key === "page-up" || key === "home"
  return up ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight
}

export function scrollKeyOwner(
  root: HTMLElement,
  target: EventTarget | null,
  key: NonNullable<ReturnType<typeof scrollKey>>,
) {
  const element = target instanceof Element ? target : undefined
  const owner = element?.closest<HTMLElement>("[data-scrollable]")
  if (!owner || owner === root) return root
  if (!root.contains(owner)) return owner
  return canScrollKey(owner, key) ? owner : root
}

export function isScrollKeyTarget(target: EventTarget | null, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const element = target instanceof HTMLElement ? target : undefined
  if (!element) return true
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.isContentEditable) return false
  if ((key === "page-up" || key === "page-down") && element.closest('button, a[href], [role="button"]')) return false
  return true
}

export function scrollTopFromThumbPointer(input: {
  readonly pointer: number
  readonly viewportTop: number
  readonly grabOffset: number
  readonly clientHeight: number
  readonly scrollHeight: number
  readonly thumbHeight: number
  readonly scrollClientHeight?: number
}) {
  const maxThumbTop = input.clientHeight - 16 - input.thumbHeight
  if (maxThumbTop <= 0) return 0
  const thumbTop = Math.max(0, Math.min(input.pointer - input.viewportTop - 8 - input.grabOffset, maxThumbTop))
  return (thumbTop / maxThumbTop) * Math.max(0, input.scrollHeight - (input.scrollClientHeight ?? input.clientHeight))
}

export function ScrollView(props: ScrollViewProps) {
  const merged = mergeProps({ thumbVisibility: "hover" as const }, props)
  const [local, events, rest] = splitProps(
    merged,
    [
      "class",
      "classList",
      "children",
      "viewportRef",
      "thumbVisibility",
      "thumbContainer",
      "thumbHoverTarget",
      "fill",
      "containOverscroll",
      "onScrollIntent",
      "style",
      "role",
      "aria-label",
      "tabIndex",
    ],
    [
      "onScroll",
      "onWheel",
      "onTouchStart",
      "onTouchMove",
      "onTouchEnd",
      "onTouchCancel",
      "onPointerDown",
      "onClick",
      "onKeyDown",
    ],
  )

  let viewport!: HTMLDivElement
  let thumb!: HTMLDivElement
  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined
  const thumbMount = () => local.thumbContainer
  const thumbHover = () => local.thumbHoverTarget
  const hoverRoot = () => !local.thumbHoverTarget && !local.thumbContainer
  const [state, setState] = createStore({
    isHovered: false,
    isDragging: false,
    isScrolling: false,
    thumbHeight: 0,
    thumbTop: 0,
    showThumb: false,
  })
  const markScrolling = () => {
    setState("isScrolling", true)
    if (scrollIdleTimer !== undefined) clearTimeout(scrollIdleTimer)
    scrollIdleTimer = setTimeout(() => setState("isScrolling", false), 800)
  }
  const thumbVisible = () => {
    if (state.isDragging || state.isScrolling) return true
    return local.thumbVisibility === "hover" && state.isHovered
  }
  const updateThumb = () => {
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    if (scrollHeight <= clientHeight || scrollHeight === 0) {
      setState("showThumb", false)
      return
    }

    const trackHeight = (thumbMount()?.clientHeight || clientHeight) - 16
    const height = Math.max((clientHeight / scrollHeight) * trackHeight, 32)
    const maxThumbTop = trackHeight - height
    const top = (scrollTop / (scrollHeight - clientHeight)) * maxThumbTop
    setState({
      showThumb: true,
      thumbHeight: height,
      thumbTop: 8 + Math.max(0, Math.min(top, maxThumbTop)),
    })
  }

  onCleanup(() => {
    if (scrollIdleTimer !== undefined) clearTimeout(scrollIdleTimer)
  })

  onMount(() => {
    local.viewportRef?.(viewport)
    createResizeObserver(() => [viewport, viewport.firstElementChild, thumbMount()], updateThumb)
    updateThumb()
  })

  createEffect(() => {
    thumbMount()
    updateThumb()
  })

  createEffect(() => {
    const target = thumbHover()
    if (!target) return

    const enter = () => setState("isHovered", true)
    const leave = () => setState("isHovered", false)
    target.addEventListener("pointerenter", enter)
    target.addEventListener("pointerleave", leave)
    onCleanup(() => {
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
      setState("isHovered", false)
    })
  })

  const onThumbPointerDown = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setState("isDragging", true)
    const grabOffset = event.clientY - thumb.getBoundingClientRect().top
    const track = thumbMount() ?? viewport
    thumb.setPointerCapture(event.pointerId)

    const onPointerMove = (event: PointerEvent) => {
      const next = scrollTopFromThumbPointer({
        pointer: event.clientY,
        viewportTop: track.getBoundingClientRect().top,
        grabOffset,
        clientHeight: track.clientHeight,
        scrollClientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        thumbHeight: state.thumbHeight,
      })
      if (next !== viewport.scrollTop) local.onScrollIntent?.(next < viewport.scrollTop ? "up" : "down")
      viewport.scrollTop = next
    }
    const done = (event: PointerEvent) => {
      setState("isDragging", false)
      thumb.releasePointerCapture(event.pointerId)
      thumb.removeEventListener("pointermove", onPointerMove)
      thumb.removeEventListener("pointerup", done)
      thumb.removeEventListener("pointercancel", done)
    }
    thumb.addEventListener("pointermove", onPointerMove)
    thumb.addEventListener("pointerup", done)
    thumb.addEventListener("pointercancel", done)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const next = scrollKey(event)
    if (!next || !isScrollKeyTarget(event.target, next) || scrollKeyOwner(viewport, event.target, next) !== viewport)
      return

    local.onScrollIntent?.(next === "up" || next === "page-up" || next === "home" ? "up" : "down")
    const page = viewport.clientHeight * 0.8
    switch (next) {
      case "page-down":
        event.preventDefault()
        viewport.scrollBy({ top: page, behavior: "smooth" })
        return
      case "page-up":
        event.preventDefault()
        viewport.scrollBy({ top: -page, behavior: "smooth" })
        return
      case "home":
        event.preventDefault()
        viewport.scrollTo({ top: 0, behavior: "smooth" })
        return
      case "end":
        event.preventDefault()
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
        return
      case "up":
        event.preventDefault()
        viewport.scrollBy({ top: -40, behavior: "smooth" })
        return
      case "down":
        event.preventDefault()
        viewport.scrollBy({ top: 40, behavior: "smooth" })
    }
  }
  const renderThumb = () => (
    <div
      ref={(element) => (thumb = element)}
      data-component="scroll-view-thumb"
      data-slot="scroll-view-thumb"
      data-visible={thumbVisible()}
      data-dragging={state.isDragging}
      style={{ height: `${state.thumbHeight}px`, transform: `translateY(${state.thumbTop}px)` }}
      onPointerDown={onThumbPointerDown}
    />
  )

  return (
    <div
      {...rest}
      data-component="scroll-view"
      data-fill={local.fill ? "" : undefined}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
      style={local.style}
      onPointerEnter={() => {
        if (hoverRoot()) setState("isHovered", true)
      }}
      onPointerLeave={() => {
        if (hoverRoot()) setState("isHovered", false)
      }}
    >
      <div
        ref={(element) => (viewport = element)}
        data-slot="scroll-view-viewport"
        data-scrollable
        data-contain-overscroll={local.containOverscroll ? "" : undefined}
        role={local.role ?? "region"}
        aria-label={local["aria-label"] ?? "Scrollable content"}
        tabIndex={local.tabIndex ?? 0}
        onScroll={(event) => {
          updateThumb()
          markScrolling()
          callEventHandler(events.onScroll, event)
        }}
        onWheel={(event) => {
          markScrolling()
          callEventHandler(events.onWheel, event)
        }}
        onTouchStart={(event) => callEventHandler(events.onTouchStart, event)}
        onTouchMove={(event) => callEventHandler(events.onTouchMove, event)}
        onTouchEnd={(event) => callEventHandler(events.onTouchEnd, event)}
        onTouchCancel={(event) => callEventHandler(events.onTouchCancel, event)}
        onPointerDown={(event) => callEventHandler(events.onPointerDown, event)}
        onClick={(event) => callEventHandler(events.onClick, event)}
        onKeyDown={(event) => {
          onKeyDown(event)
          callEventHandler(events.onKeyDown, event)
        }}
      >
        {local.children}
      </div>
      <Show when={state.showThumb}>
        <Show when={thumbMount()} fallback={renderThumb()}>
          {(mount) => <Portal mount={mount()}>{renderThumb()}</Portal>}
        </Show>
      </Show>
    </div>
  )
}

function callEventHandler<E extends Event>(
  handler: JSX.EventHandlerUnion<HTMLDivElement, E> | undefined,
  event: E & { readonly currentTarget: HTMLDivElement; readonly target: Element },
) {
  if (!handler) return
  if (typeof handler === "function") {
    handler(event)
    return
  }
  handler[0](handler[1], event)
}
