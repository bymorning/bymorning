import type { ModelInfo, ProviderInfo } from "@bymorning/client"

/** One provider-native Model projected for application selection. */
export interface ModelOption extends Pick<ModelInfo, "id" | "name" | "provider" | "limit"> {
  readonly family?: string
  readonly releaseDate?: string
  readonly providerLabel: NonNullable<ProviderInfo["displayName"]>
  readonly variants: Readonly<ModelInfo["variants"]>
}

/** Encode a provider-native Model identity without delimiter collisions. */
export const modelOptionKey = (model: Pick<ModelOption, "provider" | "id">) =>
  `${encodeURIComponent(model.provider)}:${encodeURIComponent(model.id)}`

/** Reserved Provider key of Auto names, which Workspace Routing resolves to a Catalog Model per turn. */
export const AUTO_PROVIDER = "auto"

/** Selectable Auto name, listed ahead of Catalog Models. */
export const autoOption = (id: string): ModelOption => ({
  id,
  name: `Auto · ${id}`,
  provider: AUTO_PROVIDER as ModelOption["provider"],
  providerLabel: "Auto",
  variants: [],
  limit: {},
})

export function modelOptions(
  providers: ReadonlyArray<ProviderInfo>,
  models: ReadonlyArray<ModelInfo>,
  auto: ReadonlyArray<Pick<ModelInfo, "id">> = [],
): ReadonlyArray<ModelOption> {
  const byName = new Map(providers.map((provider) => [provider.name, provider]))
  return [...auto.map((model) => autoOption(model.id)), ...models.flatMap((model) => {
    const provider = byName.get(model.provider)
    if (!provider) return []
    return [
      {
        id: model.id,
        name: model.name,
        provider: provider.name,
        providerLabel: provider.displayName ?? provider.name,
        variants: model.variants,
        limit: model.limit,
        ...(model.family === undefined ? {} : { family: model.family }),
        releaseDate: model.releaseDate,
      },
    ]
  })]
}
