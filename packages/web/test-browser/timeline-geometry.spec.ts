import { expect, test, type Locator, type Page } from "@playwright/test"
import { Virtualizer } from "@tanstack/solid-virtual"

declare global {
  interface Window {
    timelineRevealObserved?: boolean
  }
}

const viewport = (page: Page) => page.locator('[data-slot="scroll-view-viewport"]')
const bottomDistance = (scroller: Locator) =>
  scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)

async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

async function settleGeometry(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')
    if (!element) return false
    return new Promise<boolean>((resolve) => {
      const geometry = () =>
        [
          element.scrollTop,
          element.scrollHeight,
          element.clientHeight,
          ...[...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].flatMap((row) => {
            const rect = row.getBoundingClientRect()
            return [row.dataset.timelineKey, rect.top, rect.bottom]
          }),
        ].join(":")
      let previous = geometry()
      let stable = 0
      const sample = () => {
        const current = geometry()
        stable = current === previous ? stable + 1 : 0
        previous = current
        if (stable >= 4) return resolve(true)
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
}

async function wheelUntil(page: Page, condition: () => Promise<boolean>, delta: number, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await condition()) return
    await page.mouse.wheel(0, delta)
    await settle(page)
  }
  expect(await condition()).toBe(true)
}

async function open(page: Page, scenario = "large", theme: "light" | "dark" = "light") {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`/test-browser/timeline-harness.html?scenario=${scenario}&theme=${theme}`)
  await page.waitForFunction(() => window.timelineHarness !== undefined)
  await expect(viewport(page)).toBeVisible()
  await expect.poll(() => bottomDistance(viewport(page))).toBeLessThanOrEqual(1)
  await settleGeometry(page)
}

test("prepend anchoring survives when the nearest keys are re-keyed", () => {
  const root = {} as HTMLDivElement
  const writes: number[] = []
  const options = (keys: string[]) => ({
    count: keys.length,
    estimateSize: () => 50,
    initialOffset: 50,
    initialRect: { width: 400, height: 100 },
    anchorTo: "start" as const,
    getItemKey: (index: number) => keys[index]!,
    getScrollElement: () => root,
    scrollToFn: (offset: number) => {
      writes.push(offset)
    },
    observeElementRect: () => {},
    observeElementOffset: (
      _instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
      callback: (offset: number, isScrolling: boolean) => void,
    ) => {
      callback(50, false)
    },
  })
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>(options(["orphan-c", "d", "e"]))
  virtualizer._willUpdate()
  virtualizer.getVirtualItems()

  virtualizer.setOptions(options(["a", "b", "c", "d", "e"]))
  virtualizer._willUpdate()

  expect(virtualizer.scrollOffset).toBe(150)
  expect(writes.at(-1)).toBe(150)
})

test("cold render starts latest, virtualizes 1,000+ rows, and clears the composer", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  expect(await page.locator("[data-timeline-key]").count()).toBeLessThan(80)
  const newest = page.locator('[data-timeline-key="assistant-part:part:assistant-359:text-359"]')
  await expect(newest).toBeVisible()
  expect(await newest.evaluate((element) => element.style.height)).toBe("")
  await newest.hover()
  await expect
    .poll(() =>
      newest
        .locator('[data-component="message-action"]')
        .evaluate((element) => [getComputedStyle(element).opacity, getComputedStyle(element).pointerEvents]),
    )
    .toEqual(["1", "auto"])
  const geometry = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-timeline-key="assistant-part:part:assistant-359:text-359"]')!
    const composer = document.querySelector<HTMLElement>('[data-slot="session-workspace-composer-content"]')!
    const view = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')!
    return {
      rowBottom: row.getBoundingClientRect().bottom,
      composerTop: composer.getBoundingClientRect().top,
      viewBottom: view.getBoundingClientRect().bottom,
    }
  })
  expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.composerTop - 20)
  expect(geometry.composerTop).toBeLessThan(geometry.viewBottom)
  expect(await bottomDistance(scroller)).toBeLessThanOrEqual(1)
  await expect
    .poll(() =>
      page.locator("[data-motion-probe]").evaluate((element) => {
        const style = getComputedStyle(element)
        return [style.animationName, style.transitionProperty]
      }),
    )
    .toEqual(["none", "none"])
})

test("cold and cached bottom mounts settle hidden content before reveal with reduced-motion support", async ({
  page,
}) => {
  await open(page)
  const cold = page.locator("[data-timeline-virtual-content]")
  await expect(cold).toHaveAttribute("data-cold-bottom", "")
  await expect(cold).not.toHaveAttribute("data-timeline-settling", "")
  await expect(cold).toBeVisible()
  await expect(cold).not.toHaveAttribute("data-timeline-reveal", "")

  await page.evaluate(() => window.timelineHarness.remount())
  const cached = page.locator("[data-timeline-virtual-content]")
  await expect(cached).not.toHaveAttribute("data-cold-bottom", "")
  await expect.poll(() => bottomDistance(viewport(page))).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 390, height: 700 })
  await page.evaluate(() => window.timelineHarness.remount())
  await expect(page.locator("[data-timeline-virtual-content]")).not.toHaveAttribute("data-cold-bottom", "")
  await expect.poll(() => bottomDistance(viewport(page))).toBeLessThanOrEqual(1)
})

