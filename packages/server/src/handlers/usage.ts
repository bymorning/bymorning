import { Usage } from "@bymorning/core/usage"
import { InvalidCursorError } from "@bymorning/protocol/errors"
import { Days } from "@bymorning/schema/usage"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Usage endpoint implementations. */
export const UsageHandler = HttpApiBuilder.group(Api, "api.usage", (handlers) =>
  handlers
    .handle("usage.list", ({ query }) =>
      Usage.Service.use((usage) =>
        usage
          .list(query)
          .pipe(
            Effect.catchTag("Usage.InvalidCursorError", () => new InvalidCursorError({ message: "Invalid cursor" })),
          ),
      ),
    )
    .handle("usage.records", ({ query }) =>
      Usage.Service.use((usage) =>
        usage
          .records({
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          })
          .pipe(
            Effect.catchTag("Usage.InvalidCursorError", () => new InvalidCursorError({ message: "Invalid cursor" })),
          ),
      ),
    )
    .handle("usage.overview", ({ query }) =>
      Usage.Service.use((usage) => usage.overview({ days: Days.make(query.days) })),
    )
    .handle("usage.leaderboard", ({ query }) =>
      Usage.Service.use((usage) => usage.leaderboard({ days: Days.make(query.days) })),
    ),
)
