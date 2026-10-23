import type { ByMorningClient } from "@bymorning/client"
import { AuthProvider } from "@bymorning/schema/auth-provider"
import type { Provider } from "@bymorning/schema/provider"
import { Option, Schema } from "effect"
import { Match, Show, Switch, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useLeaveGuard } from "../console/leave-guard"
import { useSDK } from "../context/sdk"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { RadioGroup, RadioItem } from "../ui/components/radio"
import { Switch as Toggle } from "../ui/components/switch"
import { TextInput } from "../ui/components/text-input"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import { useInstallation } from "./model"
import "./route.css"

type PolicyData = Awaited<ReturnType<ByMorningClient["installation"]["policy"]["get"]>>
type PolicyInput = Parameters<ByMorningClient["installation"]["policy"]["update"]>[0]

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly provisioning: "invite-only" | "open"
  readonly share: boolean
  readonly websearch: boolean
  readonly providersAllow: string
  readonly pluginsMode: "unrestricted" | "off" | "allowlist"
  readonly pluginsAllow: string
  readonly invitationDomains: string
  readonly pending: boolean
  /** Serialized form values last loaded or saved, to tell whether the form changed. */
  readonly saved: string
}

const snapshot = (state: State) =>
  JSON.stringify([
    state.provisioning,
    state.share,
    state.websearch,
    list(state.providersAllow) ?? [],
    state.pluginsMode,
    state.pluginsMode === "allowlist" ? (list(state.pluginsAllow) ?? []) : [],
    list(state.invitationDomains) ?? [],
  ])

/** The first Invitation domain that is not a valid email domain, if any. */
const invalidDomain = (text: string) =>
  (list(text) ?? []).find((value) => Option.isNone(Schema.decodeUnknownOption(AuthProvider.Domain)(value)))

/** Parse a comma-separated allowlist; an empty text means the field carries no restriction. */
const list = (text: string): ReadonlyArray<string> | undefined => {
  const values = text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
  return values.length === 0 ? undefined : values
}

/** Console → Installation Policy: the mandatory installation restriction document. */
export function InstallationPolicyRoute(): JSX.Element {
  return <InstallationPolicyPage leave={useLeaveGuard} />
}

