export * as CodeModeCatalog from "./catalog.js"

import { searchSignature } from "@opencode-ai/codemode"
import { Schema } from "effect"

export const Entry = Schema.Struct({
  path: Schema.String,
  description: Schema.String,
  signature: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
})
export type Entry = typeof Entry.Type

export const Tool = Schema.Struct({
  type: Schema.Literal("tool"),
  name: Schema.String,
  description: Schema.String,
  signature: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
})
export type Tool = typeof Tool.Type
export type Namespace = {
  readonly type: "namespace"
  readonly name: string
  readonly description?: string
  readonly tools: ReadonlyArray<Tool | Namespace>
}
export type Inventory = { readonly tools: ReadonlyArray<Tool | Namespace> }
export type Options = { readonly budget?: number }

const Listing = Schema.Struct({ path: Schema.String, line: Schema.String })
const NamespaceSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  count: Schema.Finite,
  entries: Schema.Array(Listing),
})
export const Summary = Schema.Struct({
  total: Schema.Finite,
  shown: Schema.Finite,
  namespaces: Schema.Array(NamespaceSummary),
})
export type Summary = typeof Summary.Type

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const INLINE_BUDGET = 2_000

// Keep every namespace searchable, then select full listings one per namespace per round,
// considering shorter listings first until the inline budget is exhausted.
export function summarize(inventory: Inventory, options: Options = {}): Summary {
  const budget = options.budget ?? INLINE_BUDGET
  const flattened = flatten(inventory.tools)
  const entries = flattened.tools
  const namespaces = [...Map.groupBy(entries, (entry) => entry.path.split(".", 1)[0] ?? entry.path)]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, namespaceEntries]) => {
      const description = flattened.namespaces.get(name)?.description
      const listings = namespaceEntries
        .map((entry) => {
          const firstLine = entry.description.split("\n", 1)[0]?.trim() ?? ""
          const description =
            firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
          return { path: entry.path, line: `  - ${entry.signature}${description ? ` // ${description}` : ""}` }
        })
        .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      const ranked = rankListings(listings)
      const pinned = new Set(
        namespaceEntries
          .filter((entry) => entry.pinned)
          .map((entry) => listings.find((listing) => listing.path === entry.path))
          .filter((listing) => listing !== undefined),
      )
      return {
        name,
        ...(description === undefined ? {} : { description }),
        listings,
        selectionOrder: ranked.filter((candidate) => !pinned.has(candidate.listing)),
        selectedListings: pinned,
        selectionIndex: 0,
      }
    })

  const active = new Set(namespaces)
  let remaining =
    budget -
    namespaces.reduce(
      (total, namespace) =>
        total +
        Math.round(
          namespaceLine({
            name: namespace.name,
            ...(namespace.description === undefined ? {} : { description: namespace.description }),
            count: namespace.listings.length,
            entries: [],
          }).length / CHARACTERS_PER_TOKEN,
        ),
      0,
    ) -
    namespaces
      .flatMap((namespace) => namespace.listings.filter((listing) => namespace.selectedListings.has(listing)))
      .reduce((total, listing) => total + Math.round(listing.line.length / CHARACTERS_PER_TOKEN), 0)
  while (active.size > 0) {
    for (const namespace of active) {
      const candidate = namespace.selectionOrder[namespace.selectionIndex]
      if (!candidate || candidate.cost > remaining) {
        active.delete(namespace)
        continue
      }
      namespace.selectedListings.add(candidate.listing)
      namespace.selectionIndex += 1
      remaining -= candidate.cost
      if (namespace.selectionIndex === namespace.selectionOrder.length) active.delete(namespace)
    }
  }

  const namespaceSummaries = namespaces.map((namespace) => ({
    name: namespace.name,
    ...(namespace.description === undefined ? {} : { description: namespace.description }),
    count: namespace.listings.length,
    entries: namespace.listings.filter((listing) => namespace.selectedListings.has(listing)),
  }))
  return {
    total: entries.length,
    shown: namespaceSummaries.reduce((total, namespace) => total + namespace.entries.length, 0),
    namespaces: namespaceSummaries,
  }
}

export function render(inventory: Inventory) {
  const catalog = summarize(inventory)
  if (catalog.total === 0)
    return "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."
  const hasMoreTools = catalog.shown < catalog.total
  const tools = catalog.namespaces.flatMap((namespace) => [
    namespaceLine(namespace),
    ...namespace.entries.map((entry) => entry.line),
  ])
  return `The Code Mode tool catalog below is ${hasMoreTools ? "partial" : "complete"}.

${hasMoreTools ? "The Code Mode catalog and `search` results are" : "This catalog is"} the complete set of tools available within Code Mode. Tools presented elsewhere are not available in this runtime.${
    hasMoreTools
      ? `

## Search

Use \`search\` to discover exact paths and signatures for additional tools:

- ${searchSignature}`
      : ""
  }

## Available tools

${tools.join("\n")}`
}

export function namespaceLine(namespace: Summary["namespaces"][number]) {
  const count = namespace.count === 1 ? "1 tool" : `${namespace.count} tools`
  const label =
    namespace.entries.length === namespace.count
      ? count
      : namespace.entries.length === 0
        ? `${count}, none shown`
        : `${count}, ${namespace.entries.length} shown`
  return `- ${namespace.name} (${label})${namespace.description === undefined ? "" : ` // ${namespace.description}`}`
}

function flatten(entries: ReadonlyArray<Tool | Namespace>, path: ReadonlyArray<string> = []) {
  const tools: Array<Entry> = []
  const namespaces = new Map<string, Namespace>()
  for (const entry of entries) {
    if (entry.type === "tool") {
      tools.push({
        path: [...path, entry.name].join("."),
        description: entry.description,
        signature: entry.signature,
        ...(entry.pinned === undefined ? {} : { pinned: entry.pinned }),
      })
      continue
    }
    const next = [...path, entry.name]
    namespaces.set(next.join("."), entry)
    const nested = flatten(entry.tools, next)
    tools.push(...nested.tools)
    for (const [name, namespace] of nested.namespaces) namespaces.set(name, namespace)
  }
  return { tools, namespaces }
}

function rankListings(listings: ReadonlyArray<typeof Listing.Type>) {
  return listings
    .map((listing) => ({ listing, cost: Math.round(listing.line.length / CHARACTERS_PER_TOKEN) }))
    .toSorted((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost
      return left.listing.path < right.listing.path ? -1 : left.listing.path > right.listing.path ? 1 : 0
    })
}
