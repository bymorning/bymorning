import { Provider } from "@bymorning/schema/provider"

import { providerIcons } from "./provider-icons.generated"

export type GeneratedProviderIconID = keyof typeof providerIcons

export type ProviderIconAsset = {
  readonly sourceProvider: GeneratedProviderIconID
  readonly render: "mask"
  readonly url: `/assets/provider-icons/${string}.svg`
}

export const providerIconRegistry = new Map<Provider.Name, ProviderIconAsset>(
  Object.entries(providerIcons).map(([provider, asset]) => [
    Provider.Name.make(provider),
    { sourceProvider: provider as GeneratedProviderIconID, render: "mask", url: asset.url },
  ] as const),
)

export const getProviderIconAsset = (provider: Provider.Name) => providerIconRegistry.get(provider)
