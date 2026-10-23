import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import * as Workspace from "@bymorning/schema/workspace"
import { ByMorning } from "@bymorning/client"
import { createMemoryHistory, MemoryRouter, Navigate, Route } from "@solidjs/router"
import { cleanup, screen, waitFor } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import { createSignal, onMount, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { TestTransport } from "../../../client/test/solid/fixture"
import { SettingsProvider } from "../context/settings"
import { WorkspaceInventoryScope } from "../context/workspace"
import { CommandProvider } from "../shell/commands/context"
import { ConsoleGate } from "./gate"
import { WorkspaceRoute } from "../shell/routes/workspace"
import { WorkspaceRoutePath } from "../workspace-route-paths"

const admin = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Admin", status: "active", role: "admin" })
const member = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Member",
  status: "active",
  role: "member",
})

const mounts: string[] = []

function Probe(props: { readonly name: string }): JSX.Element {
  onMount(() => mounts.push(props.name))
  return <output>{props.name}</output>
}

function mountWorkspaceRoutes(input: {
  readonly path: string
  readonly inventory?: ReadonlyArray<WorkspaceAccess.Info>
}): {
  readonly history: ReturnType<typeof createMemoryHistory>
  readonly setInventory: (list: ReadonlyArray<WorkspaceAccess.Info>) => void
} {
  const history = createMemoryHistory()
  history.set({ value: input.path })
  const [inventory, setInventory] = createSignal<ReadonlyArray<WorkspaceAccess.Info>>(input.inventory ?? [])
  const http = new TestTransport()
  vi.spyOn(ByMorning, "make").mockReturnValue(http.api)
  render(() => (
    <SDKProvider>
      <SettingsProvider>
        <DialogProvider>
          <CommandProvider>
            <WorkspaceInventoryScope list={inventory} ready={() => true}>
              <MemoryRouter history={history}>
                <Route path="/w/:workspaceID" component={WorkspaceRoute}>
                  <Route component={ConsoleGate}>
                    <Route path={WorkspaceRoutePath.gateway} component={() => <Probe name="gateway" />} />
                    <Route path="/gateway/api-keys" component={() => <Navigate href="../service-accounts" />} />
                    <Route
                      path={WorkspaceRoutePath.gatewayServiceAccounts}
                      component={() => <Probe name="service-accounts" />}
                    />
                  </Route>
                  <Route path={WorkspaceRoutePath.overview} component={() => <Probe name="overview" />} />
                </Route>
              </MemoryRouter>
            </WorkspaceInventoryScope>
          </CommandProvider>
        </DialogProvider>
      </SettingsProvider>
    </SDKProvider>
  ))
  return { history, setInventory }
}

afterEach(() => {
  cleanup()
  mounts.length = 0
  vi.restoreAllMocks()
})

describe("ConsoleGate", () => {
  it("mounts the Console child for an admin deep link without redirecting", async () => {
    const { history } = mountWorkspaceRoutes({ path: `/w/${admin.id}/gateway`, inventory: [admin] })

    await waitFor(() => expect(screen.getByText("gateway")).toBeInTheDocument())
    expect(history.get()).toBe(`/w/${admin.id}/gateway`)
    expect(mounts).toEqual(["gateway"])
  })

  it("replaces a member deep link with the workspace overview and never mounts the Console child", async () => {
    const { history } = mountWorkspaceRoutes({ path: `/w/${member.id}/gateway`, inventory: [member] })

    await waitFor(() => expect(history.get()).toBe(`/w/${member.id}`))
    expect(screen.getByText("overview")).toBeInTheDocument()
    expect(mounts).toEqual(["overview"])
  })

  it("does not mount any Console child while the Workspace inventory is unresolved", async () => {
    const { history, setInventory } = mountWorkspaceRoutes({ path: `/w/${member.id}/gateway` })

    expect(mounts).toEqual([])
    expect(history.get()).toBe(`/w/${member.id}/gateway`)

    setInventory([member])
    await waitFor(() => expect(history.get()).toBe(`/w/${member.id}`))
    expect(mounts).toEqual(["overview"])
  })

  it("keeps workspace switching reactive: a member workspace dismisses the mounted Console child", async () => {
    const { history } = mountWorkspaceRoutes({ path: `/w/${admin.id}/gateway`, inventory: [admin, member] })

    await waitFor(() => expect(screen.getByText("gateway")).toBeInTheDocument())
    history.set({ value: `/w/${member.id}/gateway` })

    await waitFor(() => expect(history.get()).toBe(`/w/${member.id}`))
    expect(screen.queryByText("gateway")).not.toBeInTheDocument()
  })

  it("resolves the legacy api-keys redirect for admins and folds it into one overview redirect for members", async () => {
    mountWorkspaceRoutes({ path: `/w/${admin.id}/gateway/api-keys`, inventory: [admin] })
    await waitFor(() => expect(screen.getByText("service-accounts")).toBeInTheDocument())
    expect(mounts).toEqual(["service-accounts"])

    cleanup()
    mounts.length = 0

    const memberMount = mountWorkspaceRoutes({ path: `/w/${member.id}/gateway/api-keys`, inventory: [member] })
    await waitFor(() => expect(memberMount.history.get()).toBe(`/w/${member.id}`))
    expect(mounts).toEqual(["overview"])
  })

  it("leaves the workspace overview routable for members", async () => {
    const { history } = mountWorkspaceRoutes({ path: `/w/${member.id}`, inventory: [member] })

    await waitFor(() => expect(screen.getByText("overview")).toBeInTheDocument())
    expect(history.get()).toBe(`/w/${member.id}`)
    expect(mounts).toEqual(["overview"])
  })
})
