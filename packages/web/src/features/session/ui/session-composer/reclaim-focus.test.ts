import { afterEach, expect, it, vi } from "vitest"

import { autofocus, reclaimFocus } from "./reclaim-focus"

afterEach(() => {
  document.body.innerHTML = ""
  vi.useRealTimers()
})

it("reclaims focus from the page body and from inside the composer, not from elsewhere", () => {
  document.body.innerHTML = `<form data-component="session-composer"><button id="in"></button></form><button id="out"></button>`
  const focus = vi.fn()
  reclaimFocus(focus)
  expect(focus).toHaveBeenCalledTimes(1)
  document.getElementById("in")!.focus()
  reclaimFocus(focus)
  expect(focus).toHaveBeenCalledTimes(2)
  document.getElementById("out")!.focus()
  reclaimFocus(focus)
  expect(focus).toHaveBeenCalledTimes(2)
})

it("autofocus fires after the delay unless the user interacted or it was cancelled", () => {
  vi.useFakeTimers()
  const focus = vi.fn()
  autofocus(focus, 100)
  vi.advanceTimersByTime(100)
  expect(focus).toHaveBeenCalledTimes(1)

  autofocus(focus, 100)
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
  vi.advanceTimersByTime(100)
  expect(focus).toHaveBeenCalledTimes(1)

  autofocus(focus, 100)()
  vi.advanceTimersByTime(100)
  expect(focus).toHaveBeenCalledTimes(1)
})
