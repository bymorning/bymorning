import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { createRoot } from "solid-js"
import { describe, expect, it } from "vitest"

import { createDraftPromptSession, createPromptSession } from "../../context/prompt-state"
import type { SyncStorage } from "../../runtime/persistence/storage"
import { createPromptSubmissionState } from "./prompt-submission-state"

const storage: SyncStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
const sessionScope = () => ({
  workspaceID: Workspace.ID.create(),
  projectID: Project.ID.create(),
  sessionID: Session.ID.make(crypto.randomUUID()),
})

describe("createPromptSubmissionState", () => {
  it("does not clear or restore over edits made before deferred mutation execution", () =>
    createRoot((dispose) => {
      const target = createPromptSession(sessionScope(), { text: "submitted" }, storage)
      const submission = createPromptSubmissionState({ target })
      target.set("new edit", 3)
      submission.clear()
      expect(target.current()).toBe("new edit")
      expect(target.cursor()).toBe(3)
      expect(submission.restore()).toBeUndefined()
      dispose()
    }))

  it("uses an explicit effective selection instead of the PromptTarget selection", () =>
    createRoot((dispose) => {
      const draft = createDraftPromptSession("draft", { text: "Plan" }, storage)
      const selection = {
        agent: Agent.DefaultID,
        model: { provider: Provider.Bymorning, id: "fallback", variant: "fast" },
      }

      const submission = createPromptSubmissionState({ target: draft, selection })

      expect(submission.selection).toBe(selection)
      dispose()
    }))

  it("captures prompt selection, retargets context, and restores against the Session target", () =>
    createRoot((dispose) => {
      const draft = createDraftPromptSession(
        "draft",
        {
          text: "Plan the morning",
          cursor: 8,
          agent: Agent.DefaultID,
          model: { provider: Provider.Bymorning, id: "model", variant: null },
        },
        storage,
      )
      const session = createPromptSession(sessionScope(), { text: "stale" }, storage)
      const submission = createPromptSubmissionState({ target: draft })

      expect(submission.prompt).toBe("Plan the morning")
      expect(submission.cursor).toBe(8)
      expect(submission.selection).toEqual({
        agent: Agent.DefaultID,
        model: { provider: Provider.Bymorning, id: "model", variant: null },
      })
      expect(submission.current(draft)).toBe(true)

      submission.retarget(session)
      expect(submission.current(session)).toBe(true)
      expect(session.selection.current()).toEqual(submission.selection)
      submission.clear()
      expect(draft.current()).toBe("Plan the morning")
      expect(session.current()).toBe("")

      const restored = submission.restore()
      expect(restored?.target).toBe(session)
      if (restored) restored.target.restoreContent(restored.content)
      expect(session.current()).toBe("Plan the morning")
      expect(session.cursor()).toBe(8)
      dispose()
    }))

  it("refuses to overwrite edits made after the submitted prompt was cleared", () =>
    createRoot((dispose) => {
      const session = createPromptSession(sessionScope(), { text: "submitted" }, storage)
      const submission = createPromptSubmissionState({ target: session })

      submission.clear()
      session.set("newer edit", 10)

      expect(submission.restore()).toBeUndefined()
      expect(session.current()).toBe("newer edit")
      dispose()
    }))

  it("restores unchanged content without overwriting a newer selection", () =>
    createRoot((dispose) => {
      const session = createPromptSession(
        sessionScope(),
        {
          text: "submitted",
          agent: Agent.DefaultID,
          model: { provider: Provider.Bymorning, id: "old" },
        },
        storage,
      )
      const submission = createPromptSubmissionState({ target: session })

      submission.clear()
      session.selection.set({
        agent: Agent.ID.make("review"),
        model: { provider: Provider.Bymorning, id: "new", variant: "fast" },
      })

      const restored = submission.restore()
      expect(restored).toBeDefined()
      if (restored) restored.target.restoreContent(restored.content)
      expect(session.current()).toBe("submitted")
      expect(session.selection.current()).toEqual({
        agent: Agent.ID.make("review"),
        model: { provider: Provider.Bymorning, id: "new", variant: "fast" },
      })
      dispose()
    }))

  it("refuses to overwrite newer Agent mentions after the submitted prompt was cleared", () =>
    createRoot((dispose) => {
      const submitted = [{ name: "Review Agent", mention: { start: 0, end: 13, text: "@Review Agent" } }]
      const session = createPromptSession(
        sessionScope(),
        { text: "@Review Agent", cursor: 13, agents: submitted },
        storage,
      )
      const submission = createPromptSubmissionState({ target: session })

      submission.clear()
      session.set("@General", 8, [{ name: "General", mention: { start: 0, end: 8, text: "@General" } }])

      expect(submission.restore()).toBeUndefined()
      expect(session.current()).toBe("@General")
      expect(session.agents.current()).toEqual([{ name: "General", mention: { start: 0, end: 8, text: "@General" } }])
      dispose()
    }))
})