test("fallback-only cache restore, remount, and reasoning changes commit mounted row geometry", async ({ page }) => {
  await open(page, "stale-cache")

  const assertGeometry = async () => {
    await settleGeometry(page)
    const geometry = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-key]")]
      const gap = document
        .querySelector<HTMLElement>('[data-timeline-row="TurnGap"]')!
        .closest<HTMLElement>("[data-timeline-key]")!
      const action = document.querySelector<HTMLElement>('[data-component="message-action"][data-owner="assistant"]')!
      const actionRow = action.closest<HTMLElement>("[data-timeline-key]")!
      const actionBounds = action.getBoundingClientRect()
      const rowBounds = actionRow.getBoundingClientRect()
      return {
        rowsMatch: rows.every(
          (row) =>
            Math.abs(row.getBoundingClientRect().height - row.firstElementChild!.getBoundingClientRect().height) < 0.1,
        ),
        gapHeight: gap.getBoundingClientRect().height,
        actionsWithinRow: actionBounds.top >= rowBounds.top - 0.1 && actionBounds.bottom <= rowBounds.bottom + 0.1,
      }
    })
    expect(geometry).toEqual({ rowsMatch: true, gapHeight: 24, actionsWithinRow: true })
  }

  await assertGeometry()
  await page.evaluate(() => window.timelineHarness.remount())
  await assertGeometry()
  await page.evaluate(() => window.timelineHarness.setReasoning(false))
  await assertGeometry()
  await page.evaluate(() => window.timelineHarness.setReasoning(true))
  await assertGeometry()
})

test("timeline pointer, focus, and selection interactions preserve measured row geometry", async ({ page }) => {
  await open(page, "stale-cache")
  const scroller = viewport(page)
  const geometry = () =>
    scroller.evaluate((element) => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      keys: [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].map((row) => row.dataset.timelineKey),
      rows: [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].map((row) => ({
        key: row.dataset.timelineKey,
        outer: row.getBoundingClientRect().height,
        inner: row.firstElementChild!.getBoundingClientRect().height,
        top: row.getBoundingClientRect().top,
      })),
    }))
  const before = await geometry()
  const assertStable = async () => {
    await settleGeometry(page)
    const after = await geometry()
    expect(after.keys).toEqual(before.keys)
    expect(after.scrollTop).toBeCloseTo(before.scrollTop, 1)
    expect(after.scrollHeight).toBeCloseTo(before.scrollHeight, 1)
    expect(after.rows.map((row) => row.top)).toEqual(before.rows.map((row) => row.top))
    expect(after.rows.every((row) => Math.abs(row.outer - row.inner) < 0.1)).toBe(true)
  }

  const bounds = await scroller.boundingBox()
  if (!bounds) throw new Error("Timeline viewport is not visible")
  await page.mouse.click(bounds.x + 2, bounds.y + bounds.height / 2)
  await assertStable()
  await page
    .locator('[data-timeline-key="assistant-part:part:assistant-stale:text-stale"] [data-component="markdown"]')
    .click()
  await assertStable()
  const userBounds = await page
    .locator('[data-timeline-key="user-message:user-stale"] [data-component="user-message"]')
    .boundingBox()
  if (!userBounds) throw new Error("User message is not mounted")
  await page.mouse.click(userBounds.x + userBounds.width / 2, Math.max(bounds.y + 2, userBounds.y + 2))
  await assertStable()

  await page
    .locator('[data-timeline-key="assistant-part:part:assistant-stale:reasoning-stale"]')
    .evaluate((element) => {
      const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
      if (!text?.textContent) throw new Error("Reasoning text is not rendered")
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, Math.min(12, text.textContent.length))
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
    })
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().length ?? 0)).toBeGreaterThan(0)
  await assertStable()
})

