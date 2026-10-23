import type { CatalogEntry, Definition, ExecutionBinding } from "./definition.js"
import {
  anthropicBindings,
  anthropicCatalog,
  bedrockBindings,
  bedrockCatalog,
  fireworksBindings,
  fireworksCatalog,
  googleBindings,
  googleCatalog,
  openAIBindings,
  openAICatalog,
  opencodeBindings,
  opencodeCatalog,
} from "./direct.js"
import { legacyBindings, legacyCatalog } from "./legacy.js"
import { sourceModels } from "./source.js"

export class RegistryJoinError extends Error {
  readonly name = "RegistryJoinError"
}

/** Validate source metadata and join executable bindings, preserving binding order. */
export const joinRegistry = (
  catalog: ReadonlyArray<CatalogEntry>,
  bindings: ReadonlyArray<ExecutionBinding>,
): ReadonlyArray<Definition> => {
  const catalogByIdentity = new Map<string, CatalogEntry>()
  for (const entry of catalog) {
    const key = `${entry.provider}/${entry.id}`
    if (catalogByIdentity.has(key)) throw new RegistryJoinError(`Duplicate catalog entry: ${key}`)
    catalogByIdentity.set(key, entry)
  }

  const bindingIdentities = new Set<string>()
  const joined = bindings.map((binding) => {
    const key = `${binding.provider}/${binding.id}`
    if (bindingIdentities.has(key)) throw new RegistryJoinError(`Duplicate execution binding: ${key}`)
    bindingIdentities.add(key)
    const entry = catalogByIdentity.get(key)
    if (entry === undefined) throw new RegistryJoinError(`Execution binding has no catalog entry: ${key}`)
    return {
      ...entry,
      ...(binding.package === undefined ? {} : { package: binding.package }),
      ...(binding.settings === undefined ? {} : { settings: binding.settings }),
      ...(binding.format === undefined ? {} : { format: binding.format }),
      options: binding.options,
      variants: binding.variants,
    }
  })

  return joined
}

const source = [
  ...openAICatalog,
  ...anthropicCatalog,
  ...legacyCatalog,
  ...googleCatalog,
  ...fireworksCatalog,
  ...bedrockCatalog,
  ...opencodeCatalog,
] satisfies ReadonlyArray<CatalogEntry>

/** Like OpenCode's models.dev registration, omit deprecated bundled Models. */
export const catalog = [
  ...source,
  ...sourceModels.filter((model) => !source.some((entry) => entry.provider === model.provider && entry.apiID === model.apiID)),
].filter((model) => model.status !== "deprecated")

export const bindings = [
  ...openAIBindings.filter(({ id }) => id === "gpt-5.6" || id === "gpt-5.4-mini"),
  ...anthropicBindings.filter(({ id }) => id === "claude-sonnet-5"),
  ...legacyBindings,
  ...googleBindings,
  ...fireworksBindings,
  ...openAIBindings.filter(({ id }) => id !== "gpt-5.6" && id !== "gpt-5.4-mini"),
  ...anthropicBindings.filter(({ id }) => id !== "claude-sonnet-5"),
  ...bedrockBindings,
  ...opencodeBindings,
] satisfies ReadonlyArray<ExecutionBinding>

/** Bundled execution registry in compatibility/default-selection order. */
export const registry = joinRegistry(source, bindings).filter((model) => model.status !== "deprecated")
