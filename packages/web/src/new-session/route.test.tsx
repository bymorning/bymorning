import { Project } from "@bymorning/schema/project"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"

import { useWorkspaceRuntime, WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { WorkspaceScope } from "../context/workspace"
import { Persist } from "../runtime/persistence/storage"
import { NewSessionRoute } from "./route"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const projectID = Project.ID.create()

function createDraft(workspaceID: Workspace.ID, project = projectID) {
  let runtime!: ReturnType<typeof useWorkspaceRuntime>
  const view = render(() => (
    <WorkspaceRuntimeProvider>
      {(() => {
        runtime = useWorkspaceRuntime()
        return <div />
      })()}
    </WorkspaceRuntimeProvider>
  ))
  const draft = runtime.draft.create(workspaceID, project)
  view.unmount()
  return draft
}

function mount(path: string) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const view = render(() => (
    <WorkspaceRuntimeProvider>
      <WorkspaceScope list={[workspace]} current={workspace}>
        <MemoryRouter history={history}>
          <Route path="/w/:workspaceID">
            <Route path="/" component={() => <h1>Overview</h1>} />
            <Route path="/new-session" component={NewSessionRoute} />
          </Route>
        </MemoryRouter>
      </WorkspaceScope>
    </WorkspaceRuntimeProvider>
  ))
  return { history, unmount: view.unmount }
}

afterEach(() => {
  localStorage.clear()
  cleanup()
})

describe("NewSessionRoute", () => {
  it("replaces a missing draftId with Overview and never leaves a blank new-session route", async () => {
    const mounted = mount(`/w/${workspace.id}/new-session`)

    await waitFor(() => expect(mounted.history.get()).toBe(`/w/${workspace.id}`))
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "This draft cannot be found." })).not.toBeInTheDocument()
    mounted.unmount()
  })

  it("replaces an unknown draftId with Overview", async () => {
    const mounted = mount(`/w/${workspace.id}/new-session?draftId=missing-draft`)

    await waitFor(() => expect(mounted.history.get()).toBe(`/w/${workspace.id}`))
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument()
    mounted.unmount()
  })

  it("replaces a stale draft owned by another workspace with Overview", async () => {
    const draft = createDraft(Workspace.ID.create())
    const mounted = mount(`/w/${workspace.id}/new-session?draftId=${encodeURIComponent(draft.id)}`)

    await waitFor(() => expect(mounted.history.get()).toBe(`/w/${workspace.id}`))
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument()
    mounted.unmount()
  })

  it("replaces an unreadable stored draft with Overview", async () => {
    localStorage.setItem(Persist.draft("stale-draft", "metadata").key, "not-json")
    const mounted = mount(`/w/${workspace.id}/new-session?draftId=stale-draft`)

    await waitFor(() => expect(mounted.history.get()).toBe(`/w/${workspace.id}`))
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument()
    mounted.unmount()
  })
})
