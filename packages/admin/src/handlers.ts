import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AdminApi } from "./api.js"

/** Admin health endpoint implementation. */
export const HealthHandler = HttpApiBuilder.group(AdminApi, "admin.system", (handlers) =>
  handlers.handle("admin.health", () => Effect.succeed("ok")),
)

/** All admin HTTP endpoint implementation Layers. */
export const handlers = HealthHandler
