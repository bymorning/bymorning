import type { Account } from "@bymorning/schema/account"
import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useAccount } from "../context/account"
import { useSDK } from "../context/sdk"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { Tag } from "../ui/components/tag"
import { TextInput } from "../ui/components/text-input"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import { useInstallation } from "./model"
import "./route.css"

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly admins: ReadonlyArray<Account.ID>
  readonly grant: string
  readonly pending: boolean
}

/** Console → Installation: Installation Admin grant management. */
export function InstallationRoute(): JSX.Element {
  return <InstallationPage />
}

/** Installation Admin management. */
export function InstallationPage(): JSX.Element {
  const sdk = useSDK()
  const account = useAccount()
  const installation = useInstallation()
  const [state, setState] = createStore<State>({ phase: "loading", admins: [], grant: "", pending: false })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const refresh = async () => {
    setState({ phase: "loading" })
    try {
      const result = await sdk.client.installation.admin.list()
      if (!disposed) setState({ phase: "ready", admins: result.admins })
    } catch (cause) {
      if (disposed) return
      setState({ phase: "error" })
      showToast({ variant: "error", title: errorMessage(cause, "Could not load Installation Admins.") })
    }
  }
  onMount(() => void refresh())

  const grant = async () => {
    const accountID = state.grant.trim()
    if (accountID === "" || state.pending) return
    if (!accountID.startsWith("acc_") || accountID.length === "acc_".length) {
      showToast({ variant: "error", title: "Enter an account ID like acc_…" })
      return
    }
    setState({ pending: true })
    // The grant response is the admin list only, so "already an admin" is read from the list shown before granting.
    const already = state.admins.includes(accountID as Account.ID)
    try {
      const result = await sdk.client.installation.admin.grant({ accountID: accountID as Account.ID })
      if (disposed) return
      setState({ admins: result.admins, grant: "", pending: false })
      showToast({
        variant: "success",
        title: already ? `${accountID} is already an Installation Admin` : "Installation Admin granted",
      })
    } catch (cause) {
      if (disposed) return
      setState({ pending: false })
      showToast({ variant: "error", title: errorMessage(cause, "Could not grant Installation Admin.") })
    }
  }

  const revoke = async (accountID: Account.ID) => {
    if (state.pending) return
    setState({ pending: true })
    try {
      const result = await sdk.client.installation.admin.revoke({ accountID })
      if (disposed) return
      setState({ admins: result.admins, pending: false })
      void installation.refetch()
      showToast({ variant: "success", title: "Installation Admin revoked" })
    } catch (cause) {
      if (disposed) return
      setState({ pending: false })
      showToast({ variant: "error", title: errorMessage(cause, "Could not revoke Installation Admin.") })
    }
  }

  return (
    <WorkspacePage
      title="Installation"
      description="Installation Admins manage SSO and the Installation Policy. The last admin cannot be revoked."
    >
      <div data-component="installation-region">
        <Switch>
          <Match when={installation.loading() || state.phase === "loading"}>
            <p role="status" aria-label="Loading Installation Admins" data-slot="installation-status">
              Loading Installation Admins…
            </p>
          </Match>
          <Match when={!installation.admin()}>
            <Empty variant="panel">An Installation Admin grant is required to manage the Installation.</Empty>
          </Match>
          <Match when={state.phase === "error"}>
            <Button type="button" variant="ghost" onClick={() => void refresh()}>
              Try again
            </Button>
          </Match>
          <Match when={state.phase === "ready"}>
            <div data-slot="admin-list">
              <For each={state.admins}>
                {(accountID) => (
                  <div data-slot="admin-row">
                    <div data-slot="admin-identity">
                      <code>{accountID}</code>
                      <Show when={account.current()?.id === accountID}>
                        <Tag>You</Tag>
                      </Show>
                    </div>
                    <div data-slot="admin-action">
                      <Show when={state.admins.length <= 1}>
                        <span id={`revoke-note-${accountID}`} data-slot="admin-note">
                          Last remaining admin cannot be revoked
                        </span>
                      </Show>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={state.pending || state.admins.length <= 1}
                        aria-label={`Revoke Installation Admin ${accountID}`}
                        aria-describedby={state.admins.length <= 1 ? `revoke-note-${accountID}` : undefined}
                        title={state.admins.length <= 1 ? "The last Installation Admin cannot be revoked" : undefined}
                        onClick={() => void revoke(accountID)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <form
              data-slot="admin-grant"
              onSubmit={(event) => {
                event.preventDefault()
                void grant()
              }}
            >
              <TextInput
                aria-label="Account ID"
                placeholder="acc_…"
                value={state.grant}
                disabled={state.pending}
                onInput={(event) => setState({ grant: event.currentTarget.value })}
              />
              <Button type="submit" variant="primary" disabled={state.grant.trim() === "" || state.pending}>
                Grant admin
              </Button>
            </form>
            <Show when={account.current()}>
              {(profile) => (
                <p data-slot="installation-status">
                  Your Account ID: <code>{profile().id}</code>
                </p>
              )}
            </Show>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}
