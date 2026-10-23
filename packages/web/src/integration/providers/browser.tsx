import type { ModelListOutput, ProviderDirectoryEntry } from "@bymorning/client"
import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useScope } from "../../runtime/server/runtime"
import { Button } from "../../ui/components/button"
import { Catalog, CatalogBody, CatalogCopy, CatalogRow } from "../../ui/components/catalog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "../../ui/components/dialog"
import { TextInput } from "../../ui/components/text-input"

const unavailableLabel = (reason: NonNullable<ModelListOutput[number]["unavailableReason"]>) => {
  if (reason === "connection-unavailable") return "Connect this provider to use this model."
  if (reason === "provider-disabled") return "This provider is disabled."
  if (reason === "provider-inactive") return "Activate this provider to use this model."
  if (reason === "region-unsupported") return "This model is unavailable in the active AWS region."
  return "This model's transport is not supported."
}

/** Provider-scoped discovery includes disconnected and unavailable models. */
export function ProviderBrowser(props: {
  readonly entry: ProviderDirectoryEntry
  readonly onConnect: () => void
  readonly onEnable?: () => Promise<unknown>
  readonly enablePending?: boolean
}) {
  const scope = useScope()
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [state, setState] = createStore({ search: "", page: 0 })
  const [models, { refetch }] = createResource(
    () => props.entry.info.name,
    (provider) => scope.api.model.list({ workspace: scope.workspace, provider }, { signal: abort.signal }),
  )
  const filtered = createMemo(() => {
    const query = state.search.trim().toLocaleLowerCase()
    return (models.error ? [] : (models() ?? [])).filter(({ info }) =>
      `${info.id} ${info.name}`.toLocaleLowerCase().includes(query),
    )
  })
  return (
    <Dialog size="large" data-component="provider-browser">
      <DialogHeader>
        <DialogTitle>{props.entry.info.displayName ?? props.entry.info.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div data-slot="provider-browser-toolbar">
          <TextInput
            type="search"
            aria-label="Search models"
            placeholder="Search models"
            value={state.search}
            onInput={(event) => setState({ search: event.currentTarget.value, page: 0 })}
          />
          <span data-slot="provider-browser-count">{filtered().length} models</span>
        </div>
        <Show when={models.loading}>
          <p role="status">Loading models…</p>
        </Show>
        <Show when={models.error}>
          <Button onClick={() => void refetch()}>Retry loading models</Button>
        </Show>
        <Catalog aria-label="Provider models">
          <For each={filtered().slice(state.page * 100, (state.page + 1) * 100)}>
            {({ info, unavailableReason }) => (
              <CatalogRow>
                <CatalogBody>
                  <CatalogCopy title={info.name} description={info.id} />
                </CatalogBody>
                <Show when={unavailableReason}>{(reason) => <small>{unavailableLabel(reason())}</small>}</Show>
              </CatalogRow>
            )}
          </For>
        </Catalog>
        <Show when={filtered().length > 100}>
          <div data-slot="provider-browser-pagination">
            <Button disabled={state.page === 0} onClick={() => setState("page", (page) => page - 1)}>
              Previous
            </Button>
            <span>
              Page {state.page + 1} of {Math.ceil(filtered().length / 100)}
            </span>
            <Button
              disabled={(state.page + 1) * 100 >= filtered().length}
              onClick={() => setState("page", (page) => page + 1)}
            >
              Next
            </Button>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Show
          when={
            props.entry.info.name === "amazon-bedrock" &&
            !props.entry.active &&
            props.entry.integration?.methods.some((method) => method.type === "aws-sigv4") &&
            props.onEnable
          }
        >
          <div>
            <p>Enable Bedrock using this deployment&apos;s AWS credential chain. Credentials are resolved when a model is invoked.</p>
            <Button disabled={props.enablePending} onClick={() => void props.onEnable?.()}>
              Use deployment AWS credentials
            </Button>
          </div>
        </Show>
        <Show when={props.entry.integration} fallback={<p>Connection setup is not available for this provider.</p>}>
          <Button onClick={props.onConnect}>Connect provider</Button>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}

/** Explain honestly when a catalog source has no supported connection workflow. */
export function ProviderUnavailable(props: { readonly entry: ProviderDirectoryEntry }) {
  return (
    <Dialog data-component="provider-unavailable">
      <DialogHeader>
        <DialogTitle>{props.entry.info.displayName ?? props.entry.info.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p>Connection setup is not available for this provider.</p>
      </DialogBody>
    </Dialog>
  )
}