test("a settling turn mounts one measured footer and preserves pinned and unpinned viewport geometry", async ({
  page,
}) => {
  await open(page, "footer")
  const scroller = viewport(page)
  const actions = page.locator(
    '[data-message-id="footer-turn"] [data-component="message-action"][data-owner="assistant"]',
  )
  await expect(actions).toHaveCount(0)

  await page.evaluate(() => window.timelineHarness.completeFooter())
  await expect(actions).toHaveCount(1)
  await settleGeometry(page)
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
  const finalRow = page.locator('[data-timeline-key="assistant-part:part:footer-assistant-final:footer-final"]')
  const finalAction = finalRow.locator('[data-component="message-action"][data-owner="assistant"]')
  await expect(finalAction).toContainText("build · Final Model · 6s")
  const geometry = await finalAction.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")!
    const bounds = element.getBoundingClientRect()
    const rowBounds = row.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      minHeight: style.minHeight,
      marginTop: style.marginTop,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      withinRow: bounds.top >= rowBounds.top - 0.1 && bounds.bottom <= rowBounds.bottom + 0.1,
      measured: Math.abs(rowBounds.height - row.firstElementChild!.getBoundingClientRect().height) < 0.1,
    }
  })
  expect(geometry).toEqual({
    minHeight: "24px",
    marginTop: "4px",
    opacity: "0",
    pointerEvents: "none",
    withinRow: true,
    measured: true,
  })
  await finalRow.locator('[data-component="text-part"]').hover()
  await expect
    .poll(() =>
      finalAction.evaluate((element) => [getComputedStyle(element).opacity, getComputedStyle(element).pointerEvents]),
    )
    .toEqual(["1", "auto"])
  await finalAction.getByRole("button", { name: "Copy response" }).focus()
  await expect
    .poll(() =>
      finalAction.evaluate((element) => [getComputedStyle(element).opacity, getComputedStyle(element).pointerEvents]),
    )
    .toEqual(["1", "auto"])

  await open(page, "footer")
  await scroller.hover()
  await page.mouse.wheel(0, -1_500)
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
  await settleGeometry(page)
  const anchor = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    const row = [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((candidate) => {
      const bounds = candidate.getBoundingClientRect()
      return bounds.top >= view.top + 20 && bounds.bottom <= view.bottom - 20
    })!
    return { key: row.dataset.timelineKey!, top: row.getBoundingClientRect().top - view.top }
  })
  const distance = await bottomDistance(scroller)
  await page.evaluate(() => window.timelineHarness.completeFooter())
  await expect(actions).toHaveCount(1)
  await settleGeometry(page)
  const movement = await scroller.evaluate((element, expected) => {
    const row = element.querySelector<HTMLElement>(`[data-timeline-key="${expected.key}"]`)!
    return Math.abs(row.getBoundingClientRect().top - element.getBoundingClientRect().top - expected.top)
  }, anchor)
  expect(movement).toBeLessThanOrEqual(1)
  expect(await bottomDistance(scroller)).toBeGreaterThan(distance)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
})

test("cold bottom content fades in after geometry settles when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((records) => {
        if (records.some((record) => record.type === "attributes" && record.attributeName === "data-timeline-reveal"))
          window.timelineRevealObserved = true
      }).observe(document.body, { attributes: true, subtree: true })
    })
  })
  await page.goto("/test-browser/timeline-harness.html?scenario=large&theme=light")
  await page.waitForFunction(() => window.timelineHarness !== undefined)

  await page.waitForFunction(() => window.timelineRevealObserved === true)
  await expect(page.locator("[data-timeline-virtual-content]")).toBeVisible()
  await expect.poll(() => bottomDistance(viewport(page))).toBeLessThanOrEqual(1)
})

test("a pinned timeline recovers its bottom offset after its route frame detaches and reconnects", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  await page.evaluate(() => window.timelineHarness.growLatest(6))
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)

  await page.evaluate(() => window.timelineHarness.reconnect())

  await expect(scroller).toBeVisible()
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(true)
})

test("message hashes page older history and align the virtualized target below the sticky header", async ({ page }) => {
  for (const size of [
    { width: 1100, height: 800 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(size)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/test-browser/timeline-harness.html?scenario=hash#message-user-250")
    await page.waitForFunction(() => window.timelineHarness !== undefined)
    const target = page.locator("#message-user-250")
    await expect(target).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.timelineHarness.loadCalls())).toBe(2)
    await expect
      .poll(() =>
        target.evaluate((element) => {
          const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')!
          return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
        }),
      )
      .toBeGreaterThanOrEqual(63)
    expect(
      await target.evaluate((element) => {
        const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')!
        return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      }),
    ).toBeLessThanOrEqual(65)
    expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
  }
})

test("missing message hashes exhaust history without bypassing the virtualizer", async ({ page }) => {
  await page.goto("/test-browser/timeline-harness.html?scenario=hash#message-user-missing")
  await page.waitForFunction(() => window.timelineHarness !== undefined)

  await expect.poll(() => page.evaluate(() => window.timelineHarness.more())).toBe(false)
  expect(await page.evaluate(() => window.timelineHarness.loadCalls())).toBe(2)
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
  expect(new URL(page.url()).hash).toBe("#message-user-missing")
})

