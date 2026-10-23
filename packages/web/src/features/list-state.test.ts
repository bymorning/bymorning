import { createRoot, createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"

import { createListController, type ListSourceState } from "./list-state"

type Item = { readonly id: string; readonly name: string }

const item: Item = { id: "build", name: "Build" }

describe("list state controller", () => {
  it("syncs on mount and retries", async () => {
    const sync = vi.fn(() => undefined)
    const controller = createRoot(() =>
      createListController<Item>({ sourceState: () => ({ state: "idle" }), list: () => undefined, sync }),
    )

    await Promise.resolve()
    expect(sync).toHaveBeenCalledTimes(1)
    controller.retry()
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it("projects loading, ready, empty, and error source outcomes", () => {
    const [items, setItems] = createSignal<ReadonlyArray<Item> | undefined>()
    const [sourceState, setSourceState] = createSignal<ListSourceState>({ state: "idle" })
    const controller = createRoot(() =>
      createListController<Item>({ sourceState, list: items, sync: () => Promise.resolve() }),
    )

    expect(controller.state()).toEqual({ status: "loading" })
    setItems([item])
    expect(controller.state()).toEqual({ status: "ready", items: [item] })
    setItems([])
    expect(controller.state()).toEqual({ status: "loading" })
    setSourceState({ state: "ready" })
    expect(controller.state()).toEqual({ status: "empty" })
    setItems(undefined)
    setSourceState({ state: "error", message: "Items unavailable" })
    expect(controller.state()).toEqual({ status: "error", message: "Items unavailable" })
  })

  it("shows cached items while refreshing and retains them when refresh fails", () => {
    const [sourceState, setSourceState] = createSignal<ListSourceState>({ state: "loading" })
    const items = [item]
    const controller = createRoot(() =>
      createListController<Item>({ sourceState, list: () => items, sync: () => Promise.resolve() }),
    )

    expect(controller.state()).toEqual({ status: "ready", items })
    setSourceState({ state: "error", message: "Items unavailable" })
    expect(controller.state()).toEqual({ status: "ready", items })
  })
})
