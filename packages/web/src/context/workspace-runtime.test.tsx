import { ByMorning } from "@bymorning/client"
import { Project } from "@bymorning/schema/project"
import * as Workspace from "@bymorning/schema/workspace"
import { render } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { SDKProvider } from "./sdk"
import { useWorkspaceRuntime, WorkspaceRuntimeProvider } from "./workspace-runtime"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("restores and updates workspace-scoped draft metadata without tab persistence", () => {
  const values = new Map<string, string>([
    ["bymorning.tabs", "historical tabs"],
    ["bymorning.tabs.recent", "historical recent tab"],
  ])
  const reads: string[] = []
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      reads.push(key)
      return values.get(key) ?? null
    },
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  const client = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  const workspaceID = Workspace.ID.create()
  const firstProject = Project.ID.create()
  const secondProject = Project.ID.create()
  let runtime!: ReturnType<typeof useWorkspaceRuntime>
  const view = render(() => (
    <SDKProvider>
      <WorkspaceRuntimeProvider>
        {(() => {
          runtime = useWorkspaceRuntime()
          return <div />
        })()}
      </WorkspaceRuntimeProvider>
    </SDKProvider>
  ))

  const draft = runtime.draft.create(workspaceID, firstProject, { text: "Plan the morning" })
  expect(runtime.draft.get(draft.id)).toEqual(draft)
  expect(runtime.draft.update(draft, secondProject)).toEqual({ ...draft, projectID: secondProject })
  const prompt = runtime.prompt({ draftID: draft.id })
  expect(prompt).toBe(runtime.prompt({ draftID: draft.id }))
  expect(prompt.current()).toBe("Plan the morning")
  prompt.set("Reload-safe draft", 17)
  expect(reads).not.toContain("bymorning.tabs")
  expect(reads).not.toContain("bymorning.tabs.recent")
  expect(values.get("bymorning.tabs")).toBe("historical tabs")
  expect(values.get("bymorning.tabs.recent")).toBe("historical recent tab")

  view.unmount()
  const reloaded = render(() => (
    <SDKProvider>
      <WorkspaceRuntimeProvider>
        {(() => {
          runtime = useWorkspaceRuntime()
          return <div />
        })()}
      </WorkspaceRuntimeProvider>
    </SDKProvider>
  ))
  expect(runtime.draft.get(draft.id)).toEqual({ ...draft, projectID: secondProject })
  expect(runtime.prompt({ draftID: draft.id }).current()).toBe("Reload-safe draft")

  runtime.draft.remove(draft.id)
  expect(runtime.draft.get(draft.id)).toBeUndefined()
  reloaded.unmount()
})
