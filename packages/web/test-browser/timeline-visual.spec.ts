import { expect, test, type Page } from "@playwright/test"

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const
const themes = ["light", "dark"] as const
const scenarios = [
  "visual-empty",
  "visual-content",
  "visual-status",
  "visual-streaming",
  "visual-tools",
  "visual-shell",
  "visual-skill",
] as const

async function openVisual(page: Page, scenario: string, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`/test-browser/timeline-harness.html?scenario=${scenario}&theme=${theme}`)
  await page.waitForFunction(() => window.timelineHarness !== undefined)
  await expect(page.locator('[data-slot="scroll-view-viewport"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
  await settleVisual(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
}

async function settleVisual(page: Page) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-view-viewport"]')
    if (!viewport) return false
    return new Promise<boolean>((resolve) => {
      let previous = ""
      let stable = 0
      const sample = () => {
        const current = `${viewport.scrollTop}:${viewport.scrollHeight}:${[
          ...viewport.querySelectorAll<HTMLElement>("[data-timeline-key]"),
        ]
          .map(
            (row) =>
              `${row.dataset.timelineKey}:${row.getBoundingClientRect().top}:${row.getBoundingClientRect().height}`,
          )
          .join("|")}`
        stable = current === previous ? stable + 1 : 0
        previous = current
        if (stable >= 4) return resolve(true)
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
}

async function settleDisclosures(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0
        const next = () => {
          frames += 1
          if (frames >= 8) return resolve()
          requestAnimationFrame(next)
        }
        requestAnimationFrame(next)
      }),
  )
  await settleVisual(page)
}

for (const size of sizes) {
  for (const theme of themes) {
    for (const scenario of scenarios) {
      test(`${scenario} ${theme} ${size.name}`, async ({ page }) => {
        await page.setViewportSize(size)
        await openVisual(page, scenario, theme)
        if (scenario === "visual-content") {
          await page.locator('[data-component="user-message"]').hover()
          await expect(page.getByRole("button", { name: "Copy message" })).toBeVisible()
        }
        await expect(page).toHaveScreenshot(`${scenario}-${theme}-${size.name}.png`, {
          animations: "disabled",
          caret: "hide",
        })
      })
    }

    test(`visual-tools-open ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openVisual(page, "visual-tools", theme)
      await page.getByRole("button", { name: "Explored Collapsed" }).press("Enter")
      await page.locator('[data-slot="scroll-view-viewport"]').focus()
      await expect(page.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
      await settleDisclosures(page)
      const contextTools = page.locator('[data-timeline-part-ids="read-tools,grep-tools"]')
      await expect(contextTools).toHaveScreenshot(`visual-tools-open-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.05,
      })
    })

    test(`visual-file-open ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openVisual(page, "visual-tools", theme)
      await page.locator('[data-component="apply-patch-tool"] button[aria-expanded="false"]').first().press("Enter")
      await page.locator('[data-slot="scroll-view-viewport"]').focus()
      await settleDisclosures(page)
      await expect(page.getByRole("region", { name: "Diff for src/features/session/tool.tsx" })).toBeVisible()
      const fileTool = page.locator('[data-component="apply-patch-tool"]')
      await expect(fileTool).toHaveScreenshot(`visual-file-open-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.05,
      })
    })

    test(`visual-error-open ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openVisual(page, "visual-tools", theme)
      await page
        .getByRole("button", { name: /edit src\/features\/session\/missing\.ts Failed Collapsed/i })
        .press("Enter")
      await page.locator('[data-slot="scroll-view-viewport"]').focus()
      await settleDisclosures(page)
      await expect(page.getByText("No matching text found in file")).toBeVisible()
      const errorTool = page.locator('[data-component="card"][data-kind="tool-error-card"]').last()
      await expect(errorTool).toHaveScreenshot(`visual-error-open-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.05,
      })
    })

    test(`visual-shell-open ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openVisual(page, "visual-shell", theme)
      await page.getByRole("button", { name: "Shell bun typecheck Collapsed" }).press("Enter")
      await page.locator('[data-slot="scroll-view-viewport"]').focus()
      await settleDisclosures(page)
      await expect(page.getByRole("region", { name: "Tool output" })).toContainText("No errors found.")
      const shellTool = page.locator(
        '[data-timeline-key="assistant-part:part:assistant-shell:shell-output"] [data-component="tool-collapsible"]',
      )
      await expect(shellTool).toHaveScreenshot(`visual-shell-open-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.05,
      })
    })

    test(`jump-control ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await openVisual(page, "large", theme)
      await page.evaluate(() => window.timelineHarness.showJump())
      await expect(page.getByRole("button", { name: "Jump to latest message" })).toBeVisible()
      await settleVisual(page)
      await expect(page).toHaveScreenshot(`jump-control-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
      })
    })

    test(`hash-target ${theme} ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.goto(`/test-browser/timeline-harness.html?scenario=hash&theme=${theme}#message-user-250`)
      await page.waitForFunction(() => window.timelineHarness !== undefined)
      await expect(page.locator("#message-user-250")).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('[data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(0)
      await expect(page).toHaveScreenshot(`hash-target-${theme}-${size.name}.png`, {
        animations: "disabled",
        caret: "hide",
      })
    })
  }
}
