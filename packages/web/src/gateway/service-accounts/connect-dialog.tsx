import { createMemo, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../../context/data"
import { useEntry } from "../../context/dialog"
import { createProviderCatalog } from "../../integration/providers/model"
import { useScope } from "../../runtime/server/runtime"
import { copyToClipboard } from "../../ui/clipboard"
import { Button } from "../../ui/components/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "../../ui/components/dialog"
import { Field } from "../../ui/components/field"
import { TextInput } from "../../ui/components/text-input"
import { showToast } from "../../ui/components/toast"
import { available, clients, formatLabel, type ActiveModel, type Client, type Format } from "./connect"
import "./connect-dialog.css"

/**
 * Enabled Models with an active Provider, and the formats they cover.
 * Undefined until both reads settle so the dialog never hides a client for lack of data.
 */
function useActiveModels() {
  const scope = useScope()
  const data = useData()
  const resource = new AbortController()
  onCleanup(() => resource.abort())
  const providers = createProviderCatalog({ api: scope.api, workspace: scope.workspace, signal: resource.signal })
  onMount(() => {
    void providers.sync().catch(() => undefined)
    void data.workspace.model.sync().catch(() => undefined)
  })
  return createMemo(() => {
    const models = data.workspace.model.list()
    const state = providers.state()
    if (
      models === undefined ||
      state.state === "idle" ||
      (state.state === "loading" && state.refreshedAt === undefined)
    )
      return undefined
    if (state.state === "error") return undefined
    const formats = new Set<Format>()
    const active: ActiveModel[] = []
    for (const model of models) {
      const provider = providers.directory().find((entry) => entry.info.name === model.provider)
      if (!provider?.active) continue
      formats.add(provider.info.format)
      active.push({ id: `${model.provider}/${model.id}`, format: provider.info.format })
    }
    return { formats, models: active }
  })
}

/** The one time a key's secret is visible, with the configuration each client needs to use it. */
export function ConnectDialog(props: { readonly secret: string; readonly origin?: string }): JSX.Element {
  const entry = useEntry()
  const active = useActiveModels()
  const origin = () => props.origin ?? window.location.origin
  const offered = createMemo(() => available(active()?.formats))
  const [state, setState] = createStore<{ client: Client["id"] | undefined; warned: boolean }>({
    client: undefined,
    warned: false,
  })
  // The secret is never shown again, so the first Escape, backdrop click or close button only warns.
  entry.guard(() => {
    if (state.warned) return false
    setState("warned", true)
    return true
  })
  const selected = createMemo(() => offered().find((client) => client.id === state.client) ?? offered()[0])
  const config = () => selected()?.config({ origin: origin(), key: props.secret, models: active()?.models ?? [] })
  const hidden = createMemo(() => clients.filter((client) => !offered().includes(client)))
  const hiddenNote = () =>
    hidden()
      .map((client) => `${client.label} (${formatLabel[client.needs!]})`)
      .join(", ")
  const copy = (value: string, what: string) =>
    void copyToClipboard(value).then((result) =>
      showToast({
        variant: result === "copied" ? "success" : "error",
        title: result === "copied" ? `${what} copied` : `Could not copy ${what.toLowerCase()}`,
      }),
    )
  return (
    <Dialog fit variant="card" size="large" data-component="connect-dialog" aria-label="Copy your API key">
      <DialogHeader>
        <DialogTitleGroup title="Copy your API key" description="This key won't be shown again. Store it securely." />
      </DialogHeader>
      <DialogBody>
        <div data-slot="secret-key-fields">
          <Field>
            <Field.Label>API key</Field.Label>
            <TextInput
              readOnly
              appearance="full-width"
              value={props.secret}
              showCopyButton
              copyLabel="Copy API key"
              onCopyClick={() => copy(props.secret, "API key")}
            />
          </Field>
        </div>
        <Show when={state.warned}>
          <p role="alert" data-slot="secret-warning">
            This key won't be shown again. Copy it now, then choose Done to close.
          </p>
        </Show>
        <section data-slot="connect" aria-labelledby="connect-title">
          <h3 id="connect-title">Connect a client</h3>
          <div data-slot="connect-tabs" role="tablist" aria-label="Client">
            <For each={offered()}>
              {(client) => (
                <Button
                  type="button"
                  size="small"
                  role="tab"
                  variant={selected()?.id === client.id ? "neutral" : "ghost"}
                  aria-selected={selected()?.id === client.id}
                  onClick={() => setState("client", client.id)}
                >
                  {client.label}
                </Button>
              )}
            </For>
          </div>
          <Show when={config()}>
            {(text) => (
              <>
                <pre data-slot="connect-config">
                  <code>{text()}</code>
                </pre>
                <div data-slot="connect-actions">
                  <Button type="button" icon="outline-copy" onClick={() => copy(text(), "Configuration")}>
                    Copy configuration
                  </Button>
                </div>
              </>
            )}
          </Show>
          <Show when={hidden().length > 0}>
            <p data-slot="connect-note">
              {hidden()
                .map((client) => client.label)
                .join(", ")}{" "}
              {hidden().length === 1 ? "needs" : "need"} a provider in {hidden().length === 1 ? "its" : "their"} native
              format enabled under Models.
            </p>
          </Show>
        </section>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="primary" size="large" onClick={() => entry.close()}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
