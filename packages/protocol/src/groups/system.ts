import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"

/** System HTTP endpoints. */
export const SystemGroup = HttpApiGroup.make("server.system").add(
  HttpApiEndpoint.get("system.health", "/system/health", {
    success: Schema.String.pipe(HttpApiSchema.asText()),
  }),
)
