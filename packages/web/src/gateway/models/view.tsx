import type { ModelListOutput, ProviderDirectoryEntry } from "@bymorning/client"
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { TextInput } from "../../ui/components/text-input"

import type { ProviderCatalog } from "../../integration/providers/model"
import { AddProviderButton, ProviderCatalog as ProviderCatalogView } from "../../integration/providers/view"
import { ActionMenu } from "../../ui/components/action-menu"
import { Button } from "../../ui/components/button"
import { Select } from "../../ui/components/select"
import { showToast } from "../../ui/components/toast"
import { Switch } from "../../ui/components/switch"
import { Tag } from "../../ui/components/tag"
import { Tooltip } from "../../ui/components/tooltip"
import { errorMessage } from "../../utils/error-message"
import { WorkspacePage } from "../../home/workspace-page"
import { GatewayModelIdentity } from "../model-identity"
import "../page.css"
import "./route.css"

const allProviders = { id: "all", name: "All providers" }

/** Open the add, edit, and delete flows for Workspace custom Models. */
export interface CustomActions {
  readonly add: () => void
  readonly edit: (model: ModelListOutput[number]) => void
  readonly remove: (model: ModelListOutput[number]) => void
}
const modelPrice = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 20,
})

export function GatewayModelsPage(props: {
  readonly items: () => ModelListOutput
  readonly state: () => { readonly state: string; readonly message?: string }
  readonly onRetry: () => Promise<unknown>
  readonly onToggle: (model: ModelListOutput[number], enabled: boolean) => Promise<unknown>
  readonly onSetDefault?: (model: ModelListOutput[number]) => Promise<unknown>
  readonly providerEntries?: () => ReadonlyArray<ProviderDirectoryEntry>
  readonly catalog?: ProviderCatalog | undefined
  readonly tab?: () => "models" | "providers"
  readonly onTabChange?: (tab: "models" | "providers") => void
  readonly providers?: JSX.Element
  /** Workspace custom Model management; omitted where custom Models cannot be configured. */
  readonly custom?: CustomActions
}): JSX.Element {
  let modelsTab: HTMLButtonElement | undefined
  let providersTab: HTMLButtonElement | undefined
  const [providerFilter, setProviderFilter] = createSignal(allProviders.id)
  const [browse, setBrowse] = createStore({ search: "", page: 0 })
  createEffect(
    on(
      () => props.state(),
      (state) => {
        if (state.state !== "error") return
        showToast({
          variant: "error",
          title: state.message ?? "Could not load models.",
          actions: [{ label: "Try again", onClick: () => void props.onRetry() }],
        })
      },
    ),
  )
  const filterOptions = createMemo(() => {
    const names = new Map(
      props
        .providerEntries?.()
        .map((entry) => [entry.info.name, entry.info.displayName ?? entry.integration?.name ?? entry.info.name]),
    )
    return [
      allProviders,
      ...[...new Set(props.items().map((model) => model.info.provider))]
        .map((id) => ({ id, name: names.get(id) ?? id }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    ]
  })
  const filteredItems = createMemo(() =>
    (providerFilter() === allProviders.id
      ? props.items()
      : props.items().filter((model) => model.info.provider === providerFilter())
    )
      .filter((row) =>
        `${row.info.provider} ${row.info.name} ${row.info.id}`
          .toLocaleLowerCase()
          .includes(browse.search.trim().toLocaleLowerCase()),
      )
      .toSorted((left, right) => Number(right.isPreferredDefault) - Number(left.isPreferredDefault)),
  )
  const emptyMessage = () => {
    const search = browse.search.trim()
    if (search !== "") return `No models match "${search}".`
    return "No models match this provider."
  }
  const clearFilters = () => {
    setProviderFilter(allProviders.id)
    setBrowse({ search: "", page: 0 })
  }
  const rows = createMemo(
    () => new Map(filteredItems().map((model) => [JSON.stringify([model.info.provider, model.info.id]), model])),
  )
  const tab = () => props.tab?.() ?? "models"
  const selectTab = (value: "models" | "providers") => props.onTabChange?.(value)
  const moveTab = (event: KeyboardEvent, value: "models" | "providers") => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    selectTab(value)
    if (value === "models") return modelsTab?.focus()
    providersTab?.focus()
  }
  return (
    <WorkspacePage
      title="Models"
      layout="table"
      actions={
        <>
          <Show when={tab() === "providers" && props.providers === undefined && props.catalog !== undefined}>
            <AddProviderButton catalog={props.catalog} />
          </Show>
          <Show when={tab() === "models" && props.custom}>
            {(custom) => (
              <Button type="button" variant="primary" onClick={() => custom().add()}>
                Add model
              </Button>
            )}
          </Show>
        </>
      }
    >
      <div data-component="gateway-page">
        <div data-component="gateway-models">
          <div data-slot="controls" role="tablist" aria-label="Models">
            <Button
              type="button"
              size="small"
              variant={tab() === "models" ? "neutral" : "ghost"}
              ref={(element: HTMLButtonElement) => (modelsTab = element)}
              role="tab"
              id="gateway-models-tab"
              aria-controls="gateway-models-panel"
              aria-selected={tab() === "models"}
              tabIndex={tab() === "models" ? 0 : -1}
              onClick={() => selectTab("models")}
              onKeyDown={(event: KeyboardEvent) => moveTab(event, "providers")}
            >
              Models
            </Button>
            <Button
              type="button"
              size="small"
              variant={tab() === "providers" ? "neutral" : "ghost"}
              ref={(element: HTMLButtonElement) => (providersTab = element)}
              role="tab"
              id="gateway-providers-tab"
              aria-controls="gateway-providers-panel"
              aria-selected={tab() === "providers"}
              tabIndex={tab() === "providers" ? 0 : -1}
              onClick={() => selectTab("providers")}
              onKeyDown={(event: KeyboardEvent) => moveTab(event, "models")}
            >
              Providers
            </Button>
          </div>
          <Show when={tab() === "providers"}>
            <div role="tabpanel" id="gateway-providers-panel" aria-labelledby="gateway-providers-tab">
              {props.providers ?? (props.catalog ? <ProviderCatalogView catalog={props.catalog} hideToolbar /> : null)}
            </div>
          </Show>
          <Show when={tab() === "models"}>
            <div role="tabpanel" id="gateway-models-panel" aria-labelledby="gateway-models-tab">
              <section data-slot="card" aria-label="Workspace models">
                <Show
                  when={props.state().state !== "loading" || props.items().length > 0}
                  fallback={
                    <p role="status" data-slot="model-status">
                      Loading…
                    </p>
                  }
                >
                  <Show
                    when={props.items().length > 0}
                    fallback={
                      <div data-slot="empty">
                        <Button type="button" size="small" onClick={() => selectTab("providers")}>
                          Connect provider
                        </Button>
                      </div>
                    }
                  >
                    <div data-slot="model-filter">
                      <TextInput
                        type="search"
                        aria-label="Search models"
                        placeholder="Search models"
                        value={browse.search}
                        onInput={(event) => setBrowse({ search: event.currentTarget.value, page: 0 })}
                      />
                      <Select
                        options={filterOptions()}
                        current={filterOptions().find((option) => option.id === providerFilter()) ?? allProviders}
                        value={(option) => option.id}
                        label={(option) => option.name}
                        onSelect={(option) => {
                          if (option) {
                            setProviderFilter(option.id)
                            setBrowse("page", 0)
                          }
                        }}
                      />
                    </div>
                    <Show
                      when={filteredItems().length > 0}
                      fallback={
                        <div data-slot="filtered-empty">
                          <p>{emptyMessage()}</p>
                          <Button type="button" size="small" onClick={clearFilters}>
                            {browse.search.trim() !== "" ? "Clear search" : "Clear filter"}
                          </Button>
                        </div>
                      }
                    >
                      <div data-slot="model-list-header" aria-hidden="true">
                        <span>Model</span>
                        <div data-slot="model-pricing-header">
                          <span>Input</span>
                          <span>Output</span>
                          <span>Cache Read</span>
                          <span>Cache Write</span>
                        </div>
                        <span />
                      </div>
                      <ul data-slot="model-list" aria-label="Workspace models">
                        <For each={[...rows().keys()].slice(browse.page * 100, (browse.page + 1) * 100)}>
                          {(id) => (
                            <ModelRow
                              model={rows().get(id)!}
                              onToggle={props.onToggle}
                              {...(props.onSetDefault ? { onSetDefault: props.onSetDefault } : {})}
                              {...(props.custom
                                ? {
                                    onEdit: props.custom.edit,
                                    onDelete: props.custom.remove,
                                  }
                                : {})}
                            />
                          )}
                        </For>
                      </ul>
                      <Show when={filteredItems().length > 100}>
                        <Button disabled={browse.page === 0} onClick={() => setBrowse("page", (page) => page - 1)}>
                          Previous
                        </Button>
                        <span>
                          Page {browse.page + 1} of {Math.ceil(filteredItems().length / 100)}
                        </span>
                        <Button
                          disabled={(browse.page + 1) * 100 >= filteredItems().length}
                          onClick={() => setBrowse("page", (page) => page + 1)}
                        >
                          Next
                        </Button>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </section>
            </div>
          </Show>
        </div>
      </div>
    </WorkspacePage>
  )
}

function ModelRow(props: {
  readonly model: ModelListOutput[number]
  readonly onToggle: (model: ModelListOutput[number], enabled: boolean) => Promise<unknown>
  readonly onSetDefault?: (model: ModelListOutput[number]) => Promise<unknown>
  readonly onEdit?: (model: ModelListOutput[number]) => void
  readonly onDelete?: (model: ModelListOutput[number]) => void
}) {
  let latestIntent = 0
  const mutation = useMutation(() => ({
    scope: { id: JSON.stringify(["gateway-model", props.model.info.provider, props.model.info.id]) },
    retry: false,
    networkMode: "always",
    mutationFn: (input: {
      model: ModelListOutput[number]
      enabled: boolean
      intent: number
      toggle: typeof props.onToggle
    }) => input.toggle(input.model, input.enabled),
    onSuccess: (_, input) => {
      if (input.intent !== latestIntent) return
      showToast({
        variant: "success",
        title: `${input.model.info.name} ${input.enabled ? "enabled" : "disabled"}.`,
      })
    },
  }))
  let latestDefaultIntent = 0
  const defaultMutation = useMutation(() => ({
    scope: { id: JSON.stringify(["gateway-model-default", props.model.info.provider, props.model.info.id]) },
    retry: false,
    networkMode: "always",
    mutationFn: (input: {
      model: ModelListOutput[number]
      intent: number
      setDefault: (model: ModelListOutput[number]) => Promise<unknown>
    }) => input.setDefault(input.model),
    onSuccess: (_, input) => {
      if (input.intent !== latestDefaultIntent) return
      showToast({ variant: "success", title: `${input.model.info.name} set as the default model.` })
    },
  }))
  const enabled = () => (mutation.isPending ? mutation.variables!.enabled : props.model.enabled)
  const isDefault = () => (defaultMutation.isPending ? true : props.model.isPreferredDefault)
  const update = (next: boolean) => {
    if (!next && isDefault()) return
    latestIntent += 1
    mutation.mutate({ model: props.model, enabled: next, toggle: props.onToggle, intent: latestIntent })
  }
  const setDefault = () => {
    if (!props.onSetDefault) return
    latestDefaultIntent += 1
    defaultMutation.mutate({ model: props.model, intent: latestDefaultIntent, setDefault: props.onSetDefault })
  }
  const toggleHint = () =>
    isDefault()
      ? `${props.model.info.name} is the default model. Choose a new default before disabling it.`
      : enabled()
        ? `Disable ${props.model.info.name}`
        : `Enable ${props.model.info.name}`
  const error = () =>
    mutation.isError
      ? `Could not ${mutation.variables?.enabled ? "enable" : "disable"} ${props.model.info.name}: ${errorMessage(mutation.error, "Request failed")}`
      : undefined
  const defaultError = () =>
    defaultMutation.isError
      ? `Could not set ${props.model.info.name} as the default model: ${errorMessage(defaultMutation.error, "Request failed")}`
      : undefined
  const canSetDefault = () => enabled() && props.model.unavailableReason === undefined && !isDefault()
  const tiered = () => !!props.model.info.cost.tiers?.length || props.model.info.cost.experimentalOver200K !== undefined
  return (
    <li data-enabled={enabled() ? "true" : "false"}>
      <GatewayModelIdentity provider={props.model.info.provider} name={props.model.info.name} id={props.model.info.id}>
        <Show when={props.model.info.status === "deprecated"}>
          <Tag>Deprecated</Tag>
        </Show>
        <Show when={isDefault()}>
          <Tag variant="accent">Default</Tag>
        </Show>
        <Show when={props.model.custom}>
          <Tag>Custom</Tag>
        </Show>
        <Show when={props.model.unavailableReason === "transport-unsupported"}>
          <small data-slot="model-unavailable">Unavailable: transport is not supported.</small>
        </Show>
        <Show when={props.model.unavailableReason === "region-unsupported"}>
          <small data-slot="model-unavailable">Unavailable in the active AWS region.</small>
        </Show>
        <Show when={props.model.unavailableReason === "provider-disabled"}>
          <small data-slot="model-unavailable">Unavailable: provider is disabled.</small>
        </Show>
        <Show when={error()}>
          {(error) => (
            <p role="alert" data-slot="model-error">
              {error()}
            </p>
          )}
        </Show>
        <Show when={defaultError()}>
          {(error) => (
            <p role="alert" data-slot="model-default-error">
              {error()}
            </p>
          )}
        </Show>
      </GatewayModelIdentity>
      <dl data-slot="model-pricing">
        <Price label="Input" value={props.model.info.cost.input} tiered={tiered()} />
        <Price label="Output" value={props.model.info.cost.output} tiered={tiered()} />
        <Price label="Cache read" value={props.model.info.cost.cache.read} tiered={tiered()} />
        <Price label="Cache write" value={props.model.info.cost.cache.write} tiered={tiered()} />
      </dl>
      <div data-slot="model-actions">
        <Tooltip value={toggleHint()}>
          <Switch checked={enabled()} disabled={isDefault()} hideLabel onChange={update}>
            Enabled {props.model.info.name}
          </Switch>
        </Tooltip>
        <ActionMenu label={props.model.info.name}>
          <ActionMenu.Item disabled={isDefault()} onSelect={() => update(!enabled())}>
            {enabled() ? "Disable" : "Enable"}
          </ActionMenu.Item>
          <Show when={props.onSetDefault}>
            <ActionMenu.Item disabled={!canSetDefault()} onSelect={setDefault}>
              Set as default
            </ActionMenu.Item>
          </Show>
          <Show when={props.model.custom && props.onEdit}>
            {(onEdit) => <ActionMenu.Item onSelect={() => onEdit()(props.model)}>Edit</ActionMenu.Item>}
          </Show>
          <Show when={props.model.custom && props.onDelete}>
            {(onDelete) => (
              <ActionMenu.Item disabled={isDefault()} onSelect={() => onDelete()(props.model)}>
                Delete
              </ActionMenu.Item>
            )}
          </Show>
          <Show when={props.onSetDefault && !enabled() && !isDefault()}>
            <p data-slot="action-menu-hint">Enable the model first to set it as the default.</p>
          </Show>
          <Show when={isDefault()}>
            <p data-slot="action-menu-hint">Default model. Choose another default to disable it.</p>
          </Show>
        </ActionMenu>
      </div>
    </li>
  )
}

function Price(props: { readonly label: string; readonly value: number | undefined; readonly tiered: boolean }) {
  return (
    <div>
      <dt class="sr-only" aria-label={`${props.label} price, USD per 1M tokens`}>
        {props.label}
      </dt>
      <dd data-slot="model-cost">
        {props.value === undefined ? "—" : formatModelPrice(props.value)}
        <Show when={props.value !== undefined && props.tiered}>
          <sup title="Base price; tiered pricing may apply" aria-label="Base price; tiered pricing may apply">
            †
          </sup>
        </Show>
      </dd>
    </div>
  )
}

function formatModelPrice(value: number) {
  const formatted = modelPrice.format(value)
  return value > 0 && formatted === "$0.00" ? `$${value.toExponential(2)}` : formatted
}
