import type { ProviderDirectoryEntry } from "@bymorning/client"
import { createEffect, createMemo, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"

import { CommandDialog } from "../../app/command-dialog"
import { useDialog } from "../../context/dialog"
import { useScope } from "../../runtime/server/runtime"
import { ActionMenu } from "../../ui/components/action-menu"
import { Button } from "../../ui/components/button"
import { Switch } from "../../ui/components/switch"
import { showToast } from "../../ui/components/toast"
import { errorMessage } from "../../utils/error-message"
import { ProviderIdentity } from "../provider-identity"
import { ProviderIcon } from "../provider-icon"
import { useProviderActivation, useProviderManagement } from "./management"
import { createProviderCatalog, type ProviderCatalog } from "./model"
import "../provider-catalog.css"

/** Feature catalog for a component that renders without a shared owner; its lifetime is the owner's. */
function useFeatureCatalog(catalog: ProviderCatalog | undefined): ProviderCatalog {
  if (catalog) return catalog
  const scope = useScope()
  const resource = new AbortController()
  onCleanup(() => resource.abort())
  return createProviderCatalog({ api: scope.api, workspace: scope.workspace, signal: resource.signal })
}

/**
 * Dialogs are disposed with the component that opened them. When this button
 * disappears once a provider connects, pass an `owner` that outlives it so the
 * connection dialog can finish.
 */
export function AddProviderButton(props: {
  readonly catalog?: ProviderCatalog | undefined
  readonly owner?: {
    readonly dialog: Pick<ReturnType<typeof useDialog>, "show">
    readonly manage: ReturnType<typeof useProviderManagement>
  }
}): JSX.Element {
  const local = { dialog: useDialog(), manage: undefined as ReturnType<typeof useProviderManagement> | undefined }
  const providers = useFeatureCatalog(props.catalog)
  if (!props.owner) local.manage = useProviderManagement(providers)
  const dialog = props.owner?.dialog ?? local.dialog
  const manage: ReturnType<typeof useProviderManagement> = (entry, initialManagement) =>
    (props.owner?.manage ?? local.manage!)(entry, initialManagement)
  const available = () => providers.directory().filter((entry) => entry.integration !== undefined)
  const options = createMemo(() =>
    available().map((entry) => ({
      id: `provider.${entry.info.name}`,
      title: entry.info.displayName ?? entry.integration?.name ?? entry.info.name,
      description: entry.info.name,
      icon: <ProviderIcon provider={entry.info.name} />,
      meta: `${entry.connected ? "Connected · " : ""}${entry.modelCount} ${entry.modelCount === 1 ? "model" : "models"}`,
      category: "Providers",
      onSelect: () => manage(entry, false),
    })),
  )
  onMount(() => void providers.sync().catch(() => undefined))
  return (
    <Button
      type="button"
      variant="primary"
      icon="central-plus-small"
      onClick={() =>
        dialog.show(() => (
          <CommandDialog
            label="Add provider"
            placeholder="Search providers"
            options={options}
            initialLimit={null}
            empty={<ProviderDirectoryEmpty catalog={providers} available={available} />}
          />
        ))
      }
    >
      Add provider
    </Button>
  )
}

export function ProviderCatalog(props: {
  readonly catalog?: ProviderCatalog | undefined
  readonly hideToolbar?: boolean
}): JSX.Element {
  const providers = useFeatureCatalog(props.catalog)
  const manage = useProviderManagement(providers)
  const activation = useProviderActivation(providers)
  const managed = () =>
    providers.directory().filter((entry) => entry.active || entry.connected || entry.info.status !== "auto")
  const errored = () => {
    const state = providers.state()
    return state.state === "error" ? state : undefined
  }
  const initial = () => {
    const state = providers.state()
    // A failed first load is not loading: the error toast offers the retry.
    return state.state === "idle" || (state.state === "loading" && state.refreshedAt === undefined)
  }

  onMount(() => void providers.sync().catch(() => undefined))
  createEffect(
    on(
      errored,
      (state) =>
        state &&
        showToast({
          variant: "error",
          title: state.message,
          actions: [{ label: "Try again", onClick: () => void providers.sync().catch(() => undefined) }],
        }),
    ),
  )

  return (
    <section data-component="provider-management" data-slot="card" aria-label="Providers">
      <Show when={!props.hideToolbar}>
        <div data-slot="toolbar">
          <AddProviderButton catalog={providers} />
        </div>
      </Show>
      <Show when={initial()}>
        <p role="status">Loading providers…</p>
      </Show>
      <Show when={!initial()}>
        <Show
          when={managed().length > 0}
          fallback={
            <div data-slot="empty">
              <p>No providers activated.</p>
              <AddProviderButton catalog={providers} />
            </div>
          }
        >
          <div data-slot="provider-list-header">
            <span>Provider</span>
            <span class="sr-only">Actions</span>
          </div>
          <ul data-slot="provider-list" aria-label="Providers">
            <For each={managed().map((entry) => entry.info.name)}>
              {(provider) => (
                <ProviderRow
                  entry={() => managed().find((entry) => entry.info.name === provider)!}
                  onManage={manage}
                  activation={activation}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  )
}

function ProviderRow(props: {
  readonly entry: () => ProviderDirectoryEntry
  readonly onManage: (entry: ProviderDirectoryEntry) => void
  readonly activation: ReturnType<typeof useProviderActivation>
}) {
  const name = () => props.entry().info.displayName ?? props.entry().integration?.name ?? props.entry().info.name
  const update = (enabled: boolean) => {
    void props.activation
      .update(props.entry().info.name, enabled ? "enabled" : "disabled")
      .catch((cause) =>
        showToast({ variant: "error", title: errorMessage(cause, "Could not update provider activation.") }),
      )
  }
  return (
    <li>
      <div data-slot="provider-name">
        <ProviderIdentity entry={props.entry()} />
      </div>
      <div data-slot="provider-actions">
        <Switch
          checked={props.activation.active(props.entry().info.name, props.entry().active)}
          aria-label={`Enable ${name()}`}
          hideLabel
          onChange={update}
        >
          Enabled {name()}
        </Switch>
        <ActionMenu label={name()}>
          <ActionMenu.Item
            onSelect={() => update(!props.activation.active(props.entry().info.name, props.entry().active))}
          >
            {props.activation.active(props.entry().info.name, props.entry().active) ? "Disable" : "Enable"}
          </ActionMenu.Item>
          <ActionMenu.Item onSelect={() => props.onManage(props.entry())}>Manage connections</ActionMenu.Item>
        </ActionMenu>
      </div>
    </li>
  )
}

function ProviderDirectoryEmpty(props: {
  readonly catalog: ProviderCatalog
  readonly available: () => ReadonlyArray<ProviderDirectoryEntry>
}) {
  const state = () => props.catalog.state()
  const initial = () => {
    const value = state()
    return value.state === "idle" || (value.state === "loading" && value.refreshedAt === undefined)
  }
  return (
    <Show when={!initial()} fallback={<span role="status">Loading providers…</span>}>
      <Show when={state().state === "error"}>
        <Button type="button" variant="ghost" onClick={() => void props.catalog.sync().catch(() => undefined)}>
          Try loading providers again
        </Button>
      </Show>
      <span>{props.available().length === 0 ? "No providers are available." : "No providers match your search."}</span>
    </Show>
  )
}
