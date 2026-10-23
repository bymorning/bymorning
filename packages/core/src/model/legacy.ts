import { Provider } from "@bymorning/schema/provider"
import type { CatalogEntry, ExecutionBinding } from "./definition.js"

/** Removed upstream rows retained so durable model references remain executable. */
export const legacyCatalog = [
  {
    id: "claude-opus-4-1",
    provider: Provider.Anthropic,
    apiID: "claude-opus-4-1",
    name: "Claude Opus 4.1 (latest)",
    description: "Flagship Claude model for deep reasoning, coding, and long-horizon agents",
    family: "claude-opus",
    status: "deprecated",
    releaseDate: "2025-08-05",
    lastUpdated: "2025-08-05",
    openWeights: false,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      tools: true,
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    limit: { context: 200_000, output: 32_000 },
    cost: { input: 15, output: 75, cache: { read: 1.5, write: 18.75 } },
  },
] satisfies ReadonlyArray<CatalogEntry>

export const legacyBindings = [
  {
    provider: Provider.Anthropic,
    id: "claude-opus-4-1",
    options: {},
    variants: {},
  },
] satisfies ReadonlyArray<ExecutionBinding>
