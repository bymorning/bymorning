import type { ID as ServiceAccountID } from "@bymorning/schema/service-account"
import { A, useParams } from "@solidjs/router"
import { Show, type JSX } from "solid-js"

import { useData } from "../../context/data"
import { useSDK } from "../../context/sdk"
import { useWorkspace } from "../../context/workspace"
import { WorkspacePage } from "../../home/workspace-page"
import { WorkspaceRoutePath, workspaceRouteHref } from "../../workspace-route-paths"
import { GatewayServiceAccountDetailPage, GatewayServiceAccountsPage } from "./page"

export function GatewayServiceAccountsRoute(): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  return (
    <GatewayServiceAccountsPage
      workspace={workspace.current().id}
      accounts={data.workspace.serviceAccount}
      budget={data.workspace.budget}
      client={sdk.client.serviceAccount}
    />
  )
}

export function GatewayServiceAccountRoute(): JSX.Element {
  const params = useParams<{ serviceAccountID?: string }>()
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  // Route params only need the ID prefix check; a malformed ID falls through to the not-found page.
  const accountID = () => {
    const value = params.serviceAccountID
    return value?.startsWith("sva_") ? (value as ServiceAccountID) : undefined
  }
  const account = data.gateway.serviceAccount(() => {
    const id = accountID()
    return id === undefined ? undefined : { id }
  })
  // Keys wait for a resolved account so a not-found account never triggers a key read.
  const keys = data.gateway.serviceAccountKeys(() => {
    const id = accountID()
    return id === undefined || account.state().state !== "ready" ? undefined : { id }
  })

  return (
    <Show
      when={accountID()}
      fallback={
        <WorkspacePage
          layout="table"
          title="Invalid service account"
          description="This service account URL is not valid."
        >
          <div data-component="gateway-page">
            <A
              data-slot="gateway-link"
              href={workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.gatewayServiceAccounts)}
            >
              Back to service accounts
            </A>
          </div>
        </WorkspacePage>
      }
    >
      {(id) => (
        <GatewayServiceAccountDetailPage
          workspace={workspace.current().id}
          accountID={id()}
          account={account}
          keys={keys}
          client={sdk.client.serviceAccount}
        />
      )}
    </Show>
  )
}
