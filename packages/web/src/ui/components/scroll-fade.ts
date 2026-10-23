import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import "./scroll-fade.css"

export type ScrollFadeAxis = "x" | "y"

export type ScrollFadeState = { readonly above: boolean; readonly below: boolean }

/**
 * Whether a scroll region has more content before (above / left) or after
 * (below / right) the visible window. Sub-pixel rounding is ignored.
 */
export function measureScrollFade(element: HTMLElement, axis: ScrollFadeAxis): ScrollFadeState {
  const offset = axis === "y" ? element.scrollTop : Math.abs(element.scrollLeft)
  const extent = axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
  return { above: offset > 1, below: extent - offset > 1 }
}

/**
 * Tracks whether a clipped scroll region has more content before or after it, so CSS can fade that edge.
 * Put `data-scroll-fade` (plus `data-fade-axis="x"` for horizontal regions) and the `data-fade-above` /
 * `data-fade-below` attributes on a non-scrolling wrapper, and `ref`/`onScroll` on the scroller inside it.
 */
export function createScrollFade(options: { readonly axis?: ScrollFadeAxis } = {}) {
  const axis = options.axis ?? "y"
  const [fade, setFade] = createStore<{ above: boolean; below: boolean }>({ above: false, below: false })
  let element: HTMLElement | undefined

  const measure = () => {
    if (!element) return
    setFade(measureScrollFade(element, axis))
  }

  onMount(() => {
    measure()
    if (typeof ResizeObserver === "undefined" || !element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    onCleanup(() => observer.disconnect())
  })
  // The element is owned by the caller's template, so release it with the component.
  onCleanup(() => {
    element = undefined
  })

  return {
    ref: (value: HTMLElement) => {
      element = value
    },
    onScroll: measure,
    above: () => fade.above,
    below: () => fade.below,
  }
}
