import { createMemoryHistory, MemoryRouter } from "@solidjs/router"
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppRoutes } from "./routes"

// The real route table is mounted. Only the wrappers and the leaf pages are replaced by marker elements, so each
// test asserts the outcome that matters: which page a URL reaches and which providers or gates it sits inside.
vi.mock("../../context/workspace-runtime", async () => ({
  WorkspaceRuntimeProvider: (await import("./routes.test-support")).wrapper("runtime"),
}))
vi.mock("./workspace", async () => {
  const { wrapper } = await import("./routes.test-support")
  return { WorkspaceProvider: wrapper("workspace-provider"), WorkspaceRoute: wrapper("workspace-route") }
})
vi.mock("./layout", async () => ({ AppLayout: (await import("./routes.test-support")).wrapper("layout") }))
vi.mock("../../console/gate", async () => ({
  ConsoleGate: (await import("./routes.test-support")).wrapper("console-gate"),
}))
vi.mock("../../home/route", async () => ({ HomeRoute: (await import("./routes.test-support")).page("overview") }))
vi.mock("../../project/legacy-route", async () => ({
  LegacyProjectRoute: (await import("./routes.test-support")).page("legacy-project"),
}))
vi.mock("../../scheduled-task/route", async () => ({
  ScheduledTaskRoute: (await import("./routes.test-support")).page("scheduled-tasks"),
}))
vi.mock("../../members/route", async () => ({ MembersRoute: (await import("./routes.test-support")).page("members") }))
vi.mock("../../gateway/overview/route", async () => ({
  GatewayOverviewRoute: (await import("./routes.test-support")).page("gateway"),
}))
vi.mock("../../gateway/service-accounts/route", async () => {
  const { page } = await import("./routes.test-support")
  return { GatewayServiceAccountsRoute: page("service-accounts"), GatewayServiceAccountRoute: page("service-account") }
})
vi.mock("../../share/route", async () => ({ ShareRoute: (await import("./routes.test-support")).page("share") }))

afterEach(cleanup)

/** Mount the application routes at `path`; resolves once a page marker is on screen. */
async function visit(path: string) {
  const history = createMemoryHistory()
  history.set({ value: path })
  const view = render(() => (
    <MemoryRouter history={history}>
      <AppRoutes />
    </MemoryRouter>
  ))
  await waitFor(() => expect(view.container.querySelector('[data-marker^="page:"]')).not.toBeNull())
  const page = view.container.querySelector('[data-marker^="page:"]')!
  const wrappers: string[] = []
  for (let node = page.parentElement; node && node !== view.container; node = node.parentElement)
    wrappers.unshift(node.getAttribute("data-marker") ?? "")
  return { history, page: page.getAttribute("data-marker"), wrappers }
}

describe("application routes", () => {
  it("keeps the legacy /projects and /files bookmarks pointing at the Project page", async () => {
    expect((await visit("/w/wrk_1/projects")).page).toBe("page:legacy-project")
    cleanup()
    expect((await visit("/w/wrk_1/files")).page).toBe("page:legacy-project")
  })

  it("redirects the retired API keys and quick start pages to Service accounts", async () => {
    for (const path of ["/w/wrk_1/gateway/api-keys", "/w/wrk_1/gateway/quick-start"]) {
      const visited = await visit(path)
      expect(visited.page, path).toBe("page:service-accounts")
      // Memory history keeps the raw relative target; a browser resolves it.
      expect(new URL(String(visited.history.get()), "http://localhost").pathname, path).toBe(
        "/w/wrk_1/gateway/service-accounts",
      )
      cleanup()
    }
  })

  it("serves the public Share page outside every Workspace provider, so a visitor is not sent to sign in", async () => {
    const { page, wrappers } = await visit("/s/wrk_1/some-token")
    expect(page).toBe("page:share")
    expect(wrappers).not.toContain("workspace-provider")
    expect(wrappers).not.toContain("workspace-route")
    expect(wrappers).not.toContain("console-gate")
  })

  it("puts administration pages behind the Console gate and everyday pages outside it", async () => {
    for (const path of ["/w/wrk_1/members", "/w/wrk_1/gateway"]) {
      const visited = await visit(path)
      expect(visited.wrappers, path).toEqual([
        "runtime",
        "workspace-provider",
        "workspace-route",
        "layout",
        "console-gate",
      ])
      cleanup()
    }
    for (const [path, expected] of [
      ["/w/wrk_1", "page:overview"],
      ["/w/wrk_1/scheduled-tasks", "page:scheduled-tasks"],
    ] as const) {
      const visited = await visit(path)
      expect(visited.page, path).toBe(expected)
      expect(visited.wrappers, path).toEqual(["runtime", "workspace-provider", "workspace-route", "layout"])
      cleanup()
    }
  })
})
