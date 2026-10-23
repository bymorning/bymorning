import { fireEvent, render, screen } from "@solidjs/testing-library"
import { Provider } from "@bymorning/schema/provider"
import { describe, expect, it } from "vitest"
import { SettingsProvider } from "../context/settings"
import { createVisibility, latestModels } from "./model-visibility"
import type { ModelOption } from "./model-option"

const model = (id: string, releaseDate?: string, family?: string, provider = "openai"): ModelOption => ({
  id,
  name: id,
  provider: Provider.Name.make(provider),
  providerLabel: provider,
  variants: [],
  limit: { context: 100 },
  ...(releaseDate === undefined ? {} : { releaseDate }),
  ...(family === undefined ? {} : { family }),
})

describe("OpenCode web picker visibility", () => {
  it("uses casual months, includes near-future releases, skips undefined families and keeps source order on ties", () => {
    const now = new Date(2026, 8, 13).valueOf()
    const models = [
      model("old", "2026-01-01", "old"),
      model("first", "2026-09-01", "same"),
      model("tie", "2026-09-01", "same"),
      model("future", "2026-10-01", "same"),
      model("other", "2026-09-01", "same", "groq"),
      model("familyless", "2026-09-12"),
      model("invalid", "not-a-date", "invalid"),
      model("missing"),
      model("boundary", "2026-03-17", "boundary"),
      model("inside", "2026-03-18", "inside"),
      model("tie-first", "2026-09-01", "tie"),
      model("tie-last", "2026-09-01", "tie"),
    ]
    expect([...latestModels(models, now)]).toEqual(["openai:future", "groq:other", "openai:inside", "openai:tie-first"])
  })

  it("persists explicit show and hide and preserves the latest name badge", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    const old = model("Old (latest)", "2020-01-01", "old")
    const invalid = model("Unknown", "invalid")
    const Probe = () => {
      const visibility = createVisibility(() => [old, invalid])
      return (
        <>
          <output data-testid="old">{String(visibility.visible(old))}</output>
          <output data-testid="unknown">{String(visibility.visible(invalid))}</output>
          <output data-testid="label">{visibility.option(old).label}</output>
          <output data-testid="badge">{String(visibility.option(old).latest)}</output>
          <button onClick={() => visibility.set(old, true)}>Select old</button>
          <button onClick={() => visibility.set(old, false)}>Hide old</button>
          <button onClick={() => visibility.set(invalid, false)}>Hide unknown</button>
        </>
      )
    }
    const mount = () =>
      render(() => (
        <SettingsProvider storage={storage}>
          <Probe />
        </SettingsProvider>
      ))
    const first = mount()
    expect(screen.getByTestId("old")).toHaveTextContent("false")
    expect(screen.getByTestId("unknown")).toHaveTextContent("true")
    expect(screen.getByTestId("label")).toHaveTextContent("Old")
    expect(screen.getByTestId("badge")).toHaveTextContent("true")
    fireEvent.click(screen.getByText("Select old"))
    expect(screen.getByTestId("old")).toHaveTextContent("true")
    fireEvent.click(screen.getByText("Hide unknown"))
    first.unmount()
    const second = mount()
    expect(screen.getByTestId("old")).toHaveTextContent("true")
    expect(screen.getByTestId("unknown")).toHaveTextContent("false")
    fireEvent.click(screen.getByText("Hide old"))
    expect(screen.getByTestId("old")).toHaveTextContent("false")
    second.unmount()
  })
})