test("previous and next navigation update message hashes and next from newest resumes following", async ({ page }) => {
  await open(page)

  await page.evaluate(() => window.timelineHarness.navigateMessage(-1))
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#message-user-\d+$/)
  const first = Number(new URL(page.url()).hash.match(/\d+$/)?.[0])
  await expect(page.locator(`#message-user-${first}`)).toBeVisible()
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)

  await page.evaluate(() => window.timelineHarness.navigateMessage(-1))
  await expect(page.locator(`#message-user-${first - 1}`)).toBeVisible()
  expect(new URL(page.url()).hash).toBe(`#message-user-${first - 1}`)

  await page.evaluate(() => window.timelineHarness.navigateMessage(1))
  await expect(page.locator(`#message-user-${first}`)).toBeVisible()
  await page.evaluate(() => {
    location.hash = "#message-user-359"
  })
  await expect(page.locator("#message-user-359")).toBeVisible()
  await settle(page)
  await page.evaluate(() => window.timelineHarness.navigateMessage(1))
  await expect.poll(() => new URL(page.url()).hash).toBe("")
  await expect.poll(() => bottomDistance(viewport(page))).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(true)
})

test("browser back and forward reapply message hash navigation", async ({ page }) => {
  await page.goto("/test-browser/timeline-harness.html?scenario=large#message-user-355")
  await page.waitForFunction(() => window.timelineHarness !== undefined)
  await expect(page.locator("#message-user-355")).toBeVisible()

  await page.evaluate(() => {
    location.hash = "#message-user-350"
  })
  await expect(page.locator("#message-user-350")).toBeVisible()
  await page.goBack()
  await expect(page.locator("#message-user-355")).toBeVisible()
  await page.goForward()
  await expect(page.locator("#message-user-350")).toBeVisible()
})

test("user message bubble contrasts with the transcript surface", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await open(page, "large", theme)
    const colors = await page
      .locator('[data-slot="user-message-text"]')
      .first()
      .evaluate((bubble) => ({
        bubble: getComputedStyle(bubble).backgroundColor,
        page: getComputedStyle(document.querySelector<HTMLElement>('[data-slot="session-workspace-page"]')!)
          .backgroundColor,
      }))
    expect(colors.bubble).not.toBe(colors.page)
  }
})

test("large user messages expand wide and preserve disclosure across remount", async ({ page }) => {
  await open(page, "long-user")
  const showMore = page.getByRole("button", { name: "Show more" })
  await expect(showMore).toHaveAttribute("aria-expanded", "false")
  const body = page
    .locator('[data-timeline-key="user-message:user-659"]')
    .locator('[data-slot="user-message-body"]')
  const collapsed = await body.boundingBox()
  expect(collapsed).not.toBeNull()

  await showMore.click()
  const showLess = page.getByRole("button", { name: "Show less" })
  await expect(showLess).toHaveAttribute("aria-expanded", "true")
  await expect.poll(() => body.boundingBox()).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
  const expanded = await body.boundingBox()
  expect(expanded!.width).toBeGreaterThan(collapsed!.width)
  expect(expanded!.height).toBeGreaterThan(collapsed!.height)

  await page.evaluate(() => window.timelineHarness.remount())
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
})

test("composer growth keeps the latest chat position visible", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)

  await page.evaluate(() => window.timelineHarness.resizeComposer(184))

  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
  const latest = page.locator('[data-timeline-key="assistant-part:part:assistant-359:text-359"]')
  await expect(latest).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const row = document.querySelector<HTMLElement>(
          '[data-timeline-key="assistant-part:part:assistant-359:text-359"]',
        )!
        const composer = document.querySelector<HTMLElement>('[data-slot="session-workspace-composer-content"]')!
        return row.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top - 20
      }),
    )
    .toBe(true)
})

test("transcript frames match desktop and mobile geometry", async ({ page }) => {
  await open(page)
  const desktop = await page.locator('[data-timeline-key="user-message:user-359"]').evaluate((row) => {
    const frame = row.querySelector<HTMLElement>('[data-timeline-row="UserMessage"]')!
    const container = frame.querySelector<HTMLElement>('[data-slot="session-turn-message-container"]')!
    const bubble = frame.querySelector<HTMLElement>('[data-slot="user-message-text"]')!
    const text = row.parentElement!.querySelector<HTMLElement>('[data-component="text-part"]')!
    const userStyle = getComputedStyle(frame.querySelector<HTMLElement>('[data-component="user-message"]')!)
    const markdownStyle = getComputedStyle(text.querySelector<HTMLElement>('[data-component="markdown"]')!)
    const bounds = frame.getBoundingClientRect()
    const containerStyle = getComputedStyle(container)
    const bubbleStyle = getComputedStyle(bubble)
    return {
      width: bounds.width,
      left: bounds.left,
      padding: containerStyle.paddingInlineStart,
      bubbleRadius: bubbleStyle.borderRadius,
      bubblePadding: `${bubbleStyle.paddingBlockStart} ${bubbleStyle.paddingInlineStart}`,
      textMargin: getComputedStyle(text).marginTop,
      userType: `${userStyle.fontSize}/${userStyle.lineHeight}/${userStyle.fontWeight}`,
      assistantType: `${markdownStyle.fontSize}/${markdownStyle.lineHeight}/${markdownStyle.fontWeight}`,
    }
  })
  expect(desktop).toEqual({
    width: 840,
    left: 130,
    padding: "20px",
    bubbleRadius: "10px",
    bubblePadding: "8px 12px",
    textMargin: "24px",
    userType: "14px/21px/440",
    assistantType: "14px/22.4px/440",
  })

  await page.setViewportSize({ width: 390, height: 700 })
  await open(page)
  const mobile = await page.locator('[data-timeline-key="user-message:user-359"]').evaluate((row) => {
    const frame = row.querySelector<HTMLElement>('[data-timeline-row="UserMessage"]')!
    const container = frame.querySelector<HTMLElement>('[data-slot="session-turn-message-container"]')!
    const bounds = frame.getBoundingClientRect()
    return {
      width: bounds.width,
      left: bounds.left,
      padding: getComputedStyle(container).paddingInlineStart,
    }
  })
  expect(mobile).toEqual({ width: 390, left: 0, padding: "8px" })
})