/** Installation Policy management. */
export function InstallationPolicyPage(props: {
  /** Registers a guard that confirms before navigation discards unsaved changes. */
  readonly leave?: (dirty: () => boolean) => void
}): JSX.Element {
  const sdk = useSDK()
  const installation = useInstallation()
  const [state, setState] = createStore<State>({
    phase: "loading",
    provisioning: "invite-only",
    share: true,
    websearch: true,
    providersAllow: "",
    pluginsMode: "unrestricted",
    pluginsAllow: "",
    invitationDomains: "",
    pending: false,
    saved: "",
  })
  const dirty = createMemo(() => snapshot(state) !== state.saved)
  props.leave?.(dirty)
  const domainError = createMemo(() => {
    const bad = invalidDomain(state.invitationDomains)
    return bad === undefined ? undefined : `"${bad}" is not a valid email domain, such as example.com.`
  })
  const emptyAllowlist = () => state.pluginsMode === "allowlist" && list(state.pluginsAllow) === undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  onMount(async () => {
    try {
      const policy = await sdk.client.installation.policy.get()
      if (disposed) return
      const loaded: Omit<State, "pending" | "saved"> = {
        phase: "ready",
        provisioning: policy.provisioning ?? "invite-only",
        share: policy.share !== "off",
        websearch: policy.websearch !== "off",
        providersAllow: (policy.providers?.allow ?? []).join(", "),
        pluginsMode: policy.plugins === undefined ? "unrestricted" : policy.plugins === "off" ? "off" : "allowlist",
        pluginsAllow: policy.plugins === undefined || policy.plugins === "off" ? "" : policy.plugins.allow.join(", "),
        invitationDomains: (policy.invitations?.domains ?? []).join(", "),
      }
      setState({ ...loaded, saved: snapshot({ ...state, ...loaded }) })
    } catch (cause) {
      if (disposed) return
      setState({ phase: "error" })
      showToast({ variant: "error", title: errorMessage(cause, "Could not load the Installation Policy.") })
    }
  })

  const save = async () => {
    if (state.pending || !dirty()) return
    if (domainError() !== undefined) return
    // What is sent is what becomes saved; edits made while the request is in flight stay dirty.
    const sent = snapshot(state)
    setState({ pending: true })
    const providersAllow = list(state.providersAllow)
    const pluginsAllow = list(state.pluginsAllow)
    const invitationDomains = list(state.invitationDomains)
    const policy: PolicyInput = {
      provisioning: state.provisioning,
      ...(state.share ? {} : { share: "off" as const }),
      ...(state.websearch ? {} : { websearch: "off" as const }),
      ...(providersAllow === undefined ? {} : { providers: { allow: providersAllow as ReadonlyArray<Provider.Name> } }),
      ...(state.pluginsMode === "unrestricted"
        ? {}
        : state.pluginsMode === "off"
          ? { plugins: "off" as const }
          : { plugins: { allow: [...(pluginsAllow ?? [])] } }),
      ...(invitationDomains === undefined ? {} : { invitations: { domains: invitationDomains } }),
    }
    try {
      await sdk.client.installation.policy.update(policy)
      if (disposed) return
      setState({ pending: false, saved: sent })
      showToast({ variant: "success", title: "Installation Policy updated" })
    } catch (cause) {
      if (disposed) return
      setState({ pending: false })
      showToast({ variant: "error", title: errorMessage(cause, "Could not update the Installation Policy.") })
    }
  }

  return (
    <WorkspacePage
      title="Installation Policy"
      description="Mandatory restrictions every Workspace operates under. A Workspace may tighten further, never loosen."
    >
      <div data-component="installation-region">
        <Switch>
          <Match when={installation.loading() || state.phase === "loading"}>
            <p role="status" aria-label="Loading Installation Policy" data-slot="installation-status">
              Loading Installation Policy…
            </p>
          </Match>
          <Match when={!installation.admin()}>
            <Empty variant="panel">An Installation Admin grant is required to manage the Installation Policy.</Empty>
          </Match>
          <Match when={state.phase === "error"}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setState({ phase: "loading" })
                window.location.reload()
              }}
            >
              Try again
            </Button>
          </Match>
          <Match when={state.phase === "ready"}>
            <form
              data-slot="policy-form"
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <RadioGroup
                label="Account provisioning"
                value={state.provisioning}
                onChange={(value) => setState({ provisioning: value as State["provisioning"] })}
              >
                <RadioItem
                  value="invite-only"
                  label="Invite-only"
                  description="A first login requires an invitation."
                />
                <RadioItem
                  value="open"
                  label="Open"
                  description="A first login from an admitted domain provisions a new Workspace."
                />
              </RadioGroup>
              <div data-slot="policy-field">
                <Toggle checked={state.share} onChange={(checked) => setState({ share: checked })}>
                  Allow public Session sharing
                </Toggle>
                <p data-slot="policy-hint">Disabled installation-wide removes the share Tool from every Workspace.</p>
              </div>
              <div data-slot="policy-field">
                <Toggle checked={state.websearch} onChange={(checked) => setState({ websearch: checked })}>
                  Allow web search
                </Toggle>
                <p data-slot="policy-hint">Disabled installation-wide removes web search from every Workspace.</p>
              </div>
              <div data-slot="policy-field">
                <label for="policy-providers-allow">Provider allowlist</label>
                <TextInput
                  id="policy-providers-allow"
                  placeholder="Every Provider (unrestricted)"
                  value={state.providersAllow}
                  onInput={(event) => setState({ providersAllow: event.currentTarget.value })}
                />
                <p data-slot="policy-hint">Comma-separated Provider names. Workspaces cannot exceed this list.</p>
              </div>
              <RadioGroup
                label="Plugins"
                value={state.pluginsMode}
                onChange={(value) => setState({ pluginsMode: value as State["pluginsMode"] })}
              >
                <RadioItem value="unrestricted" label="Unrestricted" />
                <RadioItem value="off" label="Off" description="No Workspace may run Plugins." />
                <RadioItem value="allowlist" label="Allowlist" description="Only the listed package names may run." />
              </RadioGroup>
              <Show when={state.pluginsMode === "allowlist"}>
                <div data-slot="policy-field">
                  <label for="policy-plugins-allow">Plugin allowlist</label>
                  <TextInput
                    id="policy-plugins-allow"
                    placeholder="@bymorning/plugin-share"
                    value={state.pluginsAllow}
                    onInput={(event) => setState({ pluginsAllow: event.currentTarget.value })}
                  />
                  <p data-slot="policy-hint">Comma-separated Plugin package names.</p>
                  <Show when={emptyAllowlist()}>
                    <p role="alert" data-slot="policy-warning">
                      An empty allowlist blocks every Plugin in every Workspace. Add package names, or choose
                      Unrestricted.
                    </p>
                  </Show>
                </div>
              </Show>
              <div data-slot="policy-field">
                <label for="policy-invitation-domains">Invitation domains</label>
                <TextInput
                  id="policy-invitation-domains"
                  placeholder="Default: Auth Provider domains"
                  invalid={domainError() !== undefined}
                  aria-describedby="policy-invitation-domains-hint"
                  value={state.invitationDomains}
                  onInput={(event) => setState({ invitationDomains: event.currentTarget.value })}
                />
                <p id="policy-invitation-domains-hint" data-slot="policy-hint">
                  Comma-separated email domains. Replaces the Auth Provider domain union.
                </p>
                <Show when={domainError()}>
                  {(message) => (
                    <p role="alert" data-slot="policy-warning">
                      {message()}
                    </p>
                  )}
                </Show>
              </div>
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={state.pending || !dirty() || domainError() !== undefined}
                >
                  {state.pending ? "Saving…" : "Save policy"}
                </Button>
              </div>
            </form>
          </Match>
        </Switch>
      </div>
    </WorkspacePage>
  )
}
