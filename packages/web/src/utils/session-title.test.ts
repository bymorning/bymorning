import type { SessionInfo } from "@bymorning/client"
import { Session } from "@bymorning/schema/session"
import { describe, expect, it } from "vitest"

import { sessionLabel, sessionTitle } from "./session-title"

const root = { title: "New session" } satisfies Pick<SessionInfo, "title" | "parentID">
const child = {
  title: "New session",
  parentID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
} satisfies Pick<SessionInfo, "title" | "parentID">

describe("sessionTitle", () => {
  it("treats empty and default New session titles as untitled", () => {
    expect(sessionTitle(undefined)).toBeUndefined()
    expect(sessionTitle("")).toBeUndefined()
    expect(sessionTitle("   ")).toBeUndefined()
    expect(sessionTitle("New session")).toBeUndefined()
    expect(sessionTitle("New session - 2026-09-13T12:00:00.000Z")).toBeUndefined()
  })

  it("keeps Child session defaults and real titles", () => {
    expect(sessionTitle("Child session")).toBe("Child session")
    expect(sessionTitle("Child session - 2026-09-13T12:00:00.000Z")).toBe("Child session")
    expect(sessionTitle("Morning plan")).toBe("Morning plan")
    expect(sessionTitle("New session ideas")).toBe("New session ideas")
  })
})

describe("sessionLabel", () => {
  it("labels untitled roots Untitled instead of New session", () => {
    expect(sessionLabel(root)).toBe("Untitled")
    expect(sessionLabel({ ...root, title: "" })).toBe("Untitled")
    expect(sessionLabel({ ...root, title: "Morning plan" })).toBe("Morning plan")
  })

  it("labels untitled children Child session", () => {
    expect(sessionLabel(child)).toBe("Child session")
    expect(sessionLabel({ ...child, title: "Research" })).toBe("Research")
  })
})
