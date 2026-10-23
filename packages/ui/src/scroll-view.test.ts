import { describe, expect, it, vi } from "vitest"
import { render } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"

import { ScrollView } from "@bymorning/ui/scroll-view"
import { canScrollKey, scrollKey, scrollTopFromThumbPointer } from "./scroll-view"

describe("ScrollView", () => {
  it("owns its sizing and viewport containment while preserving root attributes", () => {
    const root = render(() =>
      ScrollView({
        class: "consumer-scroll",
        fill: true,
        containOverscroll: true,
      }),
    ).container.querySelector('[data-component="scroll-view"]')!

    expect(root).toHaveAttribute("data-fill")
    expect(root).toHaveClass("consumer-scroll")
    expect(root.querySelector('[data-slot="scroll-view-viewport"]')).toHaveAttribute("data-contain-overscroll")
  })

  it("reports keyboard scrolling as user intent", () => {
    const intent = vi.fn()
    const viewport = render(() => ScrollView({ onScrollIntent: intent })).container.querySelector<HTMLElement>(
      '[data-slot="scroll-view-viewport"]',
    )!
    Object.defineProperties(viewport, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
      scrollBy: { value: vi.fn() },
    })

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))

    expect(intent).toHaveBeenCalledWith("down")
  })

  it("reports upward custom thumb dragging as user intent", () => {
    const intent = vi.fn()
    const view = render(() =>
      ScrollView({
        onScrollIntent: intent,
        viewportRef: (element) => {
          Object.defineProperties(element, {
            clientHeight: { value: 100 },
            scrollHeight: { value: 1_000 },
            scrollTop: { value: 900, writable: true },
          })
          element.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
        },
      }),
    )
    const thumb = view.container.querySelector<HTMLElement>('[data-component="scroll-view-thumb"]')!
    thumb.getBoundingClientRect = () => ({ top: 60 }) as DOMRect
    thumb.setPointerCapture = vi.fn()
    thumb.releasePointerCapture = vi.fn()

    thumb.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 70 }))
    thumb.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 30 }))
    thumb.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))

    expect(intent).toHaveBeenCalledWith("up")
  })
})

describe("scrollKey", () => {
  it.each([
    ["PageDown", false, "page-down"],
    ["PageUp", false, "page-up"],
    ["Home", false, "home"],
    ["End", false, "end"],
    ["ArrowUp", false, "up"],
    ["ArrowDown", false, "down"],
    [" ", false, "page-down"],
    [" ", true, "page-up"],
  ])("maps %s with shift=%s to %s", (key, shiftKey, expected) => {
    expect(scrollKey({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey })).toBe(expected)
  })

  it.each([
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, true],
  ])("ignores modified navigation keys", (altKey, ctrlKey, metaKey, shiftKey) => {
    expect(scrollKey({ key: "ArrowDown", altKey, ctrlKey, metaKey, shiftKey })).toBeUndefined()
  })

  it("ignores unrelated keys", () => {
    expect(scrollKey({ key: "Enter", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBeUndefined()
  })
})

describe("canScrollKey", () => {
  const element = (scrollTop: number, clientHeight = 100, scrollHeight = 300) =>
    ({ scrollTop, clientHeight, scrollHeight }) as HTMLElement

  it.each(["up", "page-up", "home"] as const)("owns %s only above the top boundary", (key) => {
    expect(canScrollKey(element(50), key)).toBe(true)
    expect(canScrollKey(element(0), key)).toBe(false)
  })

  it.each(["down", "page-down", "end"] as const)("owns %s only before the bottom boundary", (key) => {
    expect(canScrollKey(element(50), key)).toBe(true)
    expect(canScrollKey(element(200), key)).toBe(false)
    expect(canScrollKey(element(0, 100, 100), key)).toBe(false)
  })
})

describe("scrollTopFromThumbPointer", () => {
  it("keeps downward thumb movement monotonic when content height changes", () => {
    const first = scrollTopFromThumbPointer({
      pointer: 300,
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 6_000,
      thumbHeight: 60,
    })
    const second = scrollTopFromThumbPointer({
      pointer: 320,
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 60_000,
      thumbHeight: 32,
    })

    expect(second).toBeGreaterThan(first)
  })

  it("clamps pointer positions to the scroll range", () => {
    const input = {
      viewportTop: 100,
      grabOffset: 12,
      clientHeight: 600,
      scrollHeight: 6_000,
      thumbHeight: 60,
    }
    expect(scrollTopFromThumbPointer({ ...input, pointer: 0 })).toBe(0)
    expect(scrollTopFromThumbPointer({ ...input, pointer: 1_000 })).toBe(5_400)
  })

  it("uses the viewport height when the thumb has an external track", () => {
    // The 8px track insets leave 344px of travel; this pointer places the thumb 292px into it.
    expect(
      scrollTopFromThumbPointer({
        pointer: 400,
        viewportTop: 100,
        grabOffset: 0,
        clientHeight: 400,
        scrollClientHeight: 800,
        scrollHeight: 8_000,
        thumbHeight: 40,
      }),
    ).toBeCloseTo((292 / 344) * 7_200)
  })
})
