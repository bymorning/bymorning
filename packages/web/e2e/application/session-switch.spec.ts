import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"
import { expectSessionReady, seedSessions, sessionPath, sidebar, sidebarOrder } from "./sessions.js"

test("switches between Sessions after a reload, including child to parent, without blanking the view", async ({
  page,
  app,
}) => {
  const failures: string[] = []
  page.on("pageerror", (error) => failures.push(error.message))
  const seeded = await seedSessions(app, ["Alpha budget", "Bravo roadmap", "Charlie hiring", "Delta launch"])
  const bravo = seeded[1]!
  const child = await Effect.runPromise(Chat.child(app, app.data, bravo.id, "Bravo helper"))
  const childTurn = { prompt: "Gather the Bravo facts", answer: "Bravo facts gathered" }
  await Effect.runPromise(Chat.converse(app, app.data, child.id, childTurn))

  const header = page.locator('[data-component="session-header"]')
  const timeline = page.locator('[data-component="message-timeline"]')
  const show = async (session: (typeof seeded)[number]) => {
    await expect(page).toHaveURL(new RegExp(`/session/${session.id}$`))
    await expectSessionReady(page)
    await expect(header.getByRole("button", { name: `Rename session ${session.title}`, exact: true })).toBeVisible()
    await expect(timeline.getByText(session.prompt, { exact: true })).toBeVisible()
    await expect(timeline.getByText(session.answer, { exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  }

  // The reload is what exposed the crash: every later switch started from a cold route.
  await page.reload()
  await show(seeded[0]!)
  await expect.poll(() => sidebarOrder(page)).toHaveLength(seeded.length)
  for (const session of [seeded[3]!, seeded[1]!, seeded[2]!, seeded[0]!, seeded[2]!]) {
    await sidebar(page)
      .locator(`a[href="${sessionPath(app, session.id)}"]`)
      .click()
    await show(session)
  }

  // A child Session opened cold, then back to its parent through the header.
  await page.goto(sessionPath(app, child.id))
  await expectSessionReady(page)
  await expect(timeline.getByText(childTurn.prompt, { exact: true })).toBeVisible()
  await expect(timeline.getByText(childTurn.answer, { exact: true })).toBeVisible()
  await header.getByRole("link", { name: bravo.title, exact: true }).click()
  await show(bravo)
  await sidebar(page)
    .locator(`a[href="${sessionPath(app, seeded[0]!.id)}"]`)
    .click()
  await show(seeded[0]!)

  await expect(page.getByRole("alert")).toHaveCount(0)
  expect(failures).toEqual([])
  await Effect.runPromise(app.llm.verify())
})

test("a follow-up in an older Session moves it to the top of the sidebar without a reload", async ({ page, app }) => {
  const seeded = await seedSessions(app, ["Alpha budget", "Bravo roadmap", "Charlie hiring"])
  const [alpha, bravo, charlie] = seeded.map((session) => sessionPath(app, session.id))
  const loads: string[] = []
  page.on("load", () => loads.push(page.url()))
  await expect.poll(() => sidebarOrder(page)).toEqual([charlie, bravo, alpha])

  // The open Session is the oldest. Its next run is announced to the sidebar before any list read.
  const followUp = { prompt: "Follow up on the budget", answer: "Budget updated.", gate: "alpha:follow-up", turn: 1 }
  await Effect.runPromise(Chat.reply(app, seeded[0]!.id, followUp))
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(followUp.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(followUp.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await expect.poll(() => sidebarOrder(page)).toEqual([alpha, charlie, bravo])

  await Effect.runPromise(app.llm.release(followUp.gate))
  await expect(page.locator('[data-component="message-timeline"]').getByText(followUp.answer)).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => sidebarOrder(page)).toEqual([alpha, charlie, bravo])
  expect(loads).toEqual([])
  await Effect.runPromise(app.llm.verify())
})
