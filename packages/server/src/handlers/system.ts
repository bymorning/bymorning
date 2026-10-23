import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** System endpoint implementations. */
export const SystemHandler = HttpApiBuilder.group(Api, "server.system", (handlers) =>
  Effect.succeed(handlers.handle("system.health", () => Effect.succeed("ok"))),
)
