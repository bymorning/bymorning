import { Agent } from "@bymorning/schema/agent"
import { Provider } from "@bymorning/schema/provider"
import { createRoot } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createPromptState } from "../../context/prompt-state"
import { createComposerSubmit, createComposerSubmitState } from "./composer-submit"

describe("composer submission presentation", () => {
  it("validates selection without sending or clearing the draft", async () => {
    const mounted = createRoot((dispose) => {
      const prompt = createPromptState({ text: "Review" })
      const submit = vi.fn()
      const composer = createComposerSubmit({
        state: createComposerSubmitState(),
        adapter: { state: prompt, selection: () => undefined, pending: () => false, error: () => undefined, submit },
        attachments: { items: () => [], add: () => {}, remove: () => {}, disabled: () => false },
      })
      return { dispose, prompt, composer, submit }
    })
    try {
      await mounted.composer.submit()
      expect(mounted.composer.error()).toBe("An Agent and Model are required.")
      expect(mounted.prompt.current()).toBe("Review")
      expect(mounted.submit).not.toHaveBeenCalled()
    } finally {
      mounted.dispose()
    }
  })

  it("snapshots ready attachments and removes only those acknowledged", async () => {
    const mounted = createRoot((dispose) => {
      const prompt = createPromptState({ text: "Review" })
      const remove = vi.fn()
      const submit = vi.fn(async ({ text, submission }) => {
        expect(text).toBe('Review\n@"my notes.txt"')
        expect(remove).not.toHaveBeenCalled()
        submission.complete()
      })
      const composer = createComposerSubmit({
        state: createComposerSubmitState(),
        adapter: {
          state: prompt,
          selection: () => ({ agent: Agent.DefaultID, model: { provider: Provider.Bymorning, id: "model" } }),
          pending: () => false,
          error: () => undefined,
          submit,
        },
        attachments: {
          items: () => [{ id: "ready", state: "ready", path: "my notes.txt" }],
          add: () => {},
          remove,
          disabled: () => false,
        },
      })
      return { dispose, composer, remove }
    })
    try {
      await mounted.composer.submit()
      expect(mounted.remove).toHaveBeenCalledExactlyOnceWith("ready")
    } finally {
      mounted.dispose()
    }
  })
})
