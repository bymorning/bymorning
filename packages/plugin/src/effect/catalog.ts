import type { CatalogApi } from "@bymorning/client/effect/api"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"
import type { CatalogEditor } from "../promise/catalog.js"

// The synchronous editor is identical on both surfaces, including mutable JSON arrays.
export type { CatalogEditor, CatalogProviderRecord } from "../promise/catalog.js"

export interface CatalogDomain extends Omit<CatalogApi<unknown>, "provider" | "model"> {
  readonly provider: {
    readonly list: () => Effect.Effect<ReadonlyArray<Provider.Info>, unknown>
  }
  readonly model: {
    readonly list: () => Effect.Effect<ReadonlyArray<Model.Info>, unknown>
  }
  readonly transform: Transform<CatalogEditor>
  readonly reload: () => Effect.Effect<void>
}
