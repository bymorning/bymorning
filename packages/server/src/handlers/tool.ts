import { ToolUsage } from "@bymorning/core/tool-usage"
import { InvalidCursorError } from "@bymorning/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Tool endpoint implementations. */
export const ToolHandler = HttpApiBuilder.group(Api, "api.tool", (handlers) =>
  handlers.handle("tool.usage.list", ({ query }) =>
    ToolUsage.Service.use((usage) =>
      usage
        .records({
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.userID === undefined ? {} : { userID: query.userID }),
          ...(query.sessionID === undefined ? {} : { sessionID: query.sessionID }),
        })
        .pipe(
          Effect.catchTag("ToolUsage.InvalidCursorError", () => new InvalidCursorError({ message: "Invalid cursor" })),
        ),
    ),
  ),
)
