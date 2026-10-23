import { createRoot, createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { type CommandOption } from "../shell/commands/context"
import { createCommandDialogModel } from "./command-dialog-model"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("filters and groups local options, limits the empty query, and deduplicates searched identities", async () => {
  vi.useFakeTimers()
  const search = vi.fn().mockResolvedValue([
    { id: "local", title: "Remote duplicate", category: "Remote" },
    { id: "remote", title: "Remote match", category: "Remote" },
  ])
  const options: CommandOption[] = [
    { id: "local", title: "Needle local", category: "Local" },
    { id: "description", title: "Second", description: "Needle description", category: "Local" },
    { id: "category", title: "Third", category: "Needle category" },
    { id: "fourth", title: "Fourth" },
    { id: "fifth", title: "Fifth" },
    { id: "sixth", title: "Sixth" },
  ]
  let dispose: () => void = () => undefined
  const model = createRoot((rootDispose) => {
    dispose = rootDispose
    return createCommandDialogModel({ options: () => options, search: () => search })
  })

  expect(model.entries().map((entry) => entry.id)).toEqual(["local", "description", "category", "fourth", "fifth"])
  model.setQuery("  needle  ")
  expect(model.entries().map((entry) => entry.id)).toEqual(["local", "description", "category"])
  await vi.advanceTimersByTimeAsync(100)
  expect(search).toHaveBeenCalledWith("needle", expect.any(AbortSignal))
  expect(model.entries().map((entry) => entry.id)).toEqual(["local", "description", "category", "remote"])
  expect(model.groupedEntries().map((group) => group.category)).toEqual(["Local", "Needle category", "Remote"])
  dispose()
})

it("can show every option for an empty query", () => {
  const options: CommandOption[] = Array.from({ length: 7 }, (_, index) => ({
    id: `item-${index + 1}`,
    title: `Item ${index + 1}`,
  }))
  let dispose: () => void = () => undefined
  const model = createRoot((rootDispose) => {
    dispose = rootDispose
    return createCommandDialogModel({ options: () => options, initialLimit: null, search: () => undefined })
  })

  expect(model.entries()).toEqual(options)
  dispose()
})

it("aborts superseded searches and never commits their completion", async () => {
  vi.useFakeTimers()
  const requests: Array<{
    query: string
    signal: AbortSignal
    resolve: (entries: ReadonlyArray<CommandOption>) => void
  }> = []
  const search = vi.fn(
    (query: string, signal: AbortSignal) =>
      new Promise<ReadonlyArray<CommandOption>>((resolve) => requests.push({ query, signal, resolve })),
  )
  let dispose: () => void = () => undefined
  const model = createRoot((rootDispose) => {
    dispose = rootDispose
    return createCommandDialogModel({ options: () => [], search: () => search })
  })

  model.setQuery("first")
  await vi.advanceTimersByTimeAsync(100)
  model.setQuery("second")
  expect(requests[0]?.signal.aborted).toBe(true)
  requests[0]?.resolve([{ id: "stale", title: "Stale" }])
  await Promise.resolve()
  expect(model.entries()).toEqual([])

  await vi.advanceTimersByTimeAsync(100)
  requests[1]?.resolve([{ id: "current", title: "Current" }])
  await Promise.resolve()
  expect(requests.map((request) => request.query)).toEqual(["first", "second"])
  expect(model.entries().map((entry) => entry.id)).toEqual(["current"])
  dispose()
})

it("retains active identity across replacement, falls back first, and owns preview cleanup", () => {
  const cleanup = { first: vi.fn(), second: vi.fn(), third: vi.fn() }
  const highlight = {
    first: vi.fn(() => cleanup.first),
    second: vi.fn(() => cleanup.second),
    third: vi.fn(() => cleanup.third),
  }
  const [options, setOptions] = createSignal<ReadonlyArray<CommandOption>>([
    { id: "first", title: "First", onHighlight: highlight.first },
    { id: "second", title: "Second", onHighlight: highlight.second },
    { id: "third", title: "Third", onHighlight: highlight.third },
  ])
  let dispose: () => void = () => undefined
  const model = createRoot((rootDispose) => {
    dispose = rootDispose
    return createCommandDialogModel({ options, search: () => undefined })
  })

  expect(model.activeEntry()?.id).toBe("first")
  model.move(1)
  expect(model.activeEntry()?.id).toBe("second")
  expect(cleanup.first).toHaveBeenCalledOnce()

  setOptions([options()[2]!, options()[1]!, options()[0]!])
  expect(model.activeEntry()?.id).toBe("second")
  expect(cleanup.second).not.toHaveBeenCalled()

  setOptions([options()[0]!, options()[2]!])
  expect(model.activeEntry()?.id).toBe("third")
  expect(cleanup.second).toHaveBeenCalledOnce()
  dispose()
  expect(cleanup.third).toHaveBeenCalledOnce()
})

it("commits the active preview before selection without cleaning it up", () => {
  const events: string[] = []
  const cleanup = vi.fn(() => events.push("cleanup"))
  let dispose: () => void = () => undefined
  const model = createRoot((rootDispose) => {
    dispose = rootDispose
    return createCommandDialogModel({
      search: () => undefined,
      options: () => [
        {
          id: "selected",
          title: "Selected",
          onHighlight: () => {
            events.push("highlight")
            return cleanup
          },
          onSelect: (source) => events.push(`select:${source}`),
        },
      ],
    })
  })

  model.select(model.activeEntry(), () => events.push("before"))
  dispose()
  expect(events).toEqual(["highlight", "before", "select:palette"])
  expect(cleanup).not.toHaveBeenCalled()
})
