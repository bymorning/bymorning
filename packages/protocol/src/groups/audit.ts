import { Audit } from "@bymorning/schema/audit"
import { Account } from "@bymorning/schema/account"
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
const TimestampParam = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.decodeTo(
    Schema.Date,
    SchemaTransformation.transform({ decode: (value) => new Date(value), encode: (date) => date.toISOString() }),
  ),
)

const Page = Schema.Struct({
  data: Schema.Array(Audit.Entry),
  cursor: Schema.optionalKey(Cursor),
})

/**
 * Audit Entry review for Workspace administrators. Reads are scoped to the
 * selected Workspace; an Installation Admin reads installation-wide, or one
 * selected Workspace through the `workspace` query.
 */
export const AuditGroup = HttpApiGroup.make("api.audit")
  .add(
    HttpApiEndpoint.get("audit.list", "/audit", {
      query: Schema.Struct({
        ...WorkspaceQuery.fields,
        from: Schema.optionalKey(TimestampParam),
        to: Schema.optionalKey(TimestampParam),
        actor: Schema.optionalKey(Account.ID),
        action: Schema.optionalKey(Audit.Action),
        target: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
        cursor: Schema.optionalKey(Cursor),
        limit: Schema.optionalKey(Limit),
      }),
      success: Page,
      error: [InputError, InvalidCursorError, InternalError],
    }),
  )
  .prefix("/api")
