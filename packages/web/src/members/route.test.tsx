import {
  ByMorning,
  type ByMorningClient,
  type UsageLeaderboardOutput,
  type UserInviteOutput,
  type UserListOutput,
} from "@bymorning/client"
import * as User from "@bymorning/schema/user"
import * as UsageSchema from "@bymorning/schema/usage"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { afterEach, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { InstallationProvider } from "../installation/model"
import { Toast, toaster } from "../ui/components/toast"
import { MemberPage } from "./route"

const signedIn = vi.hoisted(() => ({ id: undefined as string | undefined }))
vi.mock("../context/account", () => ({
  useOptionalAccount: () => (signedIn.id === undefined ? undefined : { current: () => ({ id: signedIn.id }) }),
}))

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const invitedMember = Schema.decodeUnknownSync(User.Member)({
  id: User.ID.make("usr_invitee"),
  email: "invitee@example.com",
  role: "member",
  status: "pending",
})
const result = Schema.decodeUnknownSync(User.MemberList)({
  role: "admin",
  members: [
    { id: User.ID.make("usr_owner"), email: "owner@example.com", role: "admin", status: "active" },
    { id: User.ID.make("usr_admin"), email: "admin@example.com", role: "admin", status: "active" },
    invitedMember,
  ],
})
const leaderboard = {
  days: Schema.decodeSync(UsageSchema.Days)(30),
  from: new Date("2026-08-01T00:00:00Z"),
  to: new Date("2026-08-31T23:59:59Z"),
  users: [
    {
      userID: User.ID.create(),
      email: result.members[0]!.email,
      usage: {
        invocations: 12,
        cost: 4.25,
        costComplete: true,
        tokens: { total: 100, input: 60, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      models: [],
    },
    {
      userID: User.ID.create(),
      email: result.members[1]!.email,
      usage: {
        invocations: 4,
        cost: 2,
        costComplete: true,
        tokens: { total: 50, input: 30, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      models: [],
    },
  ],
  models: [],
} satisfies UsageLeaderboardOutput

function mount(
  list: ByMorningClient["user"]["list"],
  invite = vi.fn<ByMorningClient["user"]["invite"]>().mockResolvedValue(invitedMember),
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const usage = vi.fn().mockResolvedValue(leaderboard)
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    user: { ...base.user, list, invite },
    usage: { ...base.usage, leaderboard: usage },
    project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
    installation: { ...base.installation, self: vi.fn().mockResolvedValue({ admin: true }) },
  })
  render(() => (
    <SDKProvider>
      <DialogProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <InstallationProvider>
            <DataProvider>
              <MemberPage />
            </DataProvider>
          </InstallationProvider>
        </WorkspaceScope>
      </DialogProvider>
      <Toast.Region />
    </SDKProvider>
  ))
  return { invite, usage }
}

afterEach(() => {
  signedIn.id = undefined
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

it("shows a named loading state and requests the current workspace", async () => {
  const response = Promise.withResolvers<UserListOutput>()
  const list = vi.fn(() => response.promise)
  mount(list)

  expect(screen.getByRole("status", { name: "Loading members" })).toHaveTextContent("Loading members…")
  expect(list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.anything())
  response.resolve({ role: "admin", members: [] })
  await screen.findByRole("status", { name: "No workspace members" })
})

it("renders the empty state", async () => {
  mount(vi.fn().mockResolvedValue({ role: "admin", members: [] }))

  expect(await screen.findByRole("status", { name: "No workspace members" })).toHaveTextContent(
    "No members were found.",
  )
})

it("preserves API order and displays identity, role, status, usage, and limits", async () => {
  const { usage } = mount(vi.fn().mockResolvedValue(result))

  const table = await screen.findByRole("table", { name: "Workspace members" })
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Email", "Role", "Status", "Usage", "Limit", "Actions"])
  expect(Array.from(table.querySelectorAll('[data-slot="member-email"]')).map((email) => email.textContent)).toEqual([
    "owner@example.com",
    "admin@example.com",
    "invitee@example.com",
  ])
  expect(table.querySelectorAll('[data-component="avatar"][data-kind="user"]')).toHaveLength(3)
  expect(Array.from(table.querySelectorAll('[data-component="tag"]')).map((tag) => tag.textContent)).toEqual([
    "Admin",
    "Active",
    "Admin",
    "Active",
    "Member",
    "Pending",
  ])
  expect(within(table).getByText("$4.25")).toBeInTheDocument()
  expect(within(table).getByText("$2.00")).toBeInTheDocument()
  expect(within(table).getAllByRole("button", { name: /local limit/ })).toHaveLength(3)
  expect(table).not.toHaveTextContent(/account|id|joined|seen|monthly/i)
  // Workspace admins may remove members; suspension stays hidden without an Installation Admin grant per member Account.
  expect(within(table).getAllByRole("button", { name: /^Remove / })).toHaveLength(3)
  expect(screen.queryByRole("button", { name: /edit|resend/i })).not.toBeInTheDocument()
  expect(usage).toHaveBeenCalledWith({ workspace: workspace.id, days: 30 }, expect.anything())
})

it("edits member limits locally without changing member API data", async () => {
  const list = vi.fn().mockResolvedValue(result)
  mount(list)

  await userEvent.click(await screen.findByRole("button", { name: "Set local limit for owner@example.com" }))
  const input = screen.getByRole("textbox", { name: "owner@example.com local limit (USD)" })
  expect(input).toHaveValue("")
  await userEvent.type(input, "42.50{Enter}")

  expect(await screen.findByRole("button", { name: "Edit local limit for owner@example.com" })).toHaveTextContent(
    "$42.50",
  )
  expect(list).toHaveBeenCalledOnce()
})

it("keeps members read-only", async () => {
  mount(vi.fn().mockResolvedValue({ ...result, role: "member" }))

  await screen.findByRole("table", { name: "Workspace members" })
  expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument()
  expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /local limit/ })).not.toBeInTheDocument()
})

it("lets admins open and cancel the invitation dialog", async () => {
  mount(vi.fn().mockResolvedValue({ ...result, role: "admin" }))
  const trigger = await screen.findByRole("button", { name: "Invite member" })

  await userEvent.click(trigger)
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  const email = within(dialog).getByRole("textbox", { name: "Email" })
  expect(email).toBeRequired()
  expect(email).toHaveAttribute("autofocus")
  expect(email).toHaveAttribute("type", "email")
  expect(within(dialog).getByRole("button", { name: "Member" })).toBeInTheDocument()
  expect(dialog).not.toHaveTextContent("Owner")

  await userEvent.type(email, "draft@bymorning.ai")
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole("button", { name: "Invite member" }))
  const reopened = screen.getByRole("dialog", { name: "Invite member" })
  expect(within(reopened).getByRole("textbox", { name: "Email" })).toHaveValue("")
  fireEvent.keyDown(reopened, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument())
})

it("validates and normalizes invitations through the schema, then closes and refetches", async () => {
  const list = vi.fn().mockResolvedValue(result)
  const { invite } = mount(list)
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  const email = within(dialog).getByRole("textbox", { name: "Email" })
  fireEvent.input(email, { target: { value: "  TEAMMATE@BYMORNING.AI  " } })
  await userEvent.click(within(dialog).getByRole("button", { name: "Member" }))
  await userEvent.click(screen.getByRole("option", { name: "Admin", hidden: true }))
  fireEvent.submit(dialog.querySelector("form")!)

  await waitFor(() =>
    expect(invite).toHaveBeenCalledWith({ workspace: workspace.id, email: "teammate@bymorning.ai", role: "admin" }),
  )
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole("button", { name: "Invite member" }))
  const reopened = screen.getByRole("dialog", { name: "Invite member" })
  expect(within(reopened).getByRole("textbox", { name: "Email" })).toHaveValue("")
  expect(within(reopened).getByRole("button", { name: "Member" })).toBeInTheDocument()
  await userEvent.type(within(reopened).getByRole("textbox", { name: "Email" }), "another@bymorning.ai")
  await userEvent.click(within(reopened).getByRole("button", { name: "Invite member" }))
  await waitFor(() => expect(invite).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument())
})

