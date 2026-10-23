import { render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createRoot, createSignal } from "solid-js"
import { describe, expect, it } from "vitest"

import { createPromptState } from "../../../context/prompt-state"
import { createComposerModel } from "../composer-model"
import { directoryFixture } from "../../../test/directory"
import { createComposerSubmitState } from "../composer-submit"
import { SessionComposerRegion } from "./session-composer-region"
import { SessionPermission } from "./session-permission"

describe("SessionPermission", () => {
  it("moves focus on request changes only after composer engagement and returns it after resolution", async () => {
    const [item, setItem] = createSignal<ReturnType<SessionPermission.Model["item"]>>()
    const [error, setError] = createSignal<string>()
    const composer = createRoot(() => {
      const prompt = createPromptState()
      return createComposerModel({
        directory: directoryFixture(),
        prompt,
        submissionState: createComposerSubmitState(),
        adapter: {
          pending: () => false,
          error: () => undefined,
          selection: () => undefined,
          submit: async () => {},
          interrupt: async () => {},
        },
        command: () => "submit",
        slashCommands: { search: () => undefined, select: () => false },
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
    const permission: SessionPermission.Model = {
      item,
      pending: () => false,
      error,
      reply: () => setItem(undefined),
    }
    render(() => <SessionComposerRegion composer={composer} permission={permission} />)
    const input = screen.getByRole("combobox", { name: "Message" })
    input.focus()
    setItem({ id: "one", title: "read", action: "read", resources: [] })
    await waitFor(() => expect(screen.getByRole("button", { name: "Once" })).toHaveFocus())
    setError("Permission failed")
    expect(screen.getByRole("alert")).toHaveTextContent("Permission failed")
    setError(undefined)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    setItem({ id: "two", title: "write", action: "write", resources: [] })
    await waitFor(() => expect(screen.getByRole("button", { name: "Once" })).toHaveFocus())
    screen.getByRole("button", { name: "Once" }).click()
    await waitFor(() => expect(input).toHaveFocus())
  })
})
