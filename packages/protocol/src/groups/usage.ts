import * as Usage from "@bymorning/schema/usage"
import { User } from "@bymorning/schema/user"
import { Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InputError, InternalError, InvalidCursorError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const Limit = Schema.String.check(Schema.isPattern(/^(?:[1-9]|[1-9][0-9]|100)$/)).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
    SchemaTransformation.transform({ decode: Number, encode: String }),
  ),
)
const Days = Schema.String.check(Schema.isPattern(/^(?:7|30|90)$/)).pipe(
  Schema.decodeTo(
    Schema.Literals([7, 30, 90]),
    SchemaTransformation.transform({
      decode: (value) => {
        if (value === "7") return 7
        if (value === "30") return 30
        return 90
      },
      encode: String,
    }),
  ),
)
const UsageTransport = Schema.toType(Usage.Usage)
const AggregateTransport = Schema.toType(Usage.Aggregate)
const Page = Schema.Struct({
  data: Schema.Array(Schema.Struct({ ...Usage.Info.fields, usage: UsageTransport })),
  cursor: Schema.optionalKey(Cursor),
})
const RecordsPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({ ...Usage.Record.fields, usage: UsageTransport })),
  cursor: Schema.optionalKey(Cursor),
})
const Overview = Schema.Struct({
  ...Usage.Overview.fields,
  total: AggregateTransport,
  daily: Schema.Array(Schema.Struct({ date: Schema.String, usage: AggregateTransport })),
  users: Schema.Array(Schema.Struct({ userID: User.ID, usage: AggregateTransport })),
  models: Schema.Array(Schema.Struct({ model: Schema.String, usage: AggregateTransport })),
})
const Leaderboard = Schema.Struct({
  ...Usage.Leaderboard.fields,
  users: Schema.Array(
    Schema.Struct({
      ...Usage.LeaderboardUser.fields,
      usage: AggregateTransport,
      models: Schema.Array(Schema.Struct({ model: Schema.String, usage: AggregateTransport })),
    }),
  ),
  models: Schema.Array(Schema.Struct({ ...Usage.LeaderboardModel.fields, usage: AggregateTransport })),
})

/** Workspace-scoped Assistant usage history. */
export const UsageGroup = HttpApiGroup.make("api.usage")
  .add(
    HttpApiEndpoint.get("usage.list", "/usage", {
      query: Schema.Struct({
        ...WorkspaceQuery.fields,
        cursor: Schema.optionalKey(Cursor),
        limit: Schema.optionalKey(Limit),
      }),
      success: Page,
      error: [InputError, InvalidCursorError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("usage.records", "/usage/records", {
      query: Schema.Struct({
        ...WorkspaceQuery.fields,
        cursor: Schema.optionalKey(Cursor),
        limit: Schema.optionalKey(Limit),
      }),
      success: RecordsPage,
      error: [InputError, InvalidCursorError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("usage.overview", "/usage/overview", {
      query: Schema.Struct({ ...WorkspaceQuery.fields, days: Days }),
      success: Overview,
      error: [InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("usage.leaderboard", "/usage/leaderboard", {
      query: Schema.Struct({ ...WorkspaceQuery.fields, days: Days }),
      success: Leaderboard,
      error: [InputError, InternalError],
    }),
  )
  .prefix("/api")
