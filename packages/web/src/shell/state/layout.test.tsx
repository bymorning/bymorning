import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"

import { WorkspaceScope } from "../../context/workspace"
import type { SyncStorage } from "../../runtime/persistence/storage"
import { LayoutProvider, useLayout, type Layout } from "./layout"

const values = new Map<string, string>()
const storage: SyncStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}

afterEach(() => {
  cleanup()
  values.clear()
})

describe("Layout", () => {
  it("persists one workspace-scoped layout document", () => {
    const workspaceID = Workspace.ID.create()
    const layout = mount(workspaceID)

    expect(layout.sidebar.opened()).toBe(true)
    expect(layout.sidebar.width()).toBe(256)
    expect(layout.session.width()).toBe(600)
    expect(layout.rightSidebar.opened()).toBe(false)

    layout.sidebar.close()
    layout.sidebar.resize(320)
    layout.session.resize(760)
    layout.rightSidebar.open()
    expect(layout.rightSidebar.tree()).toBe(true)

    expect(JSON.parse(values.get(`bymorning.workspace:${workspaceID}:layout`)!)).toEqual({
      version: 2,
      sidebar: { opened: false, width: 320 },
      session: { width: 760 },
      rightSidebar: { opened: true, tree: true },
    })
  })

  it("persists whether the file tree is shown", () => {
    const workspaceID = Workspace.ID.create()
    mount(workspaceID).rightSidebar.showTree(false)
    cleanup()

    expect(mount(workspaceID).rightSidebar.tree()).toBe(false)
  })

  it("accepts a legacy extra home field, strips it on write, and rejects malformed documents", () => {
    const workspaceID = Workspace.ID.create()
    const key = `bymorning.workspace:${workspaceID}:layout`
    values.set(
      key,
      JSON.stringify({
        version: 1,
        sidebar: { opened: false },
        session: { width: 840 },
        projectFiles: { opened: true },
        home: { view: "files" },
      }),
    )

    const restored = mount(workspaceID)
    expect(restored.sidebar.opened()).toBe(false)
    expect(restored.sidebar.width()).toBe(256)
    expect(restored.session.width()).toBe(840)
    expect(restored.rightSidebar.opened()).toBe(true)
    expect(JSON.parse(values.get(key)!)).toMatchObject({ version: 2, rightSidebar: { opened: true } })
    restored.sidebar.open()
    expect(JSON.parse(values.get(key)!)).toEqual({
      version: 2,
      sidebar: { opened: true, width: 256 },
      session: { width: 840 },
      rightSidebar: { opened: true, tree: true },
    })
    cleanup()

    values.set(key, "not-json")
    const fallback = mount(workspaceID)
    expect(fallback.sidebar.opened()).toBe(true)
    expect(fallback.session.width()).toBe(600)
    expect(fallback.rightSidebar.opened()).toBe(false)
    expect(values.has(key)).toBe(false)
  })

  it("preserves a closed legacy sidebar and its saved widths during migration", () => {
    const workspaceID = Workspace.ID.create()
    const key = `bymorning.workspace:${workspaceID}:layout`
    values.set(
      key,
      JSON.stringify({
        version: 1,
        sidebar: { opened: true, width: 340 },
        session: { width: 680 },
        projectFiles: { opened: false },
      }),
    )
    const restored = mount(workspaceID)
    expect(restored.rightSidebar.opened()).toBe(false)
    expect(JSON.parse(values.get(key)!)).toEqual({
      version: 2,
      sidebar: { opened: true, width: 340 },
      session: { width: 680 },
      rightSidebar: { opened: false, tree: true },
    })
  })

  it("restores version two preferences independently for each workspace", () => {
    const first = Workspace.ID.create()
    const second = Workspace.ID.create()
    values.set(
      `bymorning.workspace:${first}:layout`,
      JSON.stringify({
        version: 2,
        sidebar: { opened: false, width: 300 },
        session: { width: 720 },
        rightSidebar: { opened: true, tree: true },
      }),
    )
    const restored = mount(first)
    expect(restored.rightSidebar.opened()).toBe(true)
    expect(restored.sidebar.width()).toBe(300)
    expect(restored.session.width()).toBe(720)
    expect(mount(second).rightSidebar.opened()).toBe(false)
    restored.rightSidebar.close()
    cleanup()
    expect(mount(first).rightSidebar.opened()).toBe(false)
  })

  it("migrates the previous individual layout keys", () => {
    const workspaceID = Workspace.ID.create()
    values.set(`bymorning.workspace:${workspaceID}:home-view`, "skills")
    values.set(`bymorning.workspace:${workspaceID}:project-sidebar-open`, "false")
    values.set(`bymorning.workspace:${workspaceID}:session-panel-width`, "720")

    const layout = mount(workspaceID)
    expect(layout.sidebar.opened()).toBe(false)
    expect(layout.sidebar.width()).toBe(256)
    expect(layout.session.width()).toBe(720)
    expect(layout.rightSidebar.opened()).toBe(false)
    expect(values.has(`bymorning.workspace:${workspaceID}:home-view`)).toBe(false)
    expect(values.has(`bymorning.workspace:${workspaceID}:project-sidebar-open`)).toBe(false)
    expect(values.has(`bymorning.workspace:${workspaceID}:session-panel-width`)).toBe(false)
  })
})

function mount(workspaceID: Workspace.ID) {
  const workspace = WorkspaceAccess.Info.make({ id: workspaceID, name: "Test", status: "active", role: "admin" })
  let layout!: Layout.Interface
  function Capture() {
    layout = useLayout()
    return null
  }
  render(() => (
    <WorkspaceScope list={[workspace]} current={workspace}>
      <LayoutProvider storage={storage}>
        <Capture />
      </LayoutProvider>
    </WorkspaceScope>
  ))
  return layout
}
