import { WebSearch } from "@bymorning/schema/websearch"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** HTTP API group for web-search capability discovery. */
export const WebSearchGroup = HttpApiGroup.make("api.websearch")
  .add(
    HttpApiEndpoint.get("websearch.providers", "/websearch/provider", {
      query: WorkspaceQuery,
      success: Schema.Array(WebSearch.Provider),
    }),
  )
  .add(
    HttpApiEndpoint.post("websearch.query", "/websearch", {
      query: WorkspaceQuery,
      payload: WebSearch.Input,
      success: WebSearch.Response,
      error: [InvalidRequestError, ServiceUnavailableError],
    }),
  )
  .prefix("/api")
