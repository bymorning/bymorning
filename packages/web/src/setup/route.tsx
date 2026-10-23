import type { ByMorningClient } from "@bymorning/client"
import { AuthProvider } from "@bymorning/schema/auth-provider"
import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSDK } from "../context/sdk"
import { copyToClipboard } from "../ui/clipboard"
import { Button } from "../ui/components/button"
import { CardPage } from "../ui/components/card-page"
import { Field } from "../ui/components/field"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"
import { showToast } from "../ui/components/toast"
import { microsoftCloudLabels, microsoftClouds, microsoftTenantIssuer, type MicrosoftCloud } from "../security/microsoft"
import { errorMessage } from "../utils/error-message"
import "./route.css"

type Info = Awaited<ReturnType<ByMorningClient["auth"]["inspect"]>>[number]
type Kind = Info["kind"]

/** Kinds offered for a new provider; legacy kinds remain readable on existing rows. */
const newKinds: ReadonlyArray<Kind> = ["google", "okta", "microsoft", "custom"]
const kindLabels: Record<Kind, string> = {
  google: "Google Workspace",
  okta: "Okta",
  microsoft: "Microsoft Entra",
  auth0: "Auth0",
  ping: "Ping",
  custom: "Custom",
}
const issuerPlaceholders: Record<Kind, string> = {
  google: "https://accounts.google.com",
  okta: "https://<org>.okta.com",
  microsoft: "",
  auth0: "https://<tenant>.auth0.com",
  ping: "https://<host>",
  custom: "https://issuer.example.com",
}
const statuses = ["enabled", "disabled"] as const


type Step = "token" | "create" | "update" | "done"

interface State {
  /** Setup token; memory-only, never placed in the URL or any storage. */
  readonly token: string
  readonly inspected: boolean
  readonly providers: ReadonlyArray<Info>
  readonly mode: "create" | "update"
  readonly selectedID: string
  readonly formID: string
  readonly callbackBase: string | undefined
  readonly displayName: string
  readonly kind: Kind
  readonly issuer: string
  readonly cloud: MicrosoftCloud
  readonly tenantID: string
  readonly clientID: string
  readonly clientSecret: string
  readonly domains: string
  readonly status: "enabled" | "disabled"
  readonly pending: boolean
  readonly error: string | undefined
  readonly done: string | undefined
}

/**
 * Register the first Auth Provider or recover a broken one with the setup
 * token. The token lives only in this component's memory: it is typed into a
 * password field, sent in POST bodies, and never written to the URL or
 * browser storage.
 */
