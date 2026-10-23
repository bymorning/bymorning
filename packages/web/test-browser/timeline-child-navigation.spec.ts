import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => page.goto("/test-browser/timeline-harness.html"))

test("navigates child Sessions directly in intent order", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/src/session/route.tsx"
    const { createSessionNavigation } = (await import(modulePath)) as typeof import("../src/session/route")
    const navigated: string[] = []
    const navigation = createSessionNavigation({
      workspaceID: () => "wrk_default" as never,
      navigate: (target) => { navigated.push(target) },
    })
    navigation.open("00000000-0000-4000-8000-000000000002")
    navigation.open("00000000-0000-4000-8000-000000000003")
    return navigated
  })
  expect(result).toEqual([
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ])
})
