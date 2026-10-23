import type { ByMorningClient } from "@bymorning/client"
import { AuthProvider } from "@bymorning/schema/auth-provider"
import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useInstallation } from "../installation/model"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { showToast } from "../ui/components/toast"
import { copyToClipboard } from "../ui/clipboard"
import { errorMessage } from "../utils/error-message"
import { kindLabels, ProviderDialog } from "./provider-dialog"
import "./route.css"

type ProviderClient = ByMorningClient["api.auth-provider"]["authProvider"]
export type SecurityProviderInfo = Awaited<ReturnType<ProviderClient["list"]>>[number]
export type SecurityProviderUpdate = Parameters<ProviderClient["update"]>[0]

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly providers: ReadonlyArray<SecurityProviderInfo>
  readonly pending: boolean
}

/** Settings → SSO: Auth Provider management, reserved for Installation Admins. */
export function SecurityRoute(): JSX.Element {
  const sdk = useSDK()
  const installation = useInstallation()
  return (
    <Show
      when={!installation.loading() && installation.admin()}
      fallback={
        <WorkspacePage title="SSO">
          <Empty variant="panel">An Installation Admin grant is required to manage Auth Providers.</Empty>
        </WorkspacePage>
      }
    >
      <SecurityPage client={sdk.client["api.auth-provider"].authProvider} />
    </Show>
  )
}

/** Auth Provider management. */
export function SecurityPage(props: { readonly client: ProviderClient }): JSX.Element {
  const dialog = useDialog()
  const [state, setState] = createStore<State>({
    phase: "loading",
    providers: [],
    pending: false,
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const refresh = async () => {
    setState({ phase: "loading" })
    try {
      const providers = await props.client.list()
      if (!disposed) setState({ phase: "ready", providers })
    } catch (cause) {
      if (disposed) return
      const message = errorMessage(cause, "Could not load Auth Providers.")
      setState({ phase: "error" })
      showToast({ variant: "error", title: message })
    }
  }
  onMount(() => void refresh())

  const callbackURL = (id: SecurityProviderInfo["id"]) => `${window.location.origin}/auth/callback/${id}`
  const copyCallback = (id: SecurityProviderInfo["id"]) =>
    copyToClipboard(callbackURL(id)).then((result) =>
      showToast({
        variant: result === "copied" ? "success" : "error",
        title: result === "copied" ? "Callback URL copied" : "Could not copy callback URL",
      }),
    )

  const openCreate = () => {
    if (state.phase !== "ready" || state.providers.length > 0) return
    const client = props.client
    const formID = AuthProvider.ID.create()
    dialog.show(() => (
      <ProviderDialog
        formID={formID}
        submit={(values) =>
          client.create({
            id: formID,
            displayName: values.displayName,
            kind: values.kind,
            domains: values.domains,
            issuer: values.issuer,
            clientID: values.clientID,
            clientSecret: values.clientSecret,
          })
        }
        onSuccess={(created) => {
          if (disposed) return
          setState({ providers: [...state.providers, created] })
          showToast({ variant: "success", title: `Auth Provider ${created.displayName} created` })
        }}
      />
    ))
  }

  const openDetail = async (id: string) => {
    const client = props.client
    setState({ pending: true })
    try {
      const detail = await client.get({ providerID: id as SecurityProviderInfo["id"] })
      if (disposed) return
      setState({ pending: false })
      dialog.show(() => (
        <ProviderDialog
          provider={detail}
          submit={(values) =>
            client.update({
              providerID: detail.id,
              id: detail.id,
              revision: detail.revision,
              displayName: values.displayName,
              kind: values.kind,
              domains: values.domains,
              status: detail.status,
              ...(values.clientSecret === "" ? {} : { clientSecret: values.clientSecret }),
            })
          }
          onSuccess={(updated) => {
            if (disposed) return
            setState({
              providers: state.providers.map((item) => (item.id === updated.id ? updated : item)),
            })
            showToast({ variant: "success", title: `Auth Provider ${updated.displayName} updated` })
          }}
        />
      ))
    } catch (cause) {
      if (disposed) return
      setState({ pending: false })
      showToast({ variant: "error", title: errorMessage(cause, "Could not load that Auth Provider.") })
    }
  }

  return (
    <WorkspacePage
      title="SSO"
      actions={
        <Show when={state.phase === "ready" && state.providers.length === 0}>
          <Button variant="primary" icon="central-plus-small" onClick={openCreate}>
            Connect SSO
          </Button>
        </Show>
      }
    >
      <div data-component="security-region">
        <Switch>
          <Match when={state.phase === "loading"}>
            <p role="status" aria-label="Loading Auth Providers" data-slot="security-status">
              Loading Auth Providers…
            </p>
          </Match>
          <Match when={state.phase === "error"}>
            <Button type="button" variant="ghost" onClick={() => void refresh()}>
              Try again
            </Button>
          </Match>
          <Match when={state.phase === "ready"}>
            <Show
              when={state.providers.length > 0}
              fallback={<Empty variant="panel">No SSO connection configured yet.</Empty>}
            >
              <Show when={state.providers.length > 1}>
                <p data-slot="security-notice" role="note">
                  Multiple SSO connections already exist. You can review and edit each connection below, but new
                  connections cannot be added here.
                </p>
              </Show>
              <div data-slot="provider-list">
                <For each={state.providers}>
                  {(provider, index) => {
                    const title = () =>
                      state.providers.length === 1 ? "SSO connection" : `SSO connection ${index() + 1}`
                    return (
                      <section data-slot="provider-details" aria-labelledby={`provider-${provider.id}`}>
                        <h2 id={`provider-${provider.id}`}>{title()}</h2>
                        <dl data-slot="provider-fields">
                          <div>
                            <dt>OpenID Connect (OIDC) Provider</dt>
                            <dd>
                              {kindLabels[provider.kind]}
                              <Show when={provider.status === "disabled"}>
                                <span data-slot="provider-state">Disabled</span>
                              </Show>
                            </dd>
                          </div>
                          <div>
                            <dt>Domain</dt>
                            <dd>{provider.domains.join(", ")}</dd>
                          </div>
                          <div>
                            <dt>Callback URL</dt>
                            <dd data-slot="provider-value-action">
                              <code>{callbackURL(provider.id)}</code>
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={`Copy callback URL for ${title()}`}
                                onClick={() => void copyCallback(provider.id)}
                              >
                                Copy
                              </Button>
                            </dd>
                          </div>
                          <div>
                            <dt>Credentials</dt>
                            <dd data-slot="provider-value-action">
                              <span>Configured</span>
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={`Edit ${title()}`}
                                disabled={state.pending}
                                onClick={() => void openDetail(provider.id)}
                              >
                                Edit
                              </Button>
                            </dd>
                          </div>
                        </dl>
                      </section>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}
