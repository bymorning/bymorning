import type { CatalogApi } from "@bymorning/client/promise/api"
import type { Model } from "@bymorning/schema/model"
import type { Provider } from "@bymorning/schema/provider"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface CatalogProviderRecord {
  readonly provider: DeepMutable<Provider.Info>
  readonly models: ReadonlyMap<string, DeepMutable<Model.Info>>
}

export interface CatalogEditor {
  readonly provider: {
    list(): readonly CatalogProviderRecord[]
    get(providerID: string): CatalogProviderRecord | undefined
    update(providerID: string, update: (provider: DeepMutable<Provider.Info>) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): DeepMutable<Model.Info> | undefined
    /** Upsert effective metadata and execution overrides; an absent parent starts disabled. */
    update(providerID: string, modelID: string, update: (model: DeepMutable<Model.Info>) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}

export interface CatalogDomain extends Omit<CatalogApi, "provider" | "model"> {
  readonly provider: {
    readonly list: () => Promise<ReadonlyArray<Provider.Info>>
  }
  readonly model: {
    readonly list: () => Promise<ReadonlyArray<Model.Info>>
  }
  readonly transform: Transform<CatalogEditor>
  readonly reload: () => Promise<void>
}
