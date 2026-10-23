import { useSearchParams } from "@solidjs/router"
import type { ByMorningClient } from "@bymorning/client"
import { AuthSchema } from "@bymorning/schema/auth"
import { Schema } from "effect"
import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSDK } from "../context/sdk"
import { Button } from "../ui/components/button"
import { CardPage } from "../ui/components/card-page"
import { Checkbox } from "../ui/components/checkbox"
import "./route.css"

type Method = Awaited<ReturnType<ByMorningClient["auth"]["method"]>>

/**
 * One operator-facing next step per coarse callback failure reason. The server
 * sends only the reason code; nothing here echoes provider or account data.
 */
export const failureHints: Record<AuthSchema.FailureReason, string> = {
  exchange:
    "ByMorning could not complete the sign-in with your identity provider; check the client secret, the redirect URI, and the Gateway's outbound HTTPS access to the provider.",
  claims:
    "Your identity provider did not send a verified email address. For Microsoft Entra, add the optional ID token claims email and xms_edov.",
  domain: "Your email domain is not admitted for this sign-in provider; ask an administrator to add it.",
  provider: "This sign-in provider was removed, disabled, or changed during sign-in; choose it again below.",
  expired: "The sign-in attempt expired or was started in another browser; start again from this page.",
  account: "Your account cannot sign in here yet: ask an administrator for an invitation or to restore your account.",
  unknown: "The server log records the cause as “Authentication callback failed”.",
}
const isFailureReason = Schema.is(AuthSchema.FailureReason)

interface State {
  readonly phase: "loading" | "ready" | "fallback"
  readonly method: Method | null
  /** Set once the person checks the system use notification acknowledgment. */
  readonly acknowledged: boolean
}

/** Render the public browser authentication entrypoint. */
export function LoginRoute(): JSX.Element {
  const sdk = useSDK()
  const [search] = useSearchParams<{ redirect?: string; auth?: string; reason?: string }>()
  const [state, setState] = createStore<State>({ phase: "loading", method: null, acknowledged: false })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  onMount(() => {
    void sdk.client.auth
      .method()
      .then((method) => {
        if (disposed) return
        if (skipLogin(method)) {
          window.location.replace(loginURL())
          return
        }
        setState({ phase: "ready", method })
      })
      .catch(() => {
        if (!disposed) setState({ phase: "fallback", method: null })
      })
  })
  const loginURL = (providerID?: string) => {
    const url = new URL("/auth/login", sdk.baseURL)
    if (providerID) url.searchParams.set("provider", providerID)
    if (search.redirect) url.searchParams.set("redirect", search.redirect)
    return url.href
  }
  const failed = () => search.auth === "failed"
  const failureHint = () => {
    const reason = search.reason
    return failed() && isFailureReason(reason) ? failureHints[reason] : undefined
  }
  /**
   * Local Login is the only choice on a loopback origin without providers, so the
   * card is skipped, but never past a configured system use notification or a
   * failed attempt.
   */
  const skipLogin = (method: Method) =>
    method.state === "ready" &&
    method.local &&
    method.providers.length === 0 &&
    (method.banner === undefined || method.banner === "") &&
    !failed()
  const setupState = () => {
    const method = state.method
    return method?.state === "setup" ? method : undefined
  }
  const readyState = () => {
    const method = state.method
    return method?.state === "ready" ? method : undefined
  }
  const banner = () => {
    const banner = state.method?.banner
    return banner === undefined || banner === "" ? undefined : banner
  }
  /** Sign-in actions stay inert until the notice is acknowledged. */
  const gated = () => banner() !== undefined && !state.acknowledged

  return (
    <CardPage>
      <Show when={failed()}>
        <CardPage.Message role="alert">
          That sign-in attempt failed. Choose a provider below to try again.
          <Show when={failureHint()}>{(hint) => <span data-slot="login-failure-hint">{hint()}</span>}</Show>
        </CardPage.Message>
      </Show>
      <Switch>
        <Match when={state.phase === "loading"}>
          <CardPage.Message role="status">Loading sign-in options…</CardPage.Message>
        </Match>
        <Match when={state.phase === "fallback"}>
          <CardPage.Body>
            <FallbackAction />
          </CardPage.Body>
        </Match>
        <Match when={setupState()}>
          <CardPage.Message role="status">
            This installation needs its first Auth Provider before anyone can sign in.
          </CardPage.Message>
          <CardPage.Body>
            <Button as="a" variant="primary" size="large" href="/setup">
              Open setup
            </Button>
          </CardPage.Body>
        </Match>
        <Match when={readyState()}>
          {(method) => (
            <CardPage.Body>
              <Show when={banner()}>
                {(text) => (
                  <section data-slot="login-banner" aria-label="System use notification">
                    <p data-slot="login-banner-text">{text()}</p>
                    <Checkbox
                      label="I have read and acknowledge this notice."
                      checked={state.acknowledged}
                      onChange={(checked) => setState({ acknowledged: checked })}
                    />
                  </section>
                )}
              </Show>
              <Show when={!gated()}>
                <Show when={method().providers.length > 0}>
                  <ul data-slot="login-providers">
                    <For each={method().providers}>
                      {(provider) => (
                        <li>
                          <Button as="a" variant="primary" size="large" href={loginURL(provider.id)} target="_self">
                            Continue with {provider.displayName}
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={method().local}>
                  <Button as="a" variant="primary" size="large" href={loginURL()} target="_self">
                    Continue locally
                  </Button>
                </Show>
                <Show when={method().providers.length === 0 && !method().local}>
                  <CardPage.Message role="status">No sign-in method is available yet.</CardPage.Message>
                  <Button as="a" variant="primary" size="large" href="/setup">
                    Open setup
                  </Button>
                </Show>
              </Show>
            </CardPage.Body>
          )}
        </Match>
      </Switch>
    </CardPage>
  )
}

/**
 * Preserve the historical single-action login when provider inventory is
 * unavailable. Without a method response the label cannot name the method.
 */
function FallbackAction(): JSX.Element {
  const sdk = useSDK()
  const [search] = useSearchParams<{ redirect?: string }>()
  const loginURL = () => {
    const url = new URL("/auth/login", sdk.baseURL)
    if (search.redirect) url.searchParams.set("redirect", search.redirect)
    return url.href
  }
  return (
    <Button as="a" variant="primary" size="large" href={loginURL()} target="_self">
      Continue
    </Button>
  )
}
