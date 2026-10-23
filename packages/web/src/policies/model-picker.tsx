import type { ModelInfo } from "@bymorning/client"
import { createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Button } from "../ui/components/button"
import { Icon } from "../ui/components/icon"
import { ModelSelectorPopover } from "../ui/components/select-dialog"
import { modelOptionKey } from "../utils/model-option"

export type CatalogModel = Pick<ModelInfo, "id" | "name" | "provider" | "variants">
type Ref = { readonly provider: string; readonly id: string; readonly variant?: string }

/** One selectable Model, possibly a configured reference the Catalog no longer lists. */
export type ModelPick = {
  readonly key: string
  readonly label: string
  readonly provider?: CatalogModel["provider"]
  readonly id?: string
  readonly variants: ReadonlyArray<string>
}

function catalogPick(model: CatalogModel): ModelPick {
  return { key: modelOptionKey(model), label: model.name, provider: model.provider, id: model.id, variants: model.variants }
}

function refPick(ref: Ref): ModelPick {
  return catalogPick({ ...ref, provider: ref.provider as CatalogModel["provider"], name: ref.id, variants: ref.variant ? [ref.variant] : [] })
}

export function variantOptions(variants: ReadonlyArray<string>) {
  return ["default", ...new Set(variants.filter((variant) => variant !== "default"))]
}

export function variantLabel(variant: string) {
  return variant === "default" ? "Default" : variant
}

export function normalizedVariant(options: ReadonlyArray<string>, variant: string) {
  return options.includes(variant) ? variant : "default"
}

export function selectedVariant(ref: { readonly variant?: string } | undefined) {
  return ref?.variant && ref.variant !== "default" ? ref.variant : "default"
}

export function modelValue(pick: ModelPick | undefined, variant = "default") {
  if (pick?.provider === undefined || pick.id === undefined) return undefined
  const trimmed = variant.trim()
  return trimmed === "" || trimmed === "default"
    ? { provider: pick.provider, id: pick.id }
    : { provider: pick.provider, id: pick.id, variant: trimmed }
}

/**
 * Catalog Model picks that also remember configured references the Catalog no longer lists, so an
 * unavailable Model stays visible and round-trips instead of silently disappearing.
 */
export function createModelPicks(models: () => ReadonlyArray<CatalogModel>) {
  const cache = new Map<string, ModelPick>()
  const picks = createMemo(() =>
    models().map((model) => {
      const pick = catalogPick(model)
      cache.set(pick.key, pick)
      return pick
    }),
  )
  return {
    picks,
    /** Remember a configured reference and return its key. */
    remember: (ref: Ref | undefined) => {
      if (ref === undefined) return ""
      const pick = refPick(ref)
      if (!cache.has(pick.key)) cache.set(pick.key, pick)
      return pick.key
    },
    find: (key: string) => picks().find((item) => item.key === key) ?? (key ? cache.get(key) : undefined),
    withCurrent: (key: string) => {
      const listed = picks()
      if (!key || listed.some((item) => item.key === key)) return [...listed]
      const current = cache.get(key)
      return current ? [...listed, current] : [...listed]
    },
  }
}

const identity = (pick: ModelPick | undefined, placeholder: string) =>
  pick?.provider === undefined || pick.id === undefined ? (pick?.label ?? placeholder) : `${pick.label} (${pick.provider}/${pick.id})`

/** Searchable Model selector used by routing rules and Auto models. */
export function ModelPicker(props: {
  /** Accessible name of the picker group and its trigger. */
  readonly label: string
  readonly options: () => ReadonlyArray<ModelPick>
  readonly current: () => string
  readonly pending: () => boolean
  readonly select: (pick: ModelPick) => void
}): JSX.Element {
  const [state, setState] = createStore({ open: false })
  const current = () => props.options().find((item) => item.key === props.current())
  // Kobalte 0.13's menu trigger calls scrollIntoViewport on Enter, Space, and ArrowDown, which never
  // terminates inside a scrollable dialog while page scroll is locked. Open the picker ourselves instead.
  const openFromKeyboard = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return
    if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-slot="searchable-choice-trigger"]')) return
    event.preventDefault()
    event.stopPropagation()
    if (!props.pending()) setState("open", true)
  }
  return (
    <div data-slot="model-picker" on:keydown={{ handleEvent: openFromKeyboard, capture: true }}>
    <ModelSelectorPopover
      label={props.label}
      searchLabel="Search models"
      emptyLabel="No models found"
      size="large"
      open={state.open}
      onOpenChange={(open) => setState("open", open)}
      model={{
        options: () =>
          props.options().map((item) => ({
            key: item.key,
            label: item.label,
            ...(item.provider === undefined || item.id === undefined
              ? { accessibleLabel: item.label }
              : {
                  accessibleLabel: `${item.label}, ${item.provider}/${item.id}`,
                  group: item.provider,
                  description: `${item.provider}/${item.id}`,
                }),
          })),
        current: () => current()?.key,
        pending: props.pending,
        select: (key) => {
          const pick = props.options().find((item) => item.key === key)
          if (pick) props.select(pick)
        },
      }}
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          type="button"
          variant="outline"
          disabled={props.pending()}
          data-slot="searchable-choice-trigger"
          aria-label={`${props.label}, ${identity(current(), "Choose a model")}`}
        >
          <span data-slot="searchable-choice-trigger-label">{identity(current(), "Choose a model")}</span>
          <Icon name="chevron-down" size="small" />
        </Button>
      )}
    />
    </div>
  )
}
