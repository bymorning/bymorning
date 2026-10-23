import { Tool } from "../../../tool.js"
import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { define } from "@bymorning/plugin/effect/plugin"
import { ID, Result } from "@bymorning/schema/websearch"
import { WebSearch } from "../../../websearch.js"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."

export const description = `Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
})

export const Output = Schema.Struct({
  provider: ID,
  results: Schema.Array(Result),
})

/** Core web-search Tool plugin. */
export const WebSearchTool = {
  name,
  options: { codemode: false },
  description,
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      yield* context.permission({
        action: name,
        resources: [input.query],
        save: ["*"],
        metadata: input,
      })
      const provider = yield* websearch.default()
      if (provider) yield* context.progress({ provider: provider.id })
      const response = yield* websearch.query({
        ...input,
        ...(provider ? { providerID: provider.id } : {}),
      })
      const result = { provider: response.providerID, results: response.results }
      const content = result.results.length
        ? result.results
            .map((item) => {
              const title = item.title ?? item.url
              const published = item.time.published ? `\nPublished: ${new Date(item.time.published).toISOString()}` : ""
              return `## [${title}](${item.url})${published}${item.content ? `\n\n${item.content}` : ""}`
            })
            .join("\n\n")
        : NO_RESULTS
      return {
        output: result,
        content: [{ type: "text" as const, text: content }],
        metadata: { provider: result.provider },
      }
    }).pipe(
      Effect.mapError((error) => {
        const fallback = `Unable to search the web for ${input.query}`
        if (!Schema.is(WebSearch.RequestError)(error)) return new Tool.Error({ message: fallback, error })
        const status = HttpClientError.isHttpClientError(error.cause) ? error.cause.response?.status : undefined
        if (status === 429)
          return new Tool.Error({
            message: "Web search rate limited (HTTP 429)",
            error,
            metadata: { provider: error.providerID },
          })
        if (status === 401)
          return new Tool.Error({
            message: "Web search authentication failed (HTTP 401)",
            error,
            metadata: { provider: error.providerID },
          })
        return new Tool.Error({
          message: status === undefined ? fallback : `Web search request failed (HTTP ${status})`,
          error,
          metadata: { provider: error.providerID },
        })
      }),
    ),
}

export const makeWebSearch = Effect.gen(function* () {
  const websearch = yield* WebSearch.Service
  const tool = {
    ...WebSearchTool,
    execute: (input: typeof Input.Type, caller: Tool.Context) =>
      WebSearchTool.execute(input, caller).pipe(Effect.provideService(WebSearch.Service, websearch)),
  } satisfies Tool.Info<typeof Input, typeof Output>
  return tool
})

export const WebSearchToolPlugin = define({
  id: "core.tool.web-search",
  effect: (context) =>
    makeWebSearch.pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
