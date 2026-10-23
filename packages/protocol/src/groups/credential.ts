import { Credential } from "@bymorning/schema/credential"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InternalError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** HTTP API group for persisted Credential connection management. */
export const CredentialGroup = HttpApiGroup.make("api.credential")
  .add(
    HttpApiEndpoint.patch("credential.update", "/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({ label: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("credential.activate", "/credential/:credentialID/activate", {
      params: { credentialID: Credential.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("credential.remove", "/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, InternalError],
    }),
  )
  .prefix("/api")
