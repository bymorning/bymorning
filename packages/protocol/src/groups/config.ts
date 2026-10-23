import * as Config from "@bymorning/schema/config"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"
import { ForbiddenError, InputError } from "../errors.js"

const { default_model: _, model_policy: __, ...WritableFields } = Config.Info.fields
const WritableConfig = Schema.toEncoded(Schema.Struct(WritableFields))

/** HTTP API group for Workspace Config control. */
export const ConfigGroup = HttpApiGroup.make("api.config")
  .add(HttpApiEndpoint.get("config.get", "/config", { query: WorkspaceQuery, success: Schema.toType(Config.Info) }))
  .add(
    HttpApiEndpoint.put("config.update", "/config", {
      query: WorkspaceQuery,
      payload: WritableConfig,
      success: Schema.toType(Config.Info),
      error: [ForbiddenError, InputError],
    }),
  )
  .add(
    HttpApiEndpoint.post("config.refresh", "/config/refresh", {
      query: WorkspaceQuery,
      success: Schema.toType(Config.Info),
    }),
  )
  .prefix("/api")
