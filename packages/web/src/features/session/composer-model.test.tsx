import { render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Provider } from "@bymorning/schema/provider"
import { createRoot } from "solid-js"
import { describe, expect, it } from "vitest"

import { createPromptState } from "../../context/prompt-state"
import { createComposerModel } from "./composer-model"
import { directoryFixture } from "../../test/directory"
import { createComposerSubmitState } from "./composer-submit"
import { Composer } from "./ui/session-composer"

describe("createComposerModel", () => {
  it("coordinates deferred semantic focus through the opaque Composer", async () => {
    const model = createRoot(() => {
      const prompt = createPromptState()
      return createComposerModel({
        directory: directoryFixture(),
        prompt,
        submissionState: createComposerSubmitState(),
        adapter: {
          pending: () => false,
          error: () => undefined,
          selection: () => ({ agent: Agent.DefaultID, model: { provider: Provider.Bymorning, id: "model" } }),
          submit: async () => {},
          interrupt: async () => {},
        },
        command: () => "submit",
        selection: {
          agent: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          model: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          variant: { options: () => [], current: () => undefined, pending: () => false, select: () => {} },
          error: () => undefined,
        },
        selectionVisibility: { agent: () => false, variant: () => false },
        projectFiles: { scope: () => undefined, list: () => [], search: async () => [] },
        skills: () => [],
        agents: () => [],

        write: async () => {},
      })
    })

    model.restoreFocus()
    render(() => <Composer model={model} />)
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Message" })).toHaveFocus())
  })
})
