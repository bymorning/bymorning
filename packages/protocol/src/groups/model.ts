import * as Model from "@bymorning/schema/model"
import * as Routing from "@bymorning/schema/routing"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, ServiceUnavailableError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Workspace-authenticated Model discovery and policy contracts. */
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const CostDimensions = {
  input: Schema.optionalKey(NonNegative),
  output: Schema.optionalKey(NonNegative),
  cache: Schema.Struct({
    read: Schema.optionalKey(NonNegative),
    write: Schema.optionalKey(NonNegative),
  }),
}
const ModelInfo = Schema.Struct({
  id: Model.Info.fields.id,
  provider: Model.Info.fields.provider,
  apiID: Model.Info.fields.apiID,
  name: Model.Info.fields.name,
  description: Model.Info.fields.description,
  family: Schema.optionalKey(Schema.String),
  status: Model.Info.fields.status,
  releaseDate: Model.Info.fields.releaseDate,
  lastUpdated: Model.Info.fields.lastUpdated,
  openWeights: Model.Info.fields.openWeights,
  capabilities: Model.Capabilities,
  variants: Schema.Array(Schema.String),
  limit: Schema.Struct({
    context: Schema.optionalKey(NonNegative),
    input: Schema.optionalKey(NonNegative),
    output: Schema.optionalKey(NonNegative),
  }),
  cost: Schema.Struct({
    ...CostDimensions,
    tiers: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          ...CostDimensions,
          tier: Schema.Struct({ type: Schema.Literal("context"), size: NonNegative }),
        }),
      ),
    ),
    experimentalOver200K: Schema.optionalKey(Schema.Struct(CostDimensions)),
  }),
}).annotate({ identifier: "Model.Info" })
const Management = Schema.Struct({
  info: ModelInfo,
  enabled: Schema.Boolean,
  isPreferredDefault: Schema.Boolean,
  isEffectiveDefault: Schema.Boolean,
  unavailableReason: Schema.optionalKey(
    Schema.Literals([
      "provider-inactive",
      "provider-disabled",
      "region-unsupported",
      "transport-unsupported",
      "connection-unavailable",
    ]),
  ),
  custom: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Model.Management" })

/** A sample request an administrator routes without running the chosen Model. */
export const RouteInput = Schema.Struct({
  model: Model.Ref,
  prompt: Schema.NonEmptyString,
  purpose: Schema.optionalKey(Routing.Purpose),
}).annotate({ identifier: "Model.RouteInput" })

/** Where Routing would send the sample request, and why. */
export const RoutePreview = Schema.Struct({
  model: Model.Ref,
  route: Routing.Route,
  judge: Schema.optionalKey(Schema.Struct({ model: Model.Ref, cost: Schema.optionalKey(NonNegative) })),
}).annotate({ identifier: "Model.RoutePreview" })

export const ModelGroup = HttpApiGroup.make("api.model")
  .add(
    HttpApiEndpoint.get("model.list", "/models", {
      query: Schema.Struct({ ...WorkspaceQuery.fields, provider: Schema.optionalKey(Schema.String) }),
      success: Schema.Array(Management),
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.get("model.auto", "/models/auto", {
      query: WorkspaceQuery,
      success: Schema.Array(Model.Ref),
    }),
  )
  .add(
    HttpApiEndpoint.post("model.route", "/models/route", {
      query: WorkspaceQuery,
      payload: RouteInput,
      success: RoutePreview,
      error: [ForbiddenError, InputError],
    }),
  )
  .add(
    HttpApiEndpoint.put("model.toggle", "/models/toggle", {
      query: WorkspaceQuery,
      payload: Model.ToggleInput,
      success: Schema.Array(Management),
      error: [InputError, ForbiddenError],
    }),
  )
  .add(
    HttpApiEndpoint.put("model.default", "/models/default", {
      query: WorkspaceQuery,
      payload: Model.Identity,
      success: Schema.Array(Management),
      error: [InputError, ForbiddenError],
    }),
  )
  .add(
    HttpApiEndpoint.post("model.create", "/models", {
      query: WorkspaceQuery,
      payload: Model.CustomInput,
      success: Management,
      error: [InputError, ForbiddenError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.put("model.update", "/models", {
      query: WorkspaceQuery,
      payload: Model.Custom,
      success: Management,
      error: [InputError, ForbiddenError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("model.delete", "/models", {
      query: Schema.Struct({ ...WorkspaceQuery.fields, ...Model.Identity.fields }),
      error: [InputError, ForbiddenError, ServiceUnavailableError],
    }),
  )
  .prefix("/api")
