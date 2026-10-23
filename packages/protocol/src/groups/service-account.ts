import * as ApiKey from "@bymorning/schema/api-key"
import * as ServiceAccount from "@bymorning/schema/service-account"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError, ServiceAccountNotFoundError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const NotFoundErrors = [InputError, ServiceAccountNotFoundError, InternalError] as const
/** Mutations mint or retire automation identity, so they also admit the administrator Role refusal. */
const MutationErrors = [InputError, ForbiddenError, ServiceAccountNotFoundError, InternalError] as const

/** Workspace-authenticated ServiceAccount and inference API-key management contracts. */
export const ServiceAccountGroup = HttpApiGroup.make("api.service-account")
  .add(
    HttpApiEndpoint.get("service-account.list", "/service-account", {
      query: WorkspaceQuery,
      success: Schema.Array(ServiceAccount.Summary),
    }),
  )
  .add(
    HttpApiEndpoint.post("service-account.create", "/service-account", {
      query: WorkspaceQuery,
      payload: Schema.Struct({
        name: Schema.String,
        policy: Schema.optionalKey(ServiceAccount.Policy),
      }),
      success: ServiceAccount.Info.pipe(HttpApiSchema.status(201)),
      error: [InputError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("service-account.get", "/service-account/:id", {
      params: { id: ServiceAccount.ID },
      query: WorkspaceQuery,
      success: ServiceAccount.Info,
      error: NotFoundErrors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("service-account.update", "/service-account/:id", {
      params: { id: ServiceAccount.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        policy: Schema.optionalKey(ServiceAccount.Policy),
        status: Schema.optionalKey(ServiceAccount.Status),
      }),
      success: ServiceAccount.Info,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("service-account.remove", "/service-account/:id", {
      params: { id: ServiceAccount.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("service-account.key.list", "/service-account/:id/key", {
      params: { id: ServiceAccount.ID },
      query: WorkspaceQuery,
      success: Schema.Array(ApiKey.Info),
    }),
  )
  .add(
    HttpApiEndpoint.post("service-account.key.create", "/service-account/:id/key", {
      params: { id: ServiceAccount.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        name: Schema.String,
        timeExpires: Schema.optionalKey(Schema.Date),
      }),
      success: Schema.Struct({ key: ApiKey.Info, secret: ApiKey.Secret }).pipe(
        HttpApiSchema.status(201),
      ),
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("service-account.key.revoke", "/service-account/:id/key/:keyID", {
      params: { id: ServiceAccount.ID, keyID: ApiKey.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: MutationErrors,
    }),
  )
  .prefix("/api")