it("says an invitation was re-sent when the email is already pending", async () => {
  const { invite } = mount(vi.fn().mockResolvedValue(result))
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  fireEvent.input(within(dialog).getByRole("textbox", { name: "Email" }), { target: { value: "Invitee@example.com" } })
  fireEvent.submit(dialog.querySelector("form")!)
  await waitFor(() => expect(invite).toHaveBeenCalledOnce())
  expect(await screen.findByText("Invitation re-sent to invitee@example.com")).toBeInTheDocument()
})

it("says an invitation was sent for a new email", async () => {
  const { invite } = mount(vi.fn().mockResolvedValue(result))
  invite.mockResolvedValue(Schema.decodeUnknownSync(User.Member)({ ...invitedMember, email: "fresh@example.com" }))
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  fireEvent.input(within(dialog).getByRole("textbox", { name: "Email" }), { target: { value: "fresh@example.com" } })
  fireEvent.submit(dialog.querySelector("form")!)
  expect(await screen.findByText("Invitation sent to fresh@example.com")).toBeInTheDocument()
})

it("disables every control and prevents duplicate submissions while pending", async () => {
  const response = Promise.withResolvers<UserInviteOutput>()
  const invite = vi.fn(() => response.promise)
  mount(vi.fn().mockResolvedValue(result), invite)
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Email" }), "teammate@bymorning.ai")
  await userEvent.click(within(dialog).getByRole("button", { name: "Invite member" }))

  expect(dialog).toHaveAttribute("aria-busy", "true")
  expect(within(dialog).getByRole("textbox", { name: "Email" })).toBeDisabled()
  expect(within(dialog).getByRole("button", { name: "Member" })).toHaveAttribute("aria-disabled", "true")
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled()
  const submit = within(dialog).getByRole("button", { name: "Inviting…" })
  expect(submit).toBeDisabled()
  fireEvent.submit(dialog.querySelector("form")!)
  expect(invite).toHaveBeenCalledOnce()
  response.resolve(invitedMember)
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite member" })).not.toBeInTheDocument())
})

