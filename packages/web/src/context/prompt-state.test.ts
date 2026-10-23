import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { createRoot } from "solid-js"
import { describe, expect, it } from "vitest"

import type { AsyncStorage, SyncStorage } from "../runtime/persistence/storage"
import { createDraftPromptSession, createPromptSession, createPromptState, promptStorageKey } from "./prompt-state"

const workspaceID = Workspace.ID.create()
const projectID = Project.ID.create()
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")

const syncStorage = (values: Map<string, string>): SyncStorage => ({
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
})

describe("prompt state", () => {
  it("initializes text, cursor, Agent, and a cloned Model selection", () =>
    createRoot((dispose) => {
      const model = { provider: Provider.Bymorning, id: "model", variant: "fast" }
      const prompt = createPromptState({ text: "hello", agent: Agent.DefaultID, model })

      expect(prompt.current()).toBe("hello")
      expect(prompt.cursor()).toBe(5)
      expect(prompt.agent.current()).toBe(Agent.DefaultID)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      expect(prompt.ready()).toBe(true)
      dispose()
    }))

  it("persists structured Agent ranges with the draft text", () =>
    createRoot((dispose) => {
      const values = new Map<string, string>()
      const storage = syncStorage(values)
      const agents = [{ name: "Review Agent", mention: { start: 0, end: 13, text: "@Review Agent" } }]
      const prompt = createDraftPromptSession("agents", undefined, storage)

      prompt.set("@Review Agent this", 18, agents)
      const restored = createDraftPromptSession("agents", undefined, storage)

      expect(restored.current()).toBe("@Review Agent this")
      expect(restored.agents.current()).toEqual(agents)
      dispose()
    }))

  it("tracks content revisions independently from Agent and Model selection", () =>
    createRoot((dispose) => {
      const agents = [{ name: "Review Agent", mention: { start: 0, end: 13, text: "@Review Agent" } }]
      const prompt = createPromptState({ text: "@Review Agent", cursor: 13, agents, agent: Agent.DefaultID })
      const content = prompt.contentRevision()
      const revision = prompt.revision()

      prompt.selection.set({
        agent: Agent.ID.make("review"),
        model: { provider: Provider.Bymorning, id: "new" },
      })
      expect(prompt.contentRevision()).toBe(content)
      expect(prompt.revision()).not.toBe(revision)

      prompt.set("changed", 7, agents)
      expect(prompt.contentRevision()).not.toBe(content)
      const changed = prompt.contentRevision()
      prompt.agents.set([{ name: "General" }])
      expect(prompt.contentRevision()).not.toBe(changed)
      dispose()
    }))

  it("preserves explicit Default variants while leaving an absent choice absent", () =>
    createRoot((dispose) => {
      const prompt = createPromptState()
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()

      prompt.model.set({ provider: Provider.Bymorning, id: "model", variant: null })
      expect(prompt.model.current()).toEqual({ provider: Provider.Bymorning, id: "model", variant: null })
      prompt.model.set({ provider: Provider.Bymorning, id: "model" })
      expect(prompt.model.current()).toEqual({ provider: Provider.Bymorning, id: "model" })
      expect(prompt.model.current()).not.toHaveProperty("variant")
      dispose()
    }))

  it("exposes asynchronous hydration readiness before editor writes", async () => {
    const pending = Promise.withResolvers<string | null>()
    const storage: AsyncStorage = {
      getItem: () => pending.promise,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    }
    const mounted = createRoot((dispose) => ({
      prompt: createDraftPromptSession("hydrated", { text: "fallback" }, storage),
      dispose,
    }))

    expect(mounted.prompt.ready()).toBe(false)
    pending.resolve(JSON.stringify({ version: 2, text: "stored", cursor: 3 }))
    await mounted.prompt.ready.promise
    expect(mounted.prompt.ready()).toBe(true)
    expect(mounted.prompt.current()).toBe("stored")
    expect(mounted.prompt.cursor()).toBe(3)
    mounted.dispose()
  })

  it("validates malformed documents and isolates draft and Session scopes", () =>
    createRoot((dispose) => {
      const values = new Map<string, string>()
      const storage = syncStorage(values)
      const draft = createDraftPromptSession("same-id", undefined, storage)
      const session = createPromptSession({ workspaceID, projectID, sessionID }, undefined, storage)
      const otherSession = createPromptSession(
        { workspaceID, projectID: Project.ID.create(), sessionID },
        undefined,
        storage,
      )

      draft.set("draft text", 10)
      session.set("session text", 12)
      expect(createDraftPromptSession("same-id", undefined, storage).current()).toBe("draft text")
      expect(createPromptSession({ workspaceID, projectID, sessionID }, undefined, storage).current()).toBe(
        "session text",
      )
      expect(otherSession.current()).toBe("")
      expect(promptStorageKey({ draftID: "same-id" })).toBe("bymorning.draft:same-id:prompt")

      const oldKey = promptStorageKey({ draftID: "old" })
      values.set(
        oldKey,
        JSON.stringify({
          version: 1,
          text: "legacy",
          agent: "agt_build",
          model: { providerID: "prv_bymorning", id: "model" },
        }),
      )
      expect(createDraftPromptSession("old", { text: "safe" }, storage).current()).toBe("safe")
      expect(values.has(oldKey)).toBe(false)

      const oldNamesKey = promptStorageKey({ draftID: "old-names" })
      values.set(
        oldNamesKey,
        JSON.stringify({
          version: 1,
          text: "legacy names",
          agent: Agent.DefaultID,
          model: { provider: Provider.Bymorning, id: "model" },
        }),
      )
      expect(createDraftPromptSession("old-names", { text: "safe names" }, storage).current()).toBe("safe names")
      expect(values.has(oldNamesKey)).toBe(false)

      const malformedKey = promptStorageKey({ draftID: "malformed" })
      values.set(malformedKey, JSON.stringify({ version: 2, text: 42 }))
      expect(createDraftPromptSession("malformed", { text: "safe" }, storage).current()).toBe("safe")
      expect(values.has(malformedKey)).toBe(false)
      dispose()
    }))
})
