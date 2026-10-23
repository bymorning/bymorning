import * as Provider from "@bymorning/schema/provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, ServiceUnavailableError } from "../errors.js"
import { IntegrationInfo } from "../integration-info.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** HTTP API group for code-backed Provider discovery. */
const ProviderInfo = Schema.Struct({
  name: Provider.Name,
  displayName: Schema.optionalKey(Schema.String),
  api: Schema.optionalKey(Provider.API),
  endpointStrategy: Schema.optionalKey(Provider.EndpointStrategy),
  format: Provider.Format,
  status: Provider.Status,
}).annotate({ identifier: "Provider.Info" })

const DirectoryEntry = Schema.Struct({
  info: ProviderInfo,
  integration: Schema.optionalKey(IntegrationInfo),
  active: Schema.Boolean,
  connected: Schema.Boolean,
  connectionCount: Provider.DirectoryEntry.fields.connectionCount,
  modelCount: Provider.DirectoryEntry.fields.modelCount,
}).annotate({ identifier: "Provider.DirectoryEntry" })

export const ProviderGroup = HttpApiGroup.make("api.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/providers", {
      query: WorkspaceQuery,
      success: Schema.Array(DirectoryEntry),
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.put("provider.update", "/providers/activation", {
      query: WorkspaceQuery,
      payload: Provider.UpdateInput,
      success: ProviderInfo,
      error: [InputError, ForbiddenError, ServiceUnavailableError],
    }),
  )
  .prefix("/api")