test("session identity header stays sticky with a 48px row and 16px gradient tail", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  const header = page.locator('[data-component="session-header"]')
  const desktop = await header.evaluate((element) => {
    const row = element.querySelector<HTMLElement>('[data-slot="session-header-row"]')!
    const style = getComputedStyle(element)
    return {
      top: element.getBoundingClientRect().top,
      height: element.getBoundingClientRect().height,
      rowHeight: row.getBoundingClientRect().height,
      position: style.position,
      background: style.backgroundImage,
    }
  })
  expect(desktop).toMatchObject({ top: 0, height: 64, rowHeight: 48, position: "sticky" })
  expect(desktop.background).toContain("linear-gradient")
  await expect(page.getByRole("heading", { name: "Timeline geometry session" })).toBeVisible()
  await expect(page.getByLabel("Project Timeline project in workspace Browser workspace")).toBeVisible()
  await expect(page.getByRole("img", { name: "Context usage: 6%, 12,345 tokens, $0.42" })).toBeVisible()

  await scroller.hover()
  await page.mouse.wheel(0, -1_200)
  await settle(page)
  expect(await header.evaluate((element) => element.getBoundingClientRect().top)).toBe(0)

  await page.setViewportSize({ width: 390, height: 700 })
  await open(page, "large", "dark")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await expect(page.getByRole("heading", { name: "Timeline geometry session" })).toBeVisible()
  await expect(page.getByLabel("Project Timeline project in workspace Browser workspace")).toBeHidden()
  expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(64)
})

