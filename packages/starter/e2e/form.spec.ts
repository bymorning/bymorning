import { FormScenario } from "@bymorning/testing/scenario/form"
import { Effect } from "effect"

import { expect, test } from "./fixture.js"

test("answers a real conditional Form with native required validation and returns focus to its first invalid field", async ({
  page,
  app,
}) => {
  await Effect.runPromise(FormScenario.create(app, app.data))

  const form = page.getByRole("form", { name: "Fixture details", exact: true })
  await expect(form).toBeVisible()
  const answer = form.getByRole("textbox", { name: "Answer", exact: true })
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(answer).toBeFocused()

  await answer.fill("yes")
  const conditional = form.getByRole("textbox", { name: "More", exact: true })
  await expect(conditional).toBeVisible()
  await conditional.fill("The condition was met")
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(form).toHaveCount(0)
})

test("uses the real Form service for integer answers instead of coercing a decimal browser value", async ({
  page,
  app,
}) => {
  await Effect.runPromise(FormScenario.createInteger(app, app.data))

  const form = page.getByRole("form", { name: "Fixture count", exact: true })
  await expect(form).toBeVisible()
  const count = form.getByRole("spinbutton", { name: "Count", exact: true })
  await count.fill("2.5")
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(count).toBeFocused()

  await count.fill("2")
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(form).toHaveCount(0)
})
