import type { Model } from "@bymorning/schema/model"
import type { Provider } from "@bymorning/schema/provider"
import type { ProviderOptions } from "@opencode-ai/ai/schema/options"

/** Source-facing metadata for one bundled model. */
export interface CatalogEntry extends Omit<Model.Info, "variants"> {}

/** Runtime facts required to execute one stable model identity. */
export interface ExecutionBinding extends Model.Identity {
  readonly package?: string
  readonly settings?: Readonly<Record<string, unknown>>
  readonly format?: Provider.Format
  readonly options: ProviderOptions
  readonly variants: Readonly<Record<string, ProviderOptions>>
}

/** Validated catalog metadata joined to its execution binding. */
export interface Definition extends CatalogEntry {
  readonly package?: string
  readonly settings?: Readonly<Record<string, unknown>>
  readonly format?: Provider.Format
  readonly options: ProviderOptions
  readonly variants: Readonly<Record<string, ProviderOptions>>
}