test("delayed prepend preserves visible keyed row positions within one pixel", async ({ page }) => {
  await open(page, "prepend")
  const scroller = viewport(page)
  await scroller.hover()
  await wheelUntil(page, () => page.evaluate(() => window.timelineHarness.pendingOlder()), -500, 60)
  await settleGeometry(page)
  await expect(page.locator('[data-timeline-key="assistant-part:part:assistant-300:fragment-tool-300"]')).toContainText(
    "Regrouped history boundary",
  )
  const before = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    return Object.fromEntries(
      [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")]
        .filter((row) => {
          const rect = row.getBoundingClientRect()
          return (
            !row.dataset.timelineKey!.includes("fragment-") &&
            rect.top >= view.top + 20 &&
            rect.bottom <= view.bottom - 20
          )
        })
        .slice(0, 3)
        .map((row) => [row.dataset.timelineKey!, row.getBoundingClientRect().top - view.top]),
    )
  })
  expect(Object.keys(before).length).toBeGreaterThan(0)
  const movement = await scroller.evaluate(async (element, expected) => {
    let maximum = 0
    let maximumFrame = {}
    let previous = ""
    let stable = 0
    let frames = 0
    const sample = () => {
      const top = element.getBoundingClientRect().top
      const positions = Object.entries(expected).map(([key, position]) => {
        const row = element.querySelector<HTMLElement>(`[data-timeline-key="${key}"]`)
        if (!row) return Number.POSITIVE_INFINITY
        return Math.abs(row.getBoundingClientRect().top - top - position)
      })
      maximum = Math.max(maximum, ...positions)
      if (maximum === Math.max(...positions))
        maximumFrame = {
          frame: frames,
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          positions,
        }
      const current = `${element.scrollTop}:${element.scrollHeight}:${positions.join(":")}`
      stable = current === previous ? stable + 1 : 0
      previous = current
    }
    window.timelineHarness.resolveOlder()
    return new Promise<{ maximum: number; maximumFrame: unknown; frames: number }>((resolve) => {
      const frame = () => {
        frames += 1
        sample()
        const markdownReady = !element.querySelector('[data-component="markdown"]:not([data-markdown-ready])')
        if (!window.timelineHarness.pendingOlder() && markdownReady && stable >= 4) {
          return resolve({ maximum, maximumFrame, frames })
        }
        if (frames >= 120) {
          return resolve({ maximum: Number.POSITIVE_INFINITY, maximumFrame, frames })
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }, before)
  expect(movement.maximum, JSON.stringify(movement.maximumFrame)).toBeLessThanOrEqual(1)
  expect(movement.frames).toBeGreaterThan(4)
  expect(await page.evaluate(() => window.timelineHarness.regrouped())).toBe(true)
  await expect(page.locator('[data-timeline-key="assistant-part:part:assistant-300:fragment-tool-300"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-key="assistant-part:part:assistant-300:tool-boundary-300"]')).toContainText(
    "Regrouped history boundary",
  )
})

test("pinned growth follows, upward wheel unpins, and jump restores following", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  await page.evaluate(() => window.timelineHarness.growLatest(12))
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)

  await scroller.hover()
  const thumb = page.locator('[data-component="scroll-view-thumb"]')
  const box = (await thumb.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => bottomDistance(scroller)).toBeGreaterThan(100)
  const afterThumbDrag = await bottomDistance(scroller)
  await page.evaluate(() => window.timelineHarness.growLatest(2))
  await expect.poll(() => bottomDistance(scroller)).toBeGreaterThan(afterThumbDrag)
  const jump = page.getByRole("button", { name: "Jump to latest message" })
  await expect(jump).toHaveAttribute("data-component", "icon-button")
  await expect(jump).toHaveAttribute("data-size", "large")
  await expect(jump).toHaveAttribute("data-variant", "neutral")
  await expect(jump.locator('[data-slot="icon-svg"]')).toHaveCount(1)
  await jump.click()
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)

  await scroller.hover()
  await wheelUntil(page, async () => (await bottomDistance(scroller)) > 1_600, -500, 10)
  await scroller.evaluate((element) => (element.scrollTop = Math.max(0, element.scrollTop - 3_000)))
  await settleGeometry(page)
  const fixedAnchor = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    const row = [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return rect.top >= view.top + 20 && rect.bottom <= view.bottom - 20
    })!
    return { key: row.dataset.timelineKey!, top: row.getBoundingClientRect().top - view.top }
  })
  const beforeGrowth = await bottomDistance(scroller)
  await page.evaluate(() => window.timelineHarness.growLatest(8))
  await settleGeometry(page)
  expect(await bottomDistance(scroller)).toBeGreaterThan(beforeGrowth)
  const movement = await scroller.evaluate((element, anchor) => {
    const row = element.querySelector<HTMLElement>(`[data-timeline-key="${anchor.key}"]`)!
    const actual = row.getBoundingClientRect().top - element.getBoundingClientRect().top
    return { delta: Math.abs(actual - anchor.top), actual, scrollTop: element.scrollTop }
  }, fixedAnchor)
  expect(movement.delta, JSON.stringify(movement)).toBeLessThanOrEqual(1)

  await page.getByRole("button", { name: "Jump to latest message" }).click()
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
  await page.evaluate(() => window.timelineHarness.growLatest(6))
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
})

test("scrolling inside a tall message does not restore a stale offscreen anchor on resize", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  await page.evaluate(() => window.timelineHarness.growLatest(100))
  await settleGeometry(page)
  await scroller.hover()
  await page.mouse.wheel(0, -100)
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
  await scroller.evaluate((element) => {
    const row = element.querySelector<HTMLElement>('[data-timeline-key="user-message:user-359"]')!
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 100
  })
  await settleGeometry(page)

  // Leave the small, fully visible row behind and read inside its tall response.
  await page.mouse.wheel(0, 1_200)
  await settleGeometry(page)
  expect(
    await scroller.evaluate((element) => {
      const view = element.getBoundingClientRect()
      return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].some((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= view.top + 20 && rect.bottom <= view.bottom - 20
      })
    }),
  ).toBe(false)

  for (const delta of [400, -200, 400, -200]) {
    await page.mouse.wheel(0, delta)
    await settleGeometry(page)
    const before = await scroller.evaluate((element) => element.scrollTop)
    await page.evaluate(() => window.timelineHarness.growLatest(1))
    await settleGeometry(page)
    const after = await scroller.evaluate((element) => element.scrollTop)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1)
  }
})

test("non-contiguous fresh windows replace retained history and force the viewport to latest", async ({ page }) => {
  await open(page)
  const scroller = viewport(page)
  await page.evaluate(() => window.timelineHarness.showJump())
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pinned())).toBe(false)

  await page.evaluate(() => window.timelineHarness.replaceWindow())

  await expect(page.locator('[data-timeline-key="user-message:user-0"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-key="assistant-part:part:assistant-905:text-905"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pinned())).toBe(true)
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(1)
  await expect(page.getByText(/transcript gap|history gap|newer messages/i)).toHaveCount(0)
})

