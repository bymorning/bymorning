import type { WebSearch } from "@bymorning/schema/websearch"
import type { WebSearchApi } from "@bymorning/client/promise/api"
import type { Transform } from "./registration.js"

export interface Provider {
  readonly id: string
  readonly name: WebSearch.Provider["name"]
  readonly execute: (
    input: WebSearch.ProviderInput,
    context: { readonly signal: AbortSignal },
  ) => Promise<readonly WebSearch.Result[]>
}

export interface WebSearchDomain extends WebSearchApi {
  readonly transform: Transform<Editor>
  readonly reload: () => Promise<void>
}

export interface Editor {
  add(provider: Provider): void
  readonly default: {
    get(): string | false | undefined
    set(selection: string | false): void
  }
}
