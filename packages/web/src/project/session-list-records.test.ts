import type { SessionInfo } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { describe, expect, it } from "vitest"

import { toSessionListItem, type SessionRecord } from "./session-list-records"

const projectID = Project.ID.create()
const project: Project.Info = {
  id: projectID,
  name: "Planning",
  time_created: 1,
  time_updated: 1,
}

describe("toSessionListItem", () => {
  it("shows Untitled for default New session titles", () => {
    expect(toSessionListItem(record({ title: "New session" })).title).toBe("Untitled")
    expect(toSessionListItem(record({ title: "New session - 2026-09-13T12:00:00.000Z" })).title).toBe("Untitled")
  })

  it("keeps a real title and child default", () => {
    expect(toSessionListItem(record({ title: "Morning plan" })).title).toBe("Morning plan")
    expect(
      toSessionListItem(record({ title: "New session", parentID: Session.ID.make(crypto.randomUUID()) })).title,
    ).toBe("Child session")
  })
})

function record(input: { readonly title: string; readonly parentID?: Session.ID }): SessionRecord {
  const session: SessionInfo = {
    id: Session.ID.make(crypto.randomUUID()),
    projectID,
    title: input.title,
    agent: Agent.DefaultID,
    model: { id: "model", provider: Provider.Name.make("test") },
    createdAt: new Date(1),
    updatedAt: new Date(1),
    ...(input.parentID === undefined ? {} : { parentID: input.parentID }),
  }
  return { session, project, projectName: project.name ?? "Untitled" }
}