test("streaming text keeps its row DOM identity through terminal reconciliation", async ({ page }) => {
  await open(page)
  const key = "assistant-part:part:assistant-359:text-359"
  const row = page.locator(`[data-timeline-key="${key}"]`)
  const initial = await row.elementHandle()

  await page.evaluate(() => window.timelineHarness.streamLatest("\n\nIncrement one."))
  await expect(row).toContainText("Increment one.")
  await page.evaluate(() => window.timelineHarness.streamLatest("\n\nIncrement two."))
  await expect(row).toContainText("Increment two.")
  await page.evaluate(() => window.timelineHarness.completeLatest())
  await expect(row).toContainText("Increment two.")

  expect(await row.evaluate((element, original) => element.isSameNode(original), initial)).toBe(true)
})

test("pinned streaming does not reverse a stable row", async ({ page }) => {
  await open(page)
  const result = await page.evaluate(async () => {
    const view = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')!
    const samples: Array<{ y: number; height: number }> = []
    let streams = 0
    await new Promise<void>((resolve) => {
      const frame = () => {
        if (streams < 16) {
          window.timelineHarness.streamLatest(" word")
          streams += 1
        }
        const stable = view.querySelector<HTMLElement>('[data-timeline-key="user-message:user-359"]')
        if (stable) {
          samples.push({
            y: stable.getBoundingClientRect().top,
            height: view.scrollHeight,
          })
        }
        if (samples.length >= 48) return resolve()
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    let reversals = 0
    for (let index = 2; index < samples.length; index++) {
      const before = samples[index - 2]!
      const previous = samples[index - 1]!
      const current = samples[index]!
      const flipped =
        (current.y > previous.y + 0.2 && previous.y < before.y - 0.2) ||
        (current.y < previous.y - 0.2 && previous.y > before.y + 0.2)
      if (flipped && current.height === previous.height && previous.height === before.height) reversals += 1
    }
    return { reversals, samples: samples.length }
  })
  expect(result.samples).toBe(48)
  expect(result.reversals, JSON.stringify(result)).toBe(0)
})

test("tool disclosure survives virtual unmount and remount", async ({ page }) => {
  await open(page)
  const trigger = page.locator(
    '[data-timeline-key="assistant-part:part:assistant-358:tool-latest"] [data-slot="collapsible-trigger"]',
  )
  await trigger.press("Enter")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await settleGeometry(page)
  const scroller = viewport(page)
  await page.getByRole("textbox", { name: "Composer fixture" }).focus()
  await settle(page)
  await scroller.hover()
  await page.mouse.wheel(0, -120)
  await expect.poll(() => bottomDistance(scroller)).toBeGreaterThan(50)
  await scroller.evaluate((element) => (element.scrollTop = 0))
  await expect(trigger).toHaveCount(0)
  await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
})

test("tool families expose grouped context, grouped files, status, errors, and disclosures", async ({ page }) => {
  await open(page, "tools")
  const context = page.getByRole("button", { name: "Explored Collapsed" })
  await expect(context).toContainText("1 read · 1 search")
  await context.click()
  await expect(page.getByText("pattern=ToolDisplay")).toBeVisible()
  await expect(page.getByText("(4 matches)")).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator("[data-timeline-key]")
        .evaluateAll((rows) =>
          rows.every(
            (row) => row.getBoundingClientRect().height === row.firstElementChild?.getBoundingClientRect().height,
          ),
        ),
    )
    .toBe(true)

  const patch = page.locator('[data-component="apply-patch-tool"]')
  await expect(patch).toContainText("2 files")
  await expect(patch.getByRole("button", { name: /tool\.tsx/ })).toHaveAttribute("aria-expanded", "false")
  await patch.getByRole("button", { name: /tool\.tsx/ }).press("Enter")
  await expect(page.getByRole("region", { name: "Diff for src/features/session/tool.tsx" })).toContainText("+new tool")

  await expect(page.getByRole("button", { name: "Shell bun typecheck Collapsed" })).toBeEnabled()
  await expect(
    page.getByRole("button", { name: /edit src\/features\/session\/missing\.ts Failed Collapsed/i }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /Write src\/features\/session\/status\.ts Collapsed/i })).toBeVisible()
})

test("skill rows stay single-line and measured as running tools settle", async ({ page }) => {
  await open(page, "visual-skill")
  const loaded = page.locator('[data-component="tool-loaded-item"][aria-label]')
  await expect(loaded).toHaveCount(2)
  await expect(
    page.getByLabel("Loaded source-conformant-skill-with-a-name-that-must-truncate-on-mobile skill"),
  ).toBeVisible()
  await expect(page.getByLabel("Loaded browser-control skill")).toBeVisible()
  await expect(page.getByLabel("Skill", { exact: true })).toBeVisible()
  await expect(page.getByText("Hidden skill instructions")).toHaveCount(0)
  await expect(page.locator('[data-message-id="skill-turn"] [data-component="collapsible"]')).toHaveCount(0)
  await expect(page.locator('[data-message-id="skill-turn"] [data-slot="collapsible-arrow"]')).toHaveCount(0)
  await expect(page.locator('[data-message-id="skill-turn"] [data-component="tool-output"]')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 700 })
  await settleGeometry(page)
  const before = await page
    .locator('[data-message-id="skill-turn"][data-timeline-row="AssistantPart"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const bounds = row.getBoundingClientRect()
        return { top: bounds.top, height: bounds.height }
      }),
    )
  const styles = await loaded.first().evaluate((row) => {
    const label = row.querySelector<HTMLElement>('[data-slot="tool-loaded-label"]')!
    const value = row.querySelector<HTMLElement>('[data-slot="tool-loaded-value"]')!
    const suffix = row.querySelector<HTMLElement>('[data-slot="tool-loaded-kind"]')!
    return {
      row: `${getComputedStyle(row).fontSize}/${getComputedStyle(row).lineHeight}/${getComputedStyle(row).columnGap}`,
      labelShrink: getComputedStyle(label).flexShrink,
      value: [
        getComputedStyle(value).minWidth,
        getComputedStyle(value).overflow,
        getComputedStyle(value).textOverflow,
        getComputedStyle(value).whiteSpace,
      ],
      suffixShrink: getComputedStyle(suffix).flexShrink,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(styles).toEqual({
    row: "13px/20px/6px",
    labelShrink: "0",
    value: ["0px", "hidden", "ellipsis", "nowrap"],
    suffixShrink: "0",
    documentOverflow: 0,
  })

  await page.evaluate(() => window.timelineHarness.completeSkills())
  await settleGeometry(page)
  const after = await page
    .locator('[data-message-id="skill-turn"][data-timeline-row="AssistantPart"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const bounds = row.getBoundingClientRect()
        return {
          top: bounds.top,
          height: bounds.height,
          measured: Math.abs(bounds.height - row.parentElement!.getBoundingClientRect().height) < 0.1,
        }
      }),
    )
  expect(after.map(({ top, height }) => ({ top, height }))).toEqual(before)
  expect(after.every((row) => row.measured)).toBe(true)
  await expect(
    page.getByLabel("Loaded browser-control skill").locator('[data-component="text-shimmer"]'),
  ).toHaveAttribute("data-active", "false")
  await expect(page.getByLabel("Skill", { exact: true })).toHaveAttribute("data-active", "false")
})

