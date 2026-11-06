import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { Workspace } from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ForbiddenError, OAuthRequestNotFoundError } from "../errors.js"

export const OAuthGroup = HttpApiGroup.make("api.oauth")
  .add(HttpApiEndpoint.get("oauth.request.get", "/oauth/request", {
    query: Schema.Struct({ id: OAuthAuthorization.ID }),
    // `clientName` is whatever the client registered itself as, so it proves nothing. `redirectOrigins` is where the
    // client's registered redirect URIs send the result of an approval (scheme and host only), which the consent
    // page shows so a member can tell a local app from someone else's server.
    success: Schema.Struct({
      clientName: Schema.String,
      clientID: OAuthClient.ID,
      redirectOrigins: Schema.Array(Schema.String),
    }),
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
