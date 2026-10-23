import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { WebSearch } from "@bymorning/core/websearch"
import { InvalidRequestError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { Api } from "../api.js"

/** Web-search provider discovery and query bindings. */
export const WebSearchHandler = HttpApiBuilder.group(Api, "api.websearch", (handlers) =>
  handlers
    .handle(
      "websearch.providers",
      Effect.fn("WebSearchHandler.providers")(function* () {
        const websearch = yield* WebSearch.Service
        return yield* websearch.providers()
      }),
    )
    .handle(
      "websearch.query",
      Effect.fn("WebSearchHandler.query")(function* ({ payload }) {
        const websearch = yield* WebSearch.Service
        return yield* websearch.query(payload).pipe(
          Effect.catchTags({
            "WebSearch.ProviderRequired": () => new InvalidRequestError({ message: "Web search provider is required" }),
            "WebSearch.ProviderNotFound": (error) =>
              new InvalidRequestError({ message: `Web search provider not found: ${error.providerID}` }),
            "WebSearch.Disabled": () => new ServiceUnavailableError({ message: "Web search is disabled" }),
            "WebSearch.Request": () => new ServiceUnavailableError({ message: "Web search request failed" }),
          }),
        )
      }),
    ),
)
