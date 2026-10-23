import { ByMorning } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createStore } from "solid-js/store"
import { afterEach, expect, it, vi } from "vitest"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { DialogProvider } from "../context/dialog"
import { createQuery } from "../runtime/server/query"
import { ActionMenu } from "../ui/components/action-menu"
import { createAction, MCPServerActionItems } from "./server-actions"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("runs an imperative MCP test through the real SDK, captures scope before scheduling, and retains a failed protocol result as a native error", async () => {
  const original = WorkspaceAccess.Info.make({
    id: Workspace.ID.create(),
    name: "Original",
    role: "admin",
    status: "active",
  })
  const other = WorkspaceAccess.Info.make({ ...original, id: Workspace.ID.create(), name: "Other" })
  const gate = Promise.withResolvers<Response>()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(gate.promise)
    .mockResolvedValue(Response.json({ ok: true }))
  const api = ByMorning.make({ baseUrl: "http://localhost", fetch })
  vi.spyOn(ByMorning, "make").mockReturnValue(api)
  const query = createQuery()
  let action!: ReturnType<typeof createAction>
  const Probe = () => {
    action = createAction()
    const [scope, setScope] = createStore({ current: { ...original } })
    return (
      <WorkspaceScope list={[original, other]} current={scope.current}>
        <ActionMenu label="linear">
          <MCPServerActionItems
            server={{ name: "linear", enabled: true, status: "disabled" }}
            pending={action.pending()}
            onOperate={(operation, run) => {
              void action.run(operation, run).catch(() => undefined)
              setScope("current", other)
            }}
            onRemove={async () => undefined}
            onAuthenticate={async () => undefined}
            canRemove
          />
        </ActionMenu>
      </WorkspaceScope>
    )
  }
  render(() => (
    <QueryClientProvider client={query}>
      <SDKProvider>
        <DialogProvider>
          <Probe />
        </DialogProvider>
      </SDKProvider>
    </QueryClientProvider>
  ))
  await userEvent.click(screen.getByRole("button", { name: "Actions for linear" }))
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Test connection")!,
  )
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(String(fetch.mock.calls[0]![0])).toBe(`http://localhost/api/mcp/server/linear/test?workspace=${original.id}`)
  expect(action.mutation.isPending).toBe(true)
  gate.resolve(Response.json({ ok: false, error: "Protocol rejected" }))
  await waitFor(() => expect(action.mutation.isError).toBe(true))
  expect(action.error()).toBe("Protocol rejected")
  expect(query.getMutationCache().getAll().at(-1)?.state.status).toBe("error")
  await userEvent.click(screen.getByRole("button", { name: "Actions for linear" }))
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Test connection")!,
  )
  await waitFor(() => expect(action.mutation.isSuccess).toBe(true))
  expect(fetch).toHaveBeenCalledTimes(2)
})

it("admits one same-tick request per server while independent servers remain concurrent", async () => {
  const query = createQuery()
  let first!: ReturnType<typeof createAction>
  let second!: ReturnType<typeof createAction>
  const Probe = () => {
    first = createAction()
    second = createAction()
    return null
  }
  render(() => (
    <QueryClientProvider client={query}>
      <Probe />
    </QueryClientProvider>
  ))
  const gate = Promise.withResolvers<void>()
  const run = vi.fn(() => gate.promise)
  const pending = first.run("connect", run)
  await first.run("connect", run)
  const failure = new Error("Second server failed")
  await expect(
    second.run("disconnect", async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  await waitFor(() => expect(second.mutation.isError).toBe(true))
  expect(first.mutation.isPending).toBe(true)
  expect(run).toHaveBeenCalledTimes(1)
  gate.resolve()
  await pending
  await waitFor(() => expect(first.mutation.isSuccess).toBe(true))
  expect(second.error()).toBe("Second server failed")
})

it("offers members of a member-values server a way to replace their values once connected or rejected", async () => {
  const current = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Test", role: "member", status: "active" })
  vi.spyOn(ByMorning, "make").mockReturnValue(ByMorning.make({ baseUrl: "http://localhost" }))
  const authenticate = vi.fn(async () => undefined)
  const operate = vi.fn((_operation: string, run: () => Promise<unknown>) => void run())
  render(() => (
    <QueryClientProvider client={createQuery()}>
      <SDKProvider>
        <DialogProvider>
          <WorkspaceScope list={[current]} current={current}>
            <ActionMenu label="river">
              <MCPServerActionItems
                server={{
                  name: "river",
                  enabled: true,
                  status: "failed",
                  error: "Server rejected your values",
                  auth: "values",
                  integrationID: "mcp-river",
                }}
                pending=""
                onOperate={operate}
                onRemove={async () => undefined}
                onAuthenticate={authenticate}
                canRemove={false}
              />
            </ActionMenu>
          </WorkspaceScope>
        </DialogProvider>
      </SDKProvider>
    </QueryClientProvider>
  ))
  await userEvent.click(screen.getByRole("button", { name: "Actions for river" }))
  const items = screen.getAllByRole("menuitem", { hidden: true }).map((item) => item.textContent)
  expect(items).toContain("Update values")
  expect(items).not.toContain("Authenticate")
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Update values")!,
  )
  expect(operate).toHaveBeenCalledWith("authenticate", authenticate)
  expect(authenticate).toHaveBeenCalled()
})
