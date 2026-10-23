import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"

const Empty = HttpApiSchema.Empty(200)
const AuthorizationQuery = Schema.Struct({
  response_type: Schema.optionalKey(Schema.String),
  client_id: Schema.optionalKey(Schema.String),
  redirect_uri: Schema.optionalKey(Schema.String),
  code_challenge: Schema.optionalKey(Schema.String),
  code_challenge_method: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
  resource: Schema.optionalKey(Schema.String),
})

export const OAuthRawGroup = HttpApiGroup.make("oauth.raw")
  .add(HttpApiEndpoint.get("oauth.protectedResource", "/.well-known/oauth-protected-resource/mcp", { success: Empty }))
  .add(HttpApiEndpoint.get("oauth.authorizationServer", "/.well-known/oauth-authorization-server", { success: Empty }))
  .add(HttpApiEndpoint.post("oauth.register", "/oauth/register", { success: Empty }))
  .add(HttpApiEndpoint.get("oauth.authorize", "/oauth/authorize", { query: AuthorizationQuery, success: Empty }))
  .add(HttpApiEndpoint.post("oauth.token", "/oauth/token", { success: Empty }))
