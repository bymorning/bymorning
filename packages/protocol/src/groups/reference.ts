import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InputError, InternalError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Workspace-scoped reference catalog contracts. */
export const ReferenceGroup = HttpApiGroup.make("api.reference")
  .add(
    HttpApiEndpoint.get("reference.list", "/reference", {
      query: WorkspaceQuery,
      success: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          path: Schema.String,
          description: Schema.optionalKey(Schema.String),
          hidden: Schema.optionalKey(Schema.Boolean),
          source: Schema.Union([
            Schema.Struct({
              type: Schema.Literal("local"),
              path: Schema.String,
              description: Schema.optionalKey(Schema.String),
              hidden: Schema.optionalKey(Schema.Boolean),
            }),
            Schema.Struct({
              type: Schema.Literal("git"),
              repository: Schema.String,
              branch: Schema.optionalKey(Schema.String),
              description: Schema.optionalKey(Schema.String),
              hidden: Schema.optionalKey(Schema.Boolean),
            }),
          ]),
        }),
      ),
      error: [InputError, InternalError],
    }),
  )
  .prefix("/api")
