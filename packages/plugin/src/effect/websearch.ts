import type { WebSearch } from "@bymorning/schema/websearch"
import type { WebSearchApi } from "@bymorning/client/effect/api"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface Provider {
  readonly id: string
  readonly name: WebSearch.Provider["name"]
  readonly execute: (input: WebSearch.ProviderInput) => Effect.Effect<readonly WebSearch.Result[], unknown>
}

export interface WebSearchDomain extends WebSearchApi<unknown> {
  readonly transform: Transform<Editor>
  readonly reload: () => Effect.Effect<void>
}

export interface Editor {
  add(provider: Provider): void
  readonly default: {
    get(): string | false | undefined
    set(selection: string | false): void
  }
}
