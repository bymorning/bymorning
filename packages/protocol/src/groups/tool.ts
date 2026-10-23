import * as Session from "@bymorning/schema/session"
import * as ToolUsage from "@bymorning/schema/tool-usage"
import * as User from "@bymorning/schema/user"
import * as Workspace from "@bymorning/schema/workspace"
import { Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InputError, InternalError, InvalidCursorError } from "../errors.js"

const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const Limit = Schema.String.check(Schema.isPattern(/^(?:[1-9]|[1-9][0-9]|100)$/)).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
    SchemaTransformation.transform({ decode: Number, encode: String }),
  ),
)

/** Protocol-owned URL query codec for Workspace Tool usage history. */
export const ToolUsageQuery = Schema.Struct({
  workspace: Workspace.ID,
  cursor: Schema.optionalKey(Cursor),
  limit: Schema.optionalKey(Limit),
  userID: Schema.optionalKey(User.ID),
  sessionID: Schema.optionalKey(Session.ID),
})

const ToolUsageRecord = Schema.Struct({
  id: ToolUsage.Record.fields.id,
  userID: ToolUsage.Record.fields.userID,
  sessionID: ToolUsage.Record.fields.sessionID,
  tool: ToolUsage.Record.fields.tool,
  status: ToolUsage.Record.fields.status,
  occurredAt: ToolUsage.Record.fields.occurredAt,
}).annotate({ identifier: "ToolUsage.ListRecord" })

const ToolUsagePage = Schema.Struct({
  data: Schema.Array(ToolUsageRecord),
  cursor: Schema.optionalKey(Cursor),
}).annotate({ identifier: "ToolUsage.Page" })

/** Workspace-scoped Tool execution usage history. */
export const ToolGroup = HttpApiGroup.make("api.tool")
  .add(
    HttpApiEndpoint.get("tool.usage.list", "/tool/usage", {
      query: ToolUsageQuery,
      success: ToolUsagePage,
      error: [InputError, InvalidCursorError, InternalError],
    }),
  )
  .prefix("/api")