export function SetupRoute(): JSX.Element {
  const sdk = useSDK()
  const [state, setState] = createStore<State>({
    token: "",
    inspected: false,
    providers: [],
    mode: "create",
    selectedID: "",
    formID: AuthProvider.ID.create(),
    callbackBase: undefined,
    displayName: "",
    kind: "custom",
    issuer: "",
    cloud: "commercial",
    tenantID: "",
    clientID: "",
    clientSecret: "",
    domains: "",
    status: "enabled",
    pending: false,
    error: undefined,
    done: undefined,
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  onMount(() => {
    void sdk.client.auth
      .method()
      .then((method) => {
        if (!disposed) setState({ callbackBase: method.callbackBase })
      })
      .catch(() => {})
  })

  const selected = () => state.providers.find((provider) => provider.id === state.selectedID)
  const callbackURL = () => `${state.callbackBase ?? `${window.location.origin}/auth/callback`}/${state.formID}`
  const providerName = () =>
    state.mode === "create" && state.kind !== "custom" ? kindLabels[state.kind] : state.displayName
  const providerIssuer = () => (state.kind === "microsoft" ? microsoftTenantIssuer(state.cloud, state.tenantID) : state.issuer.trim())
  const parseDomains = () =>
    state.domains
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")

  const copyCallback = () =>
    copyToClipboard(callbackURL()).then((result) =>
      showToast({
        variant: result === "copied" ? "success" : "error",
        title: result === "copied" ? "Callback URL copied" : "Could not copy callback URL",
      }),
    )

  const inspect = async (event: SubmitEvent) => {
    event.preventDefault()
    if (state.pending || state.token === "") {
      setState({ error: state.token === "" ? "Enter the setup token." : state.error })
      return
    }
    setState({ pending: true, error: undefined })
    try {
      const providers = await sdk.client.auth.inspect({ token: state.token })
      const first = providers[0]
      setState({
        inspected: true,
        providers,
        mode: "create",
        selectedID: "",
        formID: AuthProvider.ID.create(),
        pending: false,
        error: undefined,
      })
      if (first) setState({ selectedID: first.id })
    } catch (cause) {
      setState({ pending: false, error: errorMessage(cause, "That setup token was not accepted.") })
    }
  }

  const pickProvider = (target: Info) =>
    setState({
      selectedID: target.id,
      displayName: target.displayName,
      kind: target.kind,
      domains: target.domains.join(", "),
      status: target.status,
      clientSecret: "",
      error: undefined,
      done: undefined,
    })

  const pickMode = (mode: "create" | "update") => {
    if (mode === "create") {
      setState({
        mode,
        selectedID: "",
        formID: AuthProvider.ID.create(),
        displayName: "",
        kind: "custom",
        issuer: "",
        cloud: "commercial",
        tenantID: "",
        clientID: "",
        clientSecret: "",
        domains: "",
        error: undefined,
        done: undefined,
      })
      return
    }
    const target = selected() ?? state.providers[0]
    if (!target) return
    setState({ mode })
    pickProvider(target)
  }

  const missing = () => {
    const names: Array<string> = []
    if (state.mode === "create") {
      if (state.kind === "custom" && !state.displayName.trim()) names.push("display name")
      if (state.kind === "microsoft" ? !state.tenantID.trim() : !state.issuer.trim()) {
        names.push(state.kind === "microsoft" ? "tenant ID" : "issuer")
      }
      if (!state.clientID.trim()) names.push("client ID")
      if (!state.clientSecret) names.push("client secret")
    } else if (!state.displayName.trim()) {
      names.push("display name")
    }
    if (parseDomains().length === 0) names.push("at least one email domain")
    return names
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const required = missing()
    if (required.length > 0) {
      const list = required.length === 1 ? required[0] : `${required.slice(0, -1).join(", ")}, and ${required.at(-1)}`
      setState({ error: `Enter the ${list}.` })
      return
    }
    const domains = parseDomains() as [string, ...Array<string>]
    setState({ pending: true, error: undefined, done: undefined })
    try {
      if (state.mode === "create") {
        const created = await sdk.client.auth.setup({
          payload: {
            type: "create",
            token: state.token,
            value: {
              id: state.formID as Info["id"],
              displayName: providerName(),
              kind: state.kind,
              domains,
              issuer: providerIssuer(),
              clientID: state.clientID.trim(),
              clientSecret: state.clientSecret,
            },
          },
        })
        setState({
          pending: false,
          done: `${created.displayName} is ready. Sign in with an admitted email address to connect a model provider and start your first session.`,
          providers: [...state.providers, created],
          formID: AuthProvider.ID.create(),
          clientSecret: "",
        })
      } else {
        const target = selected()
        if (!target) return
        const updated = await sdk.client.auth.setup({
          payload: {
            type: "update",
            token: state.token,
            value: {
              id: target.id,
              revision: target.revision,
              displayName: state.displayName.trim(),
              kind: state.kind,
              domains,
              status: state.status,
              ...(state.clientSecret === "" ? {} : { clientSecret: state.clientSecret }),
            },
          },
        })
        setState({
          pending: false,
          done: `${updated.displayName} is now at revision ${updated.revision}.`,
          providers: state.providers.map((provider) => (provider.id === updated.id ? updated : provider)),
          clientSecret: "",
        })
      }
    } catch (cause) {
      setState({ pending: false, error: errorMessage(cause, "Setup did not complete.") })
    }
  }

  const step = (): Step => (!state.inspected ? "token" : state.done !== undefined ? "done" : state.mode)
  const title = () => {
    switch (step()) {
      case "token":
        return "Enter setup token"
      case "create":
        return "Register an Auth Provider"
      case "update":
        return "Recover an Auth Provider"
      case "done":
        return state.mode === "create" ? "Auth Provider registered" : "Auth Provider recovered"
    }
  }
  const description = () => {
    switch (step()) {
      case "token":
        return "Enter the setup token supplied by your operator to register your identity provider; after signing in you will connect a model provider and start your first session."
      case "create":
        return "Create a web OIDC client in your identity provider using the callback URL below, then enter its credentials here."
      case "update":
        return "Everything except the issuer and client ID can change. Saving creates a new revision."
      case "done":
        return undefined
    }
  }

  return (
    <CardPage>
      <CardPage.Title>{title()}</CardPage.Title>
      <Show when={description()}>{(text) => <CardPage.Description>{text()}</CardPage.Description>}</Show>
      <Show when={state.error}>{(error) => <CardPage.Message role="alert">{error()}</CardPage.Message>}</Show>
      <Switch>
        <Match when={step() === "done"}>
          <CardPage.Message role="status">{state.done}</CardPage.Message>
          <CardPage.Body>
            <Button as="a" variant="primary" size="large" href="/login">
              Continue to login
            </Button>
            <Button type="button" variant="ghost" onClick={() => setState({ done: undefined })}>
              Make another change
            </Button>
          </CardPage.Body>
        </Match>
        <Match when={step() === "token"}>
          <CardPage.Body>
            <form
              data-slot="setup-token-form"
              aria-label="Verify setup token"
              onSubmit={(event) => void inspect(event)}
            >
              <Field>
                <Field.Label>Setup token</Field.Label>
                <TextInput
                  type="password"
                  autocomplete="one-time-code"
                  required
                  appearance="full-width"
                  value={state.token}
                  disabled={state.pending}
                  onInput={(event) => setState({ token: event.currentTarget.value })}
                />
                <Field.Suffix>
                  Set by your operator, or written owner-read-only to the server's setup-token file at startup.
                </Field.Suffix>
              </Field>
              <Button type="submit" variant="primary" size="large" disabled={state.pending}>
                {state.pending ? "Verifying…" : "Continue"}
              </Button>
            </form>
          </CardPage.Body>
        </Match>
        <Match when={state.inspected}>
          <CardPage.Body>
            <div data-slot="setup-mode">
              <Button
                type="button"
                variant={state.mode === "create" ? "primary" : "ghost"}
                onClick={() => pickMode("create")}
              >
                Register new provider
              </Button>
              <Button
                type="button"
                variant={state.mode === "update" ? "primary" : "ghost"}
                disabled={state.providers.length === 0}
                onClick={() => pickMode("update")}
              >
                Recover existing provider
              </Button>
            </div>
            <Show when={state.providers.length > 0}>
              <ul data-slot="setup-known-providers">
                <For each={state.providers}>
                  {(provider) => (
                    <li>
                      <strong>{provider.displayName}</strong> <span>revision {provider.revision}</span>{" "}
                      <span>{provider.status}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <form data-slot="setup-provider-form" aria-label="Auth Provider" onSubmit={(event) => void submit(event)}>
              <Show when={state.mode === "update"}>
                <Field>
                  <Field.Label>Provider</Field.Label>
                  <Select
                    aria-label="Provider"
                    appearance="full-width"
                    options={[...state.providers]}
                    current={selected()}
                    disabled={state.pending}
                    value={(provider) => provider.id}
                    label={(provider) => provider.displayName}
                    onSelect={(target) => target && pickProvider(target)}
                  />
                </Field>
              </Show>
              <Field>
                <Field.Label>OpenID Connect (OIDC) Provider</Field.Label>
                <Select
                  aria-label="OpenID Connect (OIDC) Provider"
                  appearance="full-width"
                  options={state.mode === "create" ? [...newKinds] : [state.kind]}
                  current={state.kind}
                  disabled={state.pending || state.mode === "update"}
                  label={(kind) => kindLabels[kind]}
                  onSelect={(kind) => kind && setState({ kind })}
                />
              </Field>
              <Show when={state.mode === "update" || state.kind === "custom"}>
                <Field>
                  <Field.Label>Display name</Field.Label>
                  <TextInput
                    required
                    appearance="full-width"
                    placeholder="Shown on the sign-in button"
                    value={state.displayName}
                    disabled={state.pending}
                    onInput={(event) => setState({ displayName: event.currentTarget.value })}
                  />
                </Field>
              </Show>
              <Show when={state.mode === "create"}>
                <Field>
                  <Field.Label>Callback URL</Field.Label>
                  <TextInput
                    readOnly
                    appearance="full-width"
                    value={callbackURL()}
                    showCopyButton
                    copyLabel="Copy callback URL"
                    onCopyClick={() => void copyCallback()}
                  />
                  <Field.Suffix>Register this redirect URI in your identity provider before saving.</Field.Suffix>
                </Field>
                <Show
                  when={state.kind === "microsoft"}
                  fallback={
                    <Field>
                      <Field.Label>Issuer</Field.Label>
                      <TextInput
                        required
                        type="url"
                        appearance="full-width"
                        placeholder={issuerPlaceholders[state.kind]}
                        value={state.issuer}
                        disabled={state.pending}
                        onInput={(event) => setState({ issuer: event.currentTarget.value })}
                      />
                      <Field.Suffix>Must match the issuer in its OpenID discovery document.</Field.Suffix>
                    </Field>
                  }
                >
                  <Field>
                    <Field.Label>Microsoft Entra cloud</Field.Label>
                    <Select
                      aria-label="Microsoft Entra cloud"
                      appearance="full-width"
                      options={[...microsoftClouds]}
                      current={state.cloud}
                      disabled={state.pending}
                      label={(cloud) => microsoftCloudLabels[cloud]}
                      onSelect={(cloud) => cloud && setState({ cloud })}
                    />
                  </Field>
                  <Field>
                    <Field.Label>Microsoft Entra tenant ID</Field.Label>
                    <TextInput
                      required
                      appearance="full-width"
                      placeholder="00000000-0000-0000-0000-000000000000"
                      value={state.tenantID}
                      disabled={state.pending}
                      onInput={(event) => setState({ tenantID: event.currentTarget.value })}
                    />
                    <Field.Suffix>Use the Directory (tenant) ID from Microsoft Entra.</Field.Suffix>
                  </Field>
                </Show>
                <Field>
                  <Field.Label>Client ID</Field.Label>
                  <TextInput
                    required
                    appearance="full-width"
                    value={state.clientID}
                    disabled={state.pending}
                    onInput={(event) => setState({ clientID: event.currentTarget.value })}
                  />
                </Field>
              </Show>
              <Field>
                <Field.Label>Client secret</Field.Label>
                <TextInput
                  type="password"
                  appearance="full-width"
                  required={state.mode === "create"}
                  autocomplete="new-password"
                  value={state.clientSecret}
                  disabled={state.pending}
                  onInput={(event) => setState({ clientSecret: event.currentTarget.value })}
                />
                <Show when={state.mode === "update"}>
                  <Field.Suffix>Leave empty to keep the stored value.</Field.Suffix>
                </Show>
              </Field>
              <Field>
                <Field.Label>Email domains</Field.Label>
                <TextInput
                  required
                  appearance="full-width"
                  placeholder="example.com, example.org"
                  value={state.domains}
                  disabled={state.pending}
                  onInput={(event) => setState({ domains: event.currentTarget.value })}
                />
                <Field.Suffix>Comma-separated. Only people at these domains can sign in.</Field.Suffix>
              </Field>
              <Show when={state.mode === "update"}>
                <Field>
                  <Field.Label>Status</Field.Label>
                  <Select
                    aria-label="Status"
                    appearance="full-width"
                    options={[...statuses]}
                    current={state.status}
                    disabled={state.pending}
                    label={(status) => (status === "enabled" ? "Enabled" : "Disabled")}
                    onSelect={(status) => status && setState({ status })}
                  />
                </Field>
              </Show>
              <Button type="submit" variant="primary" size="large" disabled={state.pending}>
                {state.pending ? "Saving…" : state.mode === "create" ? "Register provider" : "Recover provider"}
              </Button>
            </form>
          </CardPage.Body>
        </Match>
      </Switch>
    </CardPage>
  )
}
