import { createRoot } from "solid-js"
import { describe, expect, it } from "vitest"

import { createSessionListScrollController } from "./session-list-scroll-controller"

const rect = (top: number) => ({ top }) as DOMRect

describe("createSessionListScrollController", () => {
  it("keeps the first group title visible when the list sits below other scrolled content", async () => {
    await createRoot(async (dispose) => {
      const groups = [
        { id: "today", title: "Today", items: [] },
        { id: "yesterday", title: "Yesterday", items: [] },
      ]
      const scroll = createSessionListScrollController(() => groups)
      // The viewport is scrolled 600px and the headers' offset parent is not the viewport.
      const viewport = document.createElement("div")
      viewport.scrollTop = 600
      viewport.getBoundingClientRect = () => rect(100)
      const today = document.createElement("div")
      today.getBoundingClientRect = () => rect(160)
      const yesterday = document.createElement("div")
      yesterday.getBoundingClientRect = () => rect(560)
      Object.defineProperty(yesterday, "offsetTop", { value: 40 })
      scroll.header.setHeader("today", today)
      scroll.header.setHeader("yesterday", yesterday)
      scroll.viewport.setViewport(viewport)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(scroll.header.titleOpacity("today")).toBe(1)
      dispose()
    })
  })
})
