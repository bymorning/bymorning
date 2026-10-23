import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"

/** Unauthenticated admin HTTP endpoints. */
export const HealthGroup = HttpApiGroup.make("admin.system").add(
  HttpApiEndpoint.get("admin.health", "/health", {
    success: Schema.String.pipe(HttpApiSchema.asText()),
  }),
)

/** Unauthenticated admin HTTP contract mounted at `/admin`. */
export class AdminApi extends HttpApi.make("admin").add(HealthGroup).prefix("/admin") {}
