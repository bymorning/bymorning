import type { Page } from "@playwright/test"
import type { TestApp } from "@bymorning/testing/application"
import { Chat } from "@bymorning/testing/scenario/chat"
import type { Session } from "@bymorning/schema/session"
import { Effect } from "effect"
import { expect } from "../fixtures/app.js"

type Application = TestApp.Interface & { readonly data: Chat.Data }

/** A persisted root Session with one completed turn. */
export interface Seeded {
  readonly id: Session.ID
  readonly title: string
  readonly prompt: string
  readonly answer: string
}

/**
 * Persist completed conversations through the public Session services and scripted model.
 * The fixture's own Session comes first (oldest), so the sidebar lists them in reverse.
 */
export async function seedSessions(app: Application, titles: ReadonlyArray<string>): Promise<ReadonlyArray<Seeded>> {
  const seeded: Seeded[] = []
  for (const [index, title] of titles.entries()) {
    const session = index === 0 ? app.data.session : await Effect.runPromise(Chat.open(app, app.data))
    const turn = {
      prompt: `Question about ${title}`,
      answer: `Answer about ${title}`,
      title,
    }
    await Effect.runPromise(Chat.converse(app, app.data, session.id, turn))
    seeded.push({ id: session.id, title, prompt: turn.prompt, answer: turn.answer })
  }
  return seeded
}

/** Workspace Session rows in the order the sidebar presents them. */
export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Workspace navigation", exact: true })

/** Hrefs of the Sessions listed in the sidebar, top to bottom. */
export const sidebarOrder = (page: Page) =>
  sidebar(page)
    .locator('a[href*="/session/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")))

/** The Session route for an identity in this test's workspace. */
export const sessionPath = (app: Application, id: string) => `/w/${app.data.owner.properties.workspaceID}/session/${id}`

/** Wait until a Session screen has synchronized and its transcript is rendered. */
export async function expectSessionReady(page: Page) {
  const workspace = page.locator('[data-component="session-workspace"]')
  await expect(workspace).toHaveAttribute("data-session-sync", "ready")
  await expect(workspace).toHaveAttribute("data-transcript-state", "ready")
}

/** Confirm the "Archive session?" dialog opened by any archive entry point. */
export async function confirmArchive(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Archive session?", exact: true })
  await dialog.getByRole("button", { name: "Archive session", exact: true }).click()
  await expect(dialog).toBeHidden()
}
