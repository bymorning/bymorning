import { useSearchParams } from "@solidjs/router"
import { onMount, type JSX } from "solid-js"

import type { ModelListOutput } from "@bymorning/client"
import { useDialog } from "../../context/dialog"
import { AddProviderButton, ProviderCatalog } from "../../integration/providers/view"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import { showToast } from "../../ui/components/toast"
import { CustomModelDialog, type CustomProvider } from "./custom-dialog"
import { createGatewayModels } from "./model"
import { GatewayModelsPage } from "./view"

export function GatewayModelsRoute(): JSX.Element {
  const model = createGatewayModels()
  const dialog = useDialog()
  const [search, setSearch] = useSearchParams<{ tab?: string }>()
  /** Active Providers, the ones whose custom Models can run. */
  const providers = (): ReadonlyArray<CustomProvider> =>
    model.catalog
      .directory()
      .filter((entry) => entry.active)
      .map((entry) => ({
        id: entry.info.name,
        name: entry.info.displayName ?? entry.integration?.name ?? entry.info.name,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name))
  const add = () =>
    dialog.show(() => (
      <CustomModelDialog
        providers={providers()}
        save={(input) =>
          model.create(input).then(() => showToast({ variant: "success", title: `${input.name} added.` }))
        }
      />
    ))
  const edit = (item: ModelListOutput[number]) =>
    dialog.show(() => (
      <CustomModelDialog
        providers={providers()}
        model={item}
        save={(input) =>
          model
            .update({ ...input, id: item.info.id })
            .then(() => showToast({ variant: "success", title: `${input.name} saved.` }))
        }
      />
    ))
  const remove = (item: ModelListOutput[number]) =>
    dialog.show(() => (
      <ConfirmDialog
        title={`Delete ${item.info.name}?`}
        description="The custom model is removed from this workspace. Conversations and agents that use it can no longer run on it."
        confirmLabel="Delete model"
        danger
        onConfirm={() =>
          model
            .remove({ provider: item.info.provider, id: item.info.id })
            .then(() => showToast({ variant: "success", title: `${item.info.name} deleted.` }))
        }
      />
    ))
  onMount(() => void model.sync().catch(() => undefined))
  return (
    <GatewayModelsPage
      items={model.rows}
      state={model.state}
      onRetry={() => model.sync()}
      onToggle={(item, enabled) => model.toggle({ provider: item.info.provider, id: item.info.id, enabled })}
      onSetDefault={(item) => model.setDefault({ provider: item.info.provider, id: item.info.id })}
      custom={{ add, edit, remove }}
      providerEntries={model.catalog.directory}
      catalog={model.catalog}
      tab={() => (search.tab === "providers" ? "providers" : "models")}
      onTabChange={(tab) => setSearch({ tab: tab === "providers" ? "providers" : undefined })}
    />
  )
}
