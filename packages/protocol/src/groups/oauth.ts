import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { Workspace } from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ForbiddenError, OAuthRequestNotFoundError } from "../errors.js"

export const OAuthGroup = HttpApiGroup.make("api.oauth")
  .add(HttpApiEndpoint.get("oauth.request.get", "/oauth/request", {
    query: Schema.Struct({ id: OAuthAuthorization.ID }),
    success: Schema.Struct({ clientName: Schema.String, clientID: OAuthClient.ID }),
    error: OAuthRequestNotFoundError,
  }))
  .add(HttpApiEndpoint.post("oauth.approve", "/oauth/approve", {
    payload: Schema.Struct({ requestID: OAuthAuthorization.ID, workspaceID: Workspace.ID }),
    success: Schema.Struct({ url: Schema.String }),
    error: [OAuthRequestNotFoundError, ForbiddenError],
  }))
  .add(HttpApiEndpoint.post("oauth.deny", "/oauth/deny", {
    payload: Schema.Struct({ requestID: OAuthAuthorization.ID }),
    success: Schema.Struct({ url: Schema.String }),
    error: [OAuthRequestNotFoundError, ForbiddenError],
  }))
  .prefix("/api")
