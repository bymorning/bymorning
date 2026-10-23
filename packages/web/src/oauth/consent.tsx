import { isUnauthorizedError, type ApiOauthRequestGetInput } from "@bymorning/client"
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createResource, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { useMutation, useQuery } from "@tanstack/solid-query"
import type { Workspace } from "@bymorning/schema/workspace"
import { createQuery } from "../runtime/server/query"
import { workspaceQuery } from "../runtime/workspace"

import { useSDK } from "../context/sdk"
import { Button } from "../ui/components/button"
import { CardPage } from "../ui/components/card-page"
import { errorMessage } from "../utils/error-message"
import { postCommit } from "../utils/post-commit"
import "./consent.css"

/** Authenticate an MCP client and select the workspace it may access. */
export function OAuthConsent(): JSX.Element {
  const sdk = useSDK()
  const location = useLocation()
  const navigate = useNavigate()
  const [search] = useSearchParams<{ request?: string }>()
  const queryClient = createQuery()
  const identity = crypto.randomUUID()
  let disposed = false
  let admitted: string | undefined
  onCleanup(() => {
    disposed = true
    void queryClient.cancelQueries().finally(() => queryClient.clear())
  })
  const workspaces = useQuery(
    () => workspaceQuery({ origin: sdk.baseURL, identity, api: sdk.client }),
    () => queryClient,
  )
  const [consent] = createResource(
    () => search.request,
    async (requestID) => {
      const request = await sdk.client["api.oauth"].request.get({ id: requestID as ApiOauthRequestGetInput["id"] })
      return { requestID: requestID as ApiOauthRequestGetInput["id"], request }
    },
  )
  const action = useMutation(
    () => ({
      retry: false,
      networkMode: "always",
      mutationFn: (
        input:
          | { kind: "approve"; requestID: ApiOauthRequestGetInput["id"]; workspaceID: Workspace.ID }
          | { kind: "deny"; requestID: ApiOauthRequestGetInput["id"] },
      ) =>
        input.kind === "approve"
          ? sdk.client["api.oauth"].approve({ requestID: input.requestID, workspaceID: input.workspaceID })
          : sdk.client["api.oauth"].deny({ requestID: input.requestID }),
    }),
    () => queryClient,
  )
  const relevant = () => action.variables?.requestID === search.request
  const busy = () => relevant() && (action.isPending || action.isSuccess)
  const unauthorized = () =>
    isUnauthorizedError(consent.error) ||
    isUnauthorizedError(workspaces.error) ||
    (consent.error instanceof Error && isUnauthorizedError(consent.error.cause))

  createEffect(
    on(unauthorized, (unauthorized) => {
      if (!unauthorized) return
      navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
    }),
  )

  const approve = (workspaceID: Workspace.ID) => {
    const current = consent()
    if (!current || admitted === current.requestID || busy()) return
    run({ kind: "approve", requestID: current.requestID, workspaceID })
  }

  const deny = () => {
    const current = consent()
    if (!current || admitted === current.requestID || busy()) return
    run({ kind: "deny", requestID: current.requestID })
  }
  const run = (input: NonNullable<typeof action.variables>) => {
    admitted = input.requestID
    void action
      .mutateAsync(input)
      .then(
        ({ url }) =>
          postCommit(() => {
            if (!disposed && search.request === input.requestID) window.location.href = url
          }),
        () => undefined,
      )
      .finally(() => {
        if (admitted === input.requestID) admitted = undefined
      })
  }

  return (
    <CardPage>
      <Switch>
        <Match when={consent.loading || workspaces.isPending}>
          <CardPage.Message role="status">Loading authorization request…</CardPage.Message>
        </Match>
        <Match when={!search.request || ((consent.error || workspaces.error) && !unauthorized())}>
          <CardPage.Title>Authorization request unavailable</CardPage.Title>
          <CardPage.Message role="alert">This request is missing, invalid, or has expired.</CardPage.Message>
        </Match>
        <Match when={consent()}>
          {(current) => (
            <>
              <CardPage.Title>{current().request.clientName} wants access to a workspace</CardPage.Title>
              <CardPage.Description>Choose the workspace this MCP client can access.</CardPage.Description>
              <CardPage.Body>
                <Show
                  when={(workspaces.data?.length ?? 0) > 0}
                  fallback={<CardPage.Message role="status">No workspaces are available.</CardPage.Message>}
                >
                  <ul data-slot="oauth-workspace-list">
                    <For each={workspaces.data}>
                      {(workspace) => (
                        <li>
                          <Button type="button" size="large" disabled={busy()} onClick={() => approve(workspace.id)}>
                            {workspace.name}
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={relevant() && action.error}>
                  {(cause) => (
                    <CardPage.Message role="alert">
                      {errorMessage(cause(), "Could not authorize access.")}
                    </CardPage.Message>
                  )}
                </Show>
                <Button type="button" variant="ghost" disabled={busy()} onClick={deny}>
                  {busy() && action.variables?.kind === "deny" ? "Cancelling…" : "Cancel"}
                </Button>
              </CardPage.Body>
            </>
          )}
        </Match>
      </Switch>
    </CardPage>
  )
}