it("preserves invitation values and reports an API failure", async () => {
  const invite = vi.fn().mockRejectedValue(new Error("Invitation unavailable"))
  mount(vi.fn().mockResolvedValue(result), invite)
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  const email = within(dialog).getByRole("textbox", { name: "Email" })
  await userEvent.type(email, "teammate@bymorning.ai")
  await userEvent.click(within(dialog).getByRole("button", { name: "Invite member" }))

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Invitation unavailable")
  expect(email).toHaveValue("teammate@bymorning.ai")
  expect(email).toBeEnabled()
  expect(within(dialog).getByRole("button", { name: "Invite member" })).toBeEnabled()
})

it("rejects invalid schema input without calling the API", async () => {
  const { invite } = mount(vi.fn().mockResolvedValue(result))
  await userEvent.click(await screen.findByRole("button", { name: "Invite member" }))
  const dialog = screen.getByRole("dialog", { name: "Invite member" })
  fireEvent.input(within(dialog).getByRole("textbox", { name: "Email" }), { target: { value: "invalid" } })
  fireEvent.submit(dialog.querySelector("form")!)

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter a valid email address.")
  expect(invite).not.toHaveBeenCalled()
})

it("explains the signed-in row instead of offering to remove yourself", async () => {
  signedIn.id = "acc_me"
  mount(
    vi.fn().mockResolvedValue({
      role: "admin",
      members: [
        { id: "usr_me", email: "me@example.com", role: "admin", status: "active", accountID: "acc_me" },
        { ...invitedMember },
      ],
    }),
  )

  const table = await screen.findByRole("table", { name: "Workspace members" })
  expect(within(table).queryByRole("button", { name: "Remove me@example.com" })).not.toBeInTheDocument()
  expect(within(table).getByText("You")).toBeVisible()
  expect(within(table).getByText("You are the only admin")).toBeVisible()
  expect(within(table).getByRole("button", { name: "Remove invitee@example.com" })).toBeVisible()
})

it("uses invitation wording when cancelling a pending invite", async () => {
  mount(vi.fn().mockResolvedValue(result))

  await userEvent.click(await screen.findByRole("button", { name: "Remove invitee@example.com" }))
  const dialog = await screen.findByRole("dialog")
  expect(dialog).toHaveTextContent("Cancel invite for invitee@example.com?")
  expect(dialog).not.toHaveTextContent("Their Sessions are kept")
  expect(within(dialog).getByRole("button", { name: "Cancel invite" })).toBeVisible()
})
