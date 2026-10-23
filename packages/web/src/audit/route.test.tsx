import type * as Workspace from "@bymorning/schema/workspace"
import { Audit } from "@bymorning/schema/audit"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { Toast, toaster } from "../ui/components/toast"
import { actionLabel, AuditPage, outcomeLabel, type AuditEntry } from "./route"

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

const workspaceID = "wrk_06689145a001WPprT0zKiRAQWn" as Workspace.ID

const entry = (overrides?: Partial<AuditEntry>): AuditEntry =>
  ({
    id: "aud_00000001x",
    sequence: 1,
    occurredAt: new Date("2026-09-26T12:00:00.000Z"),
    actor: { type: "user", accountID: "acc_1", userID: "usr_1", workspaceID },
    action: "service-account.create",
    workspaceID,
    target: "sva_1",
    outcome: "success",
    context: { ip: "127.0.0.1", userAgent: "test" },
    chain: "0".repeat(64),
    ...overrides,
  }) as AuditEntry

function mount(client: object) {
  render(() => (
    <>
      <AuditPage workspaceID={workspaceID} client={client as never} />
      <Toast.Region />
    </>
  ))
}

test("renders recorded entries and applies the action filter", async () => {
  const client = {
    list: vi.fn(async (input?: { action?: string }) => ({
      data:
        input?.action === undefined
          ? [
              entry(),
              entry({ id: Audit.ID.make("aud_2"), sequence: 2, action: "auth.login" as const, target: "acc_1" }),
            ]
          : [entry()],
    })),
  }
  mount(client)

  const table = () => screen.getByRole("table")
  expect(within(await screen.findByRole("table")).getByText("Service account create")).toBeVisible()
  expect(within(table()).getByText("Auth login")).toBeVisible()
  expect(within(table()).getAllByText("user usr_1").length).toBe(2)
  expect(within(table()).getAllByText("127.0.0.1").length).toBe(2)

  expect(screen.getByRole("option", { name: "User role update" })).toHaveValue("user.role.update")
  expect(screen.getByText("Action", { selector: "label > span" })).toBeVisible()
  expect(screen.getByText("From", { selector: "label > span" })).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText("Filter by action"), "service-account.create")
  await userEvent.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() =>
    expect(client.list).toHaveBeenLastCalledWith(expect.objectContaining({ action: "service-account.create" })),
  )
  await waitFor(() => expect(within(table()).queryByText("auth.login")).not.toBeInTheDocument())
  expect(within(table()).getByText("Service account create")).toBeVisible()
})

test("exports the filtered entries as JSON", async () => {
  const client = { list: vi.fn(async () => ({ data: [entry()] })) }
  const blobs: Blob[] = []
  let clicked = 0
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    clicked++
  })
  const original = URL.createObjectURL
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob)
    return "blob:audit"
  }) as typeof URL.createObjectURL
  // jsdom's Blob lacks .text(); FileReader is implemented.
  const read = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
  try {
    mount(client)
    await userEvent.click(await screen.findByRole("button", { name: "Export JSON" }))
    // The success toast is the DOM-observable completion of the export.
    await screen.findByText("Exported 1 audit entry")
    expect(clicked).toBe(1)
    const exported = JSON.parse(await read(blobs[0]!)) as ReadonlyArray<{ action: string; actor: { type: string } }>
    expect(exported[0]).toMatchObject({ action: "service-account.create", actor: { type: "user" } })
  } finally {
    URL.createObjectURL = original
  }
})

test("labels action codes with acronyms and keeps the raw code as a tooltip", async () => {
  expect(actionLabel("oauth.grant.create")).toBe("OAuth grant create")
  expect(actionLabel("mcp.update")).toBe("MCP update")
  expect(actionLabel("auth-provider.create")).toBe("Auth provider create")
  expect(outcomeLabel("success")).toBe("Success")
  mount({ list: vi.fn(async () => ({ data: [entry({ action: "user.invite" as const })] })) })
  const cell = within(await screen.findByRole("table")).getByText("User invite")
  expect(cell).toHaveAttribute("title", "user.invite")
  expect(within(screen.getByRole("table")).getByText("Success")).toBeVisible()
})
