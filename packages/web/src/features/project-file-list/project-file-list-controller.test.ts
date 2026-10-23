import { createRoot, createSignal } from "solid-js"
import { describe, expect, it } from "vitest"

import type { ListSourceState } from "../list-state"
import type { ProjectFileListItem } from "./project-file-list-model"
import { createProjectFileListController } from "./project-file-list-controller"

describe("project file list controller", () => {
  it("projects selection and loading state without owning a request", () => {
    const [projectID, setProjectID] = createSignal<string>()
    const [items, setItems] = createSignal<ReadonlyArray<ProjectFileListItem>>([])
    const controller = createRoot(() =>
      createProjectFileListController({
        projectID,
        sourceState: () => ({ state: "loading" }),
        list: items,
      }),
    )

    expect(controller.state()).toEqual({ status: "no-project" })
    setProjectID("alpha")
    expect(controller.state()).toEqual({ status: "loading" })
    setProjectID("beta")

    setItems([{ path: "current.ts" }])
    expect(controller.state()).toEqual({ status: "ready", items: [{ path: "current.ts" }] })
  })

  it("projects empty and error source outcomes", () => {
    const [projectID, setProjectID] = createSignal<string | undefined>("empty")
    const [sourceState, setSourceState] = createSignal<ListSourceState>({ state: "ready" })
    const controller = createRoot(() =>
      createProjectFileListController({
        projectID,
        sourceState,
        list: () => [],
      }),
    )

    expect(controller.state()).toEqual({ status: "empty" })
    setProjectID("broken")
    setSourceState({ state: "error", message: "Files unavailable" })
    expect(controller.state()).toEqual({ status: "error", message: "Files unavailable" })
  })

  it("shows cached files while refreshing and retains them when refresh fails", () => {
    const [sourceState, setSourceState] = createSignal<ListSourceState>({ state: "loading" })
    const controller = createRoot(() =>
      createProjectFileListController({
        projectID: () => "alpha",
        sourceState,
        list: () => [{ path: "cached.ts" }],
      }),
    )

    expect(controller.state()).toEqual({ status: "ready", items: [{ path: "cached.ts" }] })
    setSourceState({ state: "error", message: "Files unavailable" })
    expect(controller.state()).toEqual({ status: "ready", items: [{ path: "cached.ts" }] })
  })
})
