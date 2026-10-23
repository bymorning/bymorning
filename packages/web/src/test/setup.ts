import type {} from "vitest/jsdom"

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
