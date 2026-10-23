import type { Account } from "@bymorning/schema/account"
import type { User } from "@bymorning/schema/user"
import { createComponent, createEffect, For, Match, on, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useOptionalAccount } from "../context/account"
import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { useInstallation } from "../installation/model"
import { WorkspacePage } from "../home/workspace-page"
import { Avatar } from "../ui/components/avatar"
import { Button } from "../ui/components/button"
import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { ScrollFrame } from "../ui/components/scroll-frame"
import { showToast } from "../ui/components/toast"
import { Tag } from "../ui/components/tag"
import { InlineLimit, Usage } from "../ui/components/usage-limit"
import { errorMessage } from "../utils/error-message"
import { MembersInviteDialog } from "./invite-dialog"
import "./route.css"

/** Members: workspace member management. */
export function MembersRoute(): JSX.Element {
  return <MemberPage />
}

/** Member management. */
export function MemberPage(): JSX.Element {
  const dialog = useDialog()
  const sdk = useSDK()
  const workspace = useWorkspace()
  const installation = useInstallation()
  const account = useOptionalAccount()
  const members = useData().workspace.member
  const leaderboard = useData().gateway.leaderboard(() => ({ days: 30 }))
  const [limits, setLimits] = createStore<Record<string, number | undefined>>({})
  const [pending, setPending] = createStore<Record<string, boolean>>({})
  const canInvite = () => members.list()?.role === "admin"
  const usageFor = (email: string) => leaderboard.state().data?.users.find((user) => user.email === email)?.usage.cost
  const refresh = () => {
    members.invalidate()
    void members.sync().catch(() => undefined)
  }
  const isSelf = (member: User.Member) => member.accountID != null && member.accountID === account?.current()?.id
  const adminCount = () =>
    members.list()?.members.filter((member) => member.role === "admin" && member.status === "active").length ?? 0
  const selfNote = (member: User.Member) =>
    member.role === "admin" && adminCount() <= 1 ? "You are the only admin" : "This is your own account"
  const removeMember = (member: User.Member) => {
    const workspaceID = workspace.current().id
    const memberID = member.id
    const email = member.email
    const invited = member.status === "pending"
    dialog.show(() => (
      <ConfirmDialog
        title={invited ? `Cancel invite for ${email}?` : `Remove ${email}?`}
        description={
          invited
            ? "The invitation is withdrawn and cannot be used to join this Workspace."
            : "Their Sessions are kept; their Scheduled Tasks pause and their API access to this Workspace ends."
        }
        confirmLabel={invited ? "Cancel invite" : "Remove member"}
        danger
        onConfirm={async () => {
          setPending(memberID, true)
          try {
            await sdk.client.user.remove({ workspace: workspaceID, userID: memberID as User.ID })
            showToast({ variant: "success", title: invited ? `Invitation for ${email} cancelled` : `${email} removed` })
            refresh()
          } catch (cause) {
            showToast({
              variant: "error",
              title: errorMessage(
                cause,
                invited ? "Could not cancel that invitation." : "Could not remove that member.",
              ),
            })
          } finally {
            setPending(memberID, false)
          }
        }}
      />
    ))
  }
  const suspendAccount = (memberID: string, accountID: string, email: string) => {
    dialog.show(() => (
      <ConfirmDialog
        title={`Suspend ${email}?`}
        description="The Account loses access to the whole Installation on its next request. Its Scheduled Tasks pause."
        confirmLabel="Suspend account"
        danger
        onConfirm={async () => {
          setPending(memberID, true)
          try {
            await sdk.client.account.suspend({ accountID: accountID as Account.ID })
            showToast({ variant: "success", title: `${email} suspended` })
            refresh()
          } catch (cause) {
            showToast({ variant: "error", title: errorMessage(cause, "Could not suspend that Account.") })
          } finally {
            setPending(memberID, false)
          }
        }}
      />
    ))
  }
  onMount(() => void members.sync().catch(() => undefined))
  createEffect(
    on(
      () => members.state(),
      (state) => {
        if (state.state !== "error") return
        showToast({
          variant: "error",
          title: state.message ?? "Could not load workspace members.",
          actions: [{ label: "Try again", onClick: () => void members.sync().catch(() => undefined) }],
        })
      },
    ),
  )

  return (
    <WorkspacePage
      title="Members"
      layout="table"
      actions={
        <Show when={canInvite()}>
          <Button
            variant="primary"
            icon="central-plus-small"
            onClick={() => {
              const workspaceID = workspace.current().id
              const client = sdk.client
              const catalog = members
              dialog.show(() =>
                createComponent(MembersInviteDialog, {
                  create: (payload) => client.user.invite({ workspace: workspaceID, ...payload }),
                  onSuccess: (member) => {
                    const resent = catalog
                      .list()
                      ?.members.some(
                        (existing) =>
                          existing.status === "pending" && existing.email.toLowerCase() === member.email.toLowerCase(),
                      )
                    showToast({
                      variant: "success",
                      title:
                        member.status === "pending"
                          ? `Invitation ${resent ? "re-sent" : "sent"} to ${member.email}`
                          : `${member.email} is a ${roleLabel(member.role).toLowerCase()}`,
                    })
                    catalog.invalidate()
                    void catalog.sync().catch(() => undefined)
                  },
                }),
              )
            }}
          >
            Invite member
          </Button>
        </Show>
      }
    >
      <div data-component="members-region">
        <Switch>
          <Match when={members.state().state === "loading"}>
            <p role="status" aria-label="Loading members" data-slot="members-status">
              Loading members…
            </p>
          </Match>
          <Match when={members.list()}>
            {(result) => (
              <Show
                when={result().members.length > 0}
                fallback={
                  <p role="status" aria-label="No workspace members" data-slot="members-status">
                    No members were found.
                  </p>
                }
              >
                <ScrollFrame data-slot="table-wrap">
                  <table aria-label="Workspace members">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Usage</th>
                        <th>Limit</th>
                        <Show when={canInvite()}>
                          <th>
                            <span class="sr-only">Actions</span>
                          </th>
                        </Show>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={result().members}>
                        {(member) => (
                          <tr>
                            <th scope="row">
                              <div data-slot="member-identity">
                                <Avatar fallback={member.email} size="normal" aria-hidden="true" />
                                <strong data-slot="member-email">{member.email}</strong>
                                <Show when={isSelf(member)}>
                                  <Tag>You</Tag>
                                </Show>
                              </div>
                            </th>
                            <td>
                              <Tag>{roleLabel(member.role)}</Tag>
                            </td>
                            <td>
                              <Tag>{statusLabel(member.status)}</Tag>
                            </td>
                            <td>
                              <Usage usage={usageFor(member.email)} limit={limits[member.email]} />
                            </td>
                            <td>
                              <InlineLimit
                                name={member.email}
                                value={limits[member.email]}
                                editable={canInvite()}
                                local
                                onSave={(value) => setLimits(member.email, value)}
                              />
                            </td>
                            <Show when={canInvite()}>
                              <td>
                                <Show
                                  when={!isSelf(member)}
                                  fallback={<span data-slot="member-note">{selfNote(member)}</span>}
                                >
                                  <div data-slot="member-actions">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      disabled={pending[member.id] === true}
                                      aria-label={`Remove ${member.email}`}
                                      onClick={() => removeMember(member)}
                                    >
                                      {member.status === "pending" ? "Cancel invite" : "Remove"}
                                    </Button>
                                    <Show when={installation.admin() && member.accountID != null}>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={pending[member.id] === true}
                                        aria-label={`Suspend ${member.email}`}
                                        onClick={() => suspendAccount(member.id, member.accountID!, member.email)}
                                      >
                                        Suspend
                                      </Button>
                                    </Show>
                                  </div>
                                </Show>
                              </td>
                            </Show>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </ScrollFrame>
              </Show>
            )}
          </Match>
          <Match when={true}>
            <p role="status" aria-label="No workspace members" data-slot="members-status">
              No members were found.
            </p>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}

function roleLabel(role: "admin" | "member") {
  if (role === "admin") return "Admin"
  return "Member"
}

function statusLabel(status: "active" | "pending") {
  return status === "active" ? "Active" : "Pending"
}
