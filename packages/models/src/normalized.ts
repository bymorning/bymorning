import type { LocalProviderID, SourceProviderID } from "./descriptors.js"
import type { Cost, Model, ReasoningOption } from "./source-schema.js"

export interface GeneratedModel {
  readonly source: {
    readonly provider: SourceProviderID
    readonly path: string
    readonly digest: string
  }
  readonly local: {
    readonly provider: LocalProviderID
    readonly id: string
  }
  readonly apiID: string
  readonly format: "openai" | "anthropic" | "google" | "oa-compat" | "bedrock-converse"
  readonly lifecycle: "active" | "beta" | "deprecated"
  readonly transport?: "converse" | "mantle-responses"
  readonly metadata: {
    readonly name: string
    readonly description: string
    readonly family?: string
    readonly releaseDate: string
    readonly lastUpdated: string
    readonly openWeights: boolean
    readonly capabilities: {
      readonly attachment: boolean
      readonly reasoning: boolean
      readonly tools: boolean
      readonly structuredOutput?: boolean
      readonly temperature: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly limit: { readonly context: number; readonly input?: number; readonly output?: number }
    readonly cost?: Cost
  }
  readonly unsupported: {
    readonly reasoningOptions?: ReadonlyArray<ReasoningOption>
    readonly experimentalModes?: NonNullable<Model["experimental"]>["modes"]
    readonly interleaved?: Model["interleaved"]
    readonly sourceProviderOptions?: Model["provider"]
  }
}