test("underfilled viewport requests sequential older pages until it overflows", async ({ page }) => {
  await open(page, "underfill")
  await expect
    .poll(() => viewport(page).evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(1)
  expect(await page.evaluate(() => window.timelineHarness.loadCalls())).toBeGreaterThan(1)
  expect(await page.evaluate(() => window.timelineHarness.more())).toBe(true)
})

test("older-load failure exposes a stable, deduplicated retry boundary", async ({ page }) => {
  await open(page, "retry")
  const scroller = viewport(page)
  await scroller.hover()
  await wheelUntil(page, () => page.evaluate(() => window.timelineHarness.pendingOlder()), -500, 60)
  await scroller.evaluate((element) => (element.scrollTop = 0))
  await settleGeometry(page)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)

  const before = await scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    return Object.fromEntries(
      [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")]
        .slice(0, 3)
        .map((row) => [row.dataset.timelineKey!, row.getBoundingClientRect().top - view.top]),
    )
  })
  await page.evaluate(() => window.timelineHarness.failOlder())

  const alert = page.getByRole("alert")
  const retry = page.getByRole("button", { name: "Retry" })
  await expect(alert).toContainText("History request failed")
  await expect(retry).toBeEnabled()
  await settleGeometry(page)
  const boundary = await scroller.evaluate((element, expected) => {
    const view = element.getBoundingClientRect()
    const error = element.querySelector<HTMLElement>('[data-slot="timeline-older-error"]')!.getBoundingClientRect()
    const positions = Object.fromEntries(
      Object.keys(expected).map((key) => {
        const row = element.querySelector<HTMLElement>(`[data-timeline-key="${key}"]`)!
        return [key, row.getBoundingClientRect().top - view.top]
      }),
    )
    return {
      alertTop: error.top - view.top,
      alertBottom: error.bottom - view.top,
      firstRowTop: Math.min(...Object.values(positions)),
      positions,
    }
  }, before)
  expect(boundary.alertTop).toBeGreaterThanOrEqual(0)
  expect(boundary.alertBottom).toBeLessThanOrEqual(boundary.firstRowTop)
  expect(boundary.positions).toEqual(before)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)

  await retry.evaluate((button) => {
    const retryButton = button as HTMLButtonElement
    retryButton.click()
    retryButton.click()
  })
  await expect.poll(() => page.evaluate(() => window.timelineHarness.loadCalls())).toBe(2)
  await expect(retry).toBeDisabled()
  await settle(page)
  expect(await page.evaluate(() => window.timelineHarness.loadCalls())).toBe(2)

  await page.evaluate(() => window.timelineHarness.resolveOlder())
  await expect(alert).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.timelineHarness.pendingOlder())).toBe(false)
  expect(await page.evaluate(() => window.timelineHarness.pinned())).toBe(false)
})
