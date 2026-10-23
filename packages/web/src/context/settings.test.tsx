import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import { afterEach, expect, it } from "vitest"

import { SETTINGS_STORAGE_KEY, SettingsProvider, useSettings } from "./settings"

afterEach(cleanup)

it("defaults missing persisted visibility settings to hidden and persists toggles", () => {
  let saved = JSON.stringify({ general: { showReasoningSummaries: false }, keybinds: {} })
  const storage = {
    getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? saved : null),
    setItem: (_key: string, value: string) => {
      saved = value
    },
    removeItem: () => undefined,
  }
  function Harness() {
    const settings = useSettings()
    return (
      <>
        <output
          data-testid="settings"
          data-agent={settings.general.showAgent}
          data-markdown={settings.general.renderMarkdown}
          data-variant={settings.general.showModelVariant}
          data-reasoning={settings.general.showReasoningSummaries}
          data-usage={settings.general.showSessionUsage}
        />
        <button type="button" onClick={settings.general.toggleAgent}>
          Toggle agent
        </button>
        <button type="button" onClick={settings.general.toggleMarkdown}>
          Toggle Markdown
        </button>
        <button type="button" onClick={settings.general.toggleVariant}>
          Toggle variant
        </button>
        <button type="button" onClick={settings.general.toggleSessionUsage}>
          Toggle usage
        </button>
      </>
    )
  }

  render(() => (
    <SettingsProvider storage={storage}>
      <Harness />
    </SettingsProvider>
  ))

  expect(screen.getByTestId("settings")).toHaveAttribute("data-agent", "false")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-markdown", "true")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-variant", "false")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-reasoning", "false")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-usage", "false")

  fireEvent.click(screen.getByRole("button", { name: "Toggle agent" }))
  fireEvent.click(screen.getByRole("button", { name: "Toggle Markdown" }))
  fireEvent.click(screen.getByRole("button", { name: "Toggle variant" }))
  fireEvent.click(screen.getByRole("button", { name: "Toggle usage" }))
  expect(screen.getByTestId("settings")).toHaveAttribute("data-agent", "true")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-markdown", "false")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-variant", "true")
  expect(screen.getByTestId("settings")).toHaveAttribute("data-usage", "true")
  expect(JSON.parse(saved)).toMatchObject({
    general: { showAgent: true, showModelVariant: true, renderMarkdown: false, showSessionUsage: true },
  })
})

it("creates picker visibility storage when persisted settings predate picker preferences", () => {
  let saved = JSON.stringify({ general: {}, keybinds: {} })
  const storage = {
    getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? saved : null),
    setItem: (_key: string, value: string) => {
      saved = value
    },
    removeItem: () => undefined,
  }
  function Harness() {
    const settings = useSettings()
    return (
      <button type="button" onClick={() => settings.picker.set("provider:model", "show")}>
        Show model
      </button>
    )
  }

  render(() => (
    <SettingsProvider storage={storage}>
      <Harness />
    </SettingsProvider>
  ))
  fireEvent.click(screen.getByRole("button", { name: "Show model" }))

  expect(JSON.parse(saved)).toMatchObject({ picker: { "provider:model": "show" } })
})
