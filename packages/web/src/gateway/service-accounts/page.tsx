import type { ByMorningClient, ServiceAccountListInput, ServiceAccountListOutput } from "@bymorning/client"
import type { ID as ServiceAccountID } from "@bymorning/schema/service-account"
import { A } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"

import type { Data, DataState } from "../../context/data"
import { useDialog } from "../../context/dialog"
import { Button } from "../../ui/components/button"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import { showToast } from "../../ui/components/toast"
import { errorMessage } from "../../utils/error-message"
import { postCommit } from "../../utils/post-commit"
import { WorkspacePage } from "../../home/workspace-page"
import { WorkspaceRoutePath, workspaceRouteHref } from "../../workspace-route-paths"
import { AccountDialog, CreateKeyDialog } from "./account-dialog"
import { AccountRow } from "./account-row"
import { KeyRow } from "./key-row"
import "../page.css"
import "./route.css"

type ServiceAccountMutationClient = Pick<ByMorningClient["serviceAccount"], "create" | "update" | "remove" | "key">
type ServiceAccountKeyClient = Pick<ByMorningClient["serviceAccount"], "key">
type ServiceAccountCatalog = Data["workspace"]["serviceAccount"]
type BudgetCatalog = Data["workspace"]["budget"]
type AccountQuery = ReturnType<Data["gateway"]["serviceAccount"]>
type KeysQuery = ReturnType<Data["gateway"]["serviceAccountKeys"]>
export type WorkspaceID = NonNullable<ServiceAccountListInput["workspace"]>
export type Account = ServiceAccountListOutput[number]

const refresh = (...catalogs: ReadonlyArray<{ invalidate(): void; sync(): Promise<void> }>) => {
  for (const catalog of catalogs) {
    catalog.invalidate()
    void catalog.sync().catch(() => undefined)
  }
}
const errorState = (state: DataState) =>
  state.state === "error" ? { state: "error" as const, message: state.message } : undefined

