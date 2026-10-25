import { createRoot, createSignal } from "solid-js"
import { describe, expect, it } from "vitest"

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
})
