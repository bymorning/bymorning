import { configure } from "@solidjs/testing-library"
import type {} from "vitest/jsdom"

// findBy/waitFor default to 1 s, which a loaded two-vCPU CI runner occasionally exceeds in long interaction tests.
// A passing wait returns immediately; only a genuinely stuck one costs the full time.
configure({ asyncUtilTimeout: 5_000 })

Object.defineProperties(globalThis, {
  localStorage: Object.getOwnPropertyDescriptor(jsdom.window, "localStorage")!,
})

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: class implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  },
})

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }),
})

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  writable: true,
  value() {},
})

// jsdom lacks the Web Animations API; toast.tsx calls element.animate in pulseToast.
Object.defineProperty(Element.prototype, "animate", {
  configurable: true,
  writable: true,
  value: () => ({
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
    onfinish: null,
  }),
})