export function GatewayServiceAccountsPage(props: {
  readonly workspace: WorkspaceID
  readonly accounts: ServiceAccountCatalog
  readonly budget: BudgetCatalog
  readonly client: ServiceAccountMutationClient
}): JSX.Element {
  const dialog = useDialog()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const current = (workspace: WorkspaceID) => !disposed && props.workspace === workspace
  const accounts = () => props.accounts.list()
  const loading = () => {
    const state = props.accounts.state().state
    return state === "loading" || state === "idle"
  }
  const status = () => props.budget.list()
  const usageFor = (id: Account["id"]) =>
    status()?.standings.find(
      (standing) => standing.target.type === "service_account" && standing.target.serviceAccountID === id,
    )
  onMount(() => void Promise.all([props.accounts.sync(), props.budget.sync()]).catch(() => undefined))
  createEffect(
    on(
      () => errorState(props.accounts.state()),
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: () => void props.accounts.sync() }],
        })
      },
    ),
  )
  const openAccount = (account?: Account) => {
    const { workspace, client, accounts, budget } = props
    dialog.show(() => (
      <AccountDialog
        {...(account ? { account } : {})}
        save={(input) =>
          (account
            ? client.update({ workspace, id: account.id, ...input })
            : client.create({ workspace, ...input })
          ).then(() =>
            postCommit(() => {
              refresh(accounts, budget)
              if (current(workspace))
                showToast({
                  variant: "success",
                  title: account ? "Service account updated" : "Service account created",
                })
            }),
          )
        }
      />
    ))
  }
  const openKey = (account?: Account) => {
    const { workspace, client, accounts, budget } = props
    dialog.show(() => (
      <CreateKeyDialog
        {...(account ? { account } : {})}
        accounts={accounts.list()?.filter((candidate) => candidate.status === "active")}
        createAccount={(name) => client.create({ workspace, name, policy: {} })}
        createKey={(owner, name, timeExpires) =>
          client.key.create({ workspace, id: owner.id, name, ...(timeExpires ? { timeExpires } : {}) })
        }
        created={() =>
          postCommit(() => {
            refresh(accounts, budget)
            if (current(workspace)) showToast({ variant: "success", title: "API key created" })
          })
        }
      />
    ))
  }
  const confirmDelete = (account: Account) => {
    const { workspace, client, accounts, budget } = props
    dialog.push(() => (
      <ConfirmDialog
        title="Delete service account?"
        description={`Delete ${account.name} and revoke all of its API keys? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() =>
          client.remove({ workspace, id: account.id }).then(() => postCommit(() => {
            refresh(accounts, budget)
            if (current(workspace)) showToast({ variant: "success", title: "Service account deleted" })
          }))
        }
      />
    ))
  }

  return (
    <WorkspacePage
      layout="table"
      title="Service accounts"
      description="Each holds the API keys an app or coding agent uses to call models through the gateway."
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => openAccount()}>
            New service account
          </Button>
          <Button type="button" variant="primary" icon="central-plus-small" onClick={() => openKey()}>
            Create API key
          </Button>
        </>
      }
    >
      <div data-component="gateway-page">
      <section data-slot="card" data-service-account-list="" aria-label="Service accounts" aria-busy={loading()}>
        <Show when={loading() && accounts() === undefined}>
          <p role="status">Loading service accounts…</p>
        </Show>
        <Show when={!loading() && accounts()?.length === 0}>
          <div data-slot="service-account-empty" role="status">
            <p>No API keys yet. Create one for Claude Code, Codex, or your own software.</p>
            <Button type="button" variant="primary" onClick={() => openKey()}>
              Create API key
            </Button>
          </div>
        </Show>
        <Show when={accounts()?.length}>
          <div data-slot="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Keys</th>
                  <th>Created</th>
                  <th>Usage</th>
                  <th>Limit</th>
                  <th>
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={accounts()?.map((account) => account.id)}>
                  {(accountID) => {
                    const account = () => accounts()!.find((account) => account.id === accountID)!
                    const mutation = useMutation(() => ({
                      retry: false,
                      networkMode: "always",
                      mutationFn: (input: {
                        workspace: WorkspaceID
                        client: ServiceAccountMutationClient
                        accounts: ServiceAccountCatalog
                        id: Account["id"]
                        status: Account["status"]
                      }) => input.client.update({ workspace: input.workspace, id: input.id, status: input.status }),
                      onSuccess: (_, input) => postCommit(() => {
                        refresh(input.accounts)
                        if (current(input.workspace))
                          showToast({
                            variant: "success",
                            title:
                              input.status === "suspended" ? "Service account suspended" : "Service account activated",
                          })
                      }),
                      onError: (cause, input) => {
                        if (current(input.workspace))
                          showToast({
                            variant: "error",
                            title: "Could not update service account",
                            description: errorMessage(cause, "Request failed."),
                          })
                      },
                    }))
                    return (
                      <AccountRow
                        account={account()}
                        workspace={props.workspace}
                        usage={usageFor(accountID)?.spent}
                        limit={usageFor(accountID)?.limit}
                        onEdit={() => openAccount(account())}
                        onCreateKey={() => openKey(account())}
                        onToggleStatus={() => {
                          if (mutation.isPending) return
                          mutation.mutate({
                            workspace: props.workspace,
                            client: props.client,
                            accounts: props.accounts,
                            id: accountID,
                            status: account().status === "active" ? "suspended" : "active",
                          })
                        }}
                        onDelete={() => confirmDelete(account())}
                      />
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
      </div>
    </WorkspacePage>
  )
}

export function GatewayServiceAccountDetailPage(props: {
  readonly workspace: WorkspaceID
  readonly accountID: ServiceAccountID
  readonly account: AccountQuery
  readonly keys: KeysQuery
  readonly client: ServiceAccountKeyClient
}): JSX.Element {
  const dialog = useDialog()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const current = (workspace: WorkspaceID, accountID: ServiceAccountID) =>
    !disposed && props.workspace === workspace && props.accountID === accountID
  const account = () => {
    const current = props.account.state()
    return current.state === "ready" ? current.data : undefined
  }
  const keys = () => {
    const current = props.keys.state()
    return current.state === "ready" ? current.data : undefined
  }
  const keysLoading = () => props.keys.state().state === "loading"
  // The layer retains only the error message; the server's not-found message is stable.
  const notFound = () => {
    const current = props.account.state()
    return current.state === "error" && current.message.startsWith("Service account resource not found:")
  }
  createEffect(
    on(
      () => errorState(props.account.state()),
      (error) => {
        // Not-found is reported by the page copy below, not a retryable toast.
        if (!error || notFound()) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: () => props.account.refetch() }],
        })
      },
    ),
  )
  createEffect(
    on(
      () => errorState(props.keys.state()),
      (error) => {
        if (!error) return
        showToast({
          variant: "error",
          title: error.message,
          actions: [{ label: "Try again", onClick: () => props.keys.refetch() }],
        })
      },
    ),
  )
  const createKey = () => {
    const { workspace, accountID, client, keys } = props
    const owner = account()
    if (!owner) return
    dialog.show(() => (
      <CreateKeyDialog
        account={owner}
        createKey={(_, name, timeExpires) =>
          client.key.create({
            workspace,
            id: accountID,
            name,
            ...(timeExpires ? { timeExpires } : {}),
          })
        }
        created={() => {
          keys.refetch()
          if (current(workspace, accountID)) showToast({ variant: "success", title: "API key created" })
        }}
      />
    ))
  }

  return (
    <WorkspacePage
      layout="table"
      title={account()?.name ?? (notFound() ? "Service account not found" : "Service account")}
      description={
        notFound()
          ? "This service account does not exist in this workspace."
          : "Manage API keys for this service account. Secrets are only shown when a key is created."
      }
      actions={
        <Show when={account()}>
          <Button type="button" variant="primary" icon="central-plus-small" onClick={createKey}>
            Create key
          </Button>
        </Show>
      }
    >
      <div data-component="gateway-page">
      <A
        data-slot="service-account-back"
        href={workspaceRouteHref(props.workspace, WorkspaceRoutePath.gatewayServiceAccounts)}
      >
        Back to service accounts
      </A>
      <Show when={props.account.state().state === "loading" && account() === undefined}>
        <p role="status">Loading service account…</p>
      </Show>
      <Show when={notFound()}>
        <p data-slot="service-account-not-found">The requested service account could not be found.</p>
      </Show>
      <Show when={account()}>
        <section data-slot="card" data-edge-table-card="" aria-label="API keys" aria-busy={keysLoading()}>
          <Show when={keysLoading() && keys() === undefined}>
            <p role="status">Loading API keys…</p>
          </Show>
          <Show when={!keysLoading() && keys()?.length === 0}>
            <div data-slot="service-account-empty">
              <p>No API keys for this service account.</p>
              <Button type="button" variant="primary" onClick={createKey}>
                Create key
              </Button>
            </div>
          </Show>
          <Show when={keys()?.length}>
            <div data-slot="table-wrap">
              <table aria-label="API keys">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>
                      <span class="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={keys()}>
                    {(key) => {
                      const { workspace, accountID, client, keys } = props
                      return (
                        <KeyRow
                          apiKey={key}
                          revoke={() =>
                            client.key.revoke({ workspace, id: accountID, keyID: key.id }).then(() => postCommit(() => {
                              keys.refetch()
                              if (current(workspace, accountID))
                                showToast({ variant: "success", title: "API key revoked" })
                            }))
                          }
                        />
                      )
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      </Show>
      </div>
    </WorkspacePage>
  )
}
