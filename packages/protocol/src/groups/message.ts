import * as Message from "@bymorning/schema/message"
import * as Session from "@bymorning/schema/session"
import { Context, Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/unstable/httpapi"
import { InputError, InternalError, InvalidCursorError, SessionNotFoundError } from "../errors.js"

const Limit = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)).pipe(
  Schema.decodeTo(
    Message.ListInput.fields.limit.schema,
    SchemaTransformation.transform({ decode: Number, encode: String }),
  ),
)
const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const ListQuery = Schema.Struct({
  limit: Schema.optionalKey(Limit),
  order: Schema.optionalKey(Message.ListInput.fields.order.schema),
  cursor: Schema.optionalKey(Cursor),
})
const CursorOutput = Schema.Struct({ previous: Schema.optionalKey(Cursor), next: Schema.optionalKey(Cursor) })
export const ListResponse = Schema.Struct({ data: Schema.Array(Message.Message), cursor: CursorOutput }).annotate({
  identifier: "Message.ListResponse",
})

/** Message resource endpoints. Cursor serialization is owned by Protocol. */
export const makeMessageGroup = <PersistedSessionId extends HttpApiMiddleware.AnyId, PersistedSessionService>(
  persistedSessionMiddleware: Context.Key<PersistedSessionId, PersistedSessionService>,
) =>
  HttpApiGroup.make("api.message")
    .add(
      HttpApiEndpoint.get("message.list", "/session/:sessionID/message", {
        params: { sessionID: Session.ID },
        query: ListQuery,
        success: ListResponse,
        error: [InputError, InvalidCursorError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .prefix("/api")
