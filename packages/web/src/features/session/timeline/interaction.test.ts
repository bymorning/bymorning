import { createRoot, createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createTimelineInteraction } from "./interaction"

const roots: Array<() => void> = []

afterEach(() => {
  roots.splice(0).forEach((dispose) => dispose())
})

describe("timeline interaction", () => {
  it("unpins on upward intent and repins only after arriving at the exact bottom", () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 900)
    interaction.setViewportRef(viewport)

    interaction.onWheel(new WheelEvent("wheel", { deltaY: -1 }))
    expect(interaction.pinned()).toBe(false)

    viewport.scrollTop = 899
    interaction.onScroll(scrollEvent(viewport))
    expect(interaction.pinned()).toBe(false)

    viewport.scrollTop = 800
    interaction.onScroll(scrollEvent(viewport))
    viewport.scrollTop = 900
    interaction.onScroll(scrollEvent(viewport))
    expect(interaction.pinned()).toBe(true)
  })

  it("unpins on upward custom scrollbar intent", () => {
    const interaction = setup().interaction
    interaction.setViewportRef(geometry(1_000, 100, 900))

    interaction.onScrollIntent("down")
    expect(interaction.pinned()).toBe(true)

    interaction.onScrollIntent("up")
    expect(interaction.pinned()).toBe(false)
  })

  it("unpins on upward touch and keyboard intent but not downward intent", () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 900)
    interaction.setViewportRef(viewport)

    interaction.onWheel(new WheelEvent("wheel", { deltaY: 1 }))
    expect(interaction.pinned()).toBe(true)

    const start = new Event("touchstart")
    Object.defineProperties(start, { target: { value: viewport }, touches: { value: [{ clientY: 100 }] } })
    interaction.onTouchStart(start as TouchEvent)
    const move = new Event("touchmove")
    Object.defineProperties(move, { target: { value: viewport }, touches: { value: [{ clientY: 120 }] } })
    interaction.onTouchMove(move as TouchEvent)
    expect(interaction.pinned()).toBe(false)

    interaction.pin()
    const key = new KeyboardEvent("keydown", { key: "ArrowUp" })
    Object.defineProperties(key, { target: { value: viewport }, currentTarget: { value: viewport } })
    interaction.onKeyDown(key as KeyboardEvent & { readonly currentTarget: HTMLDivElement })
    expect(interaction.pinned()).toBe(false)
  })

  it("leaves gestures in a nested scrollable with their owner", () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 900)
    const nested = document.createElement("div")
    nested.dataset.scrollable = ""
    viewport.append(nested)
    interaction.setViewportRef(viewport)
    const event = new WheelEvent("wheel", { deltaY: -1 })
    Object.defineProperty(event, "target", { value: nested })

    interaction.onWheel(event)

    expect(interaction.pinned()).toBe(true)
  })

  it("preserves an older-page failure signal and allows a near-top retry", async () => {
    const [messages] = createSignal<readonly []>([])
    const [olderError, setOlderError] = createSignal<string>()
    const loadOlder = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(async () => {
        setOlderError("offline")
        return false
      })
      .mockImplementationOnce(async () => {
        setOlderError(undefined)
        return true
      })
    const interaction = setup({ loadOlder, messages, olderError }).interaction
    const viewport = geometry(1_000, 100, 100)
    interaction.setViewportRef(viewport)
    interaction.onWheel(new WheelEvent("wheel", { deltaY: -1 }))

    interaction.onScroll(scrollEvent(viewport))
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1))
    expect(interaction.olderError()).toBe("offline")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await interaction.loadOlder()).toBe(true)
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2))
    expect(interaction.olderError()).toBeUndefined()
  })

  it("deduplicates explicit older-history retries", async () => {
    const pending = Promise.withResolvers<boolean>()
    const loadOlder = vi.fn(() => pending.promise)
    const interaction = setup({ loadOlder }).interaction

    const first = interaction.loadOlder()
    const second = interaction.loadOlder()

    expect(loadOlder).toHaveBeenCalledTimes(1)
    pending.resolve(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it("loads underfilled history sequentially until history ends", async () => {
    const [more, setMore] = createSignal(true)
    const [messages, setMessages] = createSignal<ReadonlyArray<never>>([])
    const loadOlder = vi.fn(async () => {
      setMessages((current) => [...current, undefined as never])
      if (messages().length === 3) setMore(false)
      return true
    })
    const interaction = setup({ loadOlder, messages, more }).interaction

    interaction.setViewportRef(geometry(100, 100, 0))

    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(3))
  })

  it("revalidates the near-top position before continuing history loading", async () => {
    const [messages, setMessages] = createSignal<ReadonlyArray<never>>([])
    const loadOlder = vi.fn(async () => {
      setMessages([undefined as never])
      return true
    })
    const interaction = setup({ loadOlder, messages }).interaction
    const viewport = geometry(1_000, 100, 100)
    interaction.setViewportRef(viewport)
    interaction.onWheel(new WheelEvent("wheel", { deltaY: -1 }))

    interaction.onScroll(scrollEvent(viewport))
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1))
    viewport.scrollTop = 300
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it("only treats selections owned by the timeline as scroll intent", () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 900)
    const inside = viewport.appendChild(document.createTextNode("inside"))
    const outside = document.body.appendChild(document.createTextNode("outside"))
    const getSelection = vi.spyOn(document, "getSelection")
    interaction.setViewportRef(viewport)

    getSelection.mockReturnValue({ anchorNode: outside, toString: () => "outside" } as unknown as Selection)
    document.dispatchEvent(new Event("selectionchange"))
    expect(interaction.pinned()).toBe(true)

    getSelection.mockReturnValue({ anchorNode: inside, toString: () => "inside" } as unknown as Selection)
    document.dispatchEvent(new Event("selectionchange"))
    expect(interaction.pinned()).toBe(false)
    outside.remove()
  })

  it("keeps following when content shrink arrives during a held pointer", () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 800)
    interaction.setViewportRef(viewport)
    interaction.onWheel(new WheelEvent("wheel", { deltaY: -1 }))
    interaction.onPointerDown(new MouseEvent("pointerdown") as PointerEvent)
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 800 })
    viewport.scrollTop = 700

    interaction.onScroll(scrollEvent(viewport))

    expect(interaction.pinned()).toBe(true)
    window.dispatchEvent(new MouseEvent("pointerup"))
  })

  it("shows jump-to-latest only beyond the larger of 400px and one viewport", async () => {
    const interaction = setup().interaction
    const viewport = geometry(1_101, 100, 600)
    interaction.setViewportRef(viewport)

    await vi.waitFor(() => expect(interaction.jump()).toBe(true))
    viewport.scrollTop = 601
    interaction.onScroll(scrollEvent(viewport))
    await vi.waitFor(() => expect(interaction.jump()).toBe(false))

    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1_301 })
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 600 })
    viewport.scrollTop = 100
    interaction.onScroll(scrollEvent(viewport))
    await vi.waitFor(() => expect(interaction.jump()).toBe(true))
  })

  it("keeps an overlay composer resize stuck when already within its growth delta of the end", async () => {
    const interaction = setup().interaction
    const viewport = geometry(1_000, 100, 895)
    const composer = document.createElement("div")
    const scrollToEnd = vi.fn()
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ height: 24 } as DOMRect)
    interaction.setViewportRef(viewport)
    interaction.onWheel(new WheelEvent("wheel", { deltaY: -1 }))
    interaction.setScrollToEnd(scrollToEnd)

    interaction.setComposerRef(composer)
    await Promise.resolve()

    expect(scrollToEnd).toHaveBeenCalledOnce()
  })

  it("reserves only the part of a grown composer that overlaps the timeline", () => {
    const interaction = setup().interaction
    const composer = document.createElement("div")
    composer.style.marginTop = "-112px"
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ height: 488 } as DOMRect)

    interaction.setComposerRef(composer)

    expect(interaction.composerHeight()).toBe(112)
  })
})

function setup(input?: {
  readonly loadOlder?: () => Promise<boolean>
  readonly messages?: () => ReadonlyArray<never>
  readonly more?: () => boolean
  readonly olderError?: () => string | undefined
}) {
  let interaction!: ReturnType<typeof createTimelineInteraction>
  const dispose = createRoot((dispose) => {
    interaction = createTimelineInteraction({
      history: {
        ready: () => true,
        messages: input?.messages ?? (() => []),
        more: input?.more ?? (() => true),
        loading: () => false,
        olderError: input?.olderError ?? (() => undefined),
        loadOlder: input?.loadOlder ?? (() => Promise.resolve(true)),
      },
    })
    return dispose
  })
  roots.push(dispose)
  return { interaction }
}

function geometry(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const viewport = document.createElement("div")
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  })
  return viewport
}

function scrollEvent(viewport: HTMLDivElement) {
  const event = new Event("scroll")
  Object.defineProperty(event, "currentTarget", { value: viewport })
  return event as Event & { readonly currentTarget: HTMLDivElement }
}
