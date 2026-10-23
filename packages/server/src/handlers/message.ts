import { Session } from "@bymorning/core/session"
import { MessageSchema } from "@bymorning/schema/message"
import { InvalidCursorError, SessionNotFoundError } from "@bymorning/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  order: Schema.Literals(["asc", "desc"]),
  cursor: MessageSchema.ListCursor,
})

const encodeCursor = (order: "asc" | "desc", cursor: MessageSchema.ListCursor) =>
  Buffer.from(JSON.stringify({ version: 1, order, cursor })).toString("base64url")

/** Durable Message resource endpoint implementations. */
export const MessageHandler = HttpApiBuilder.group(Api, "api.message", (handlers) => {
  const invalidCursor = () => new InvalidCursorError({ message: "Invalid pagination cursor" })

  return handlers.handle("message.list", ({ params, query }) =>
    Session.Service.use((session) =>
      Effect.gen(function* () {
        const order = query.order ?? "desc"
        const encodedCursor = query.cursor
        const decoded =
          encodedCursor === undefined
            ? undefined
            : yield* Effect.try(() => JSON.parse(Buffer.from(encodedCursor, "base64url").toString("utf8"))).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Cursor)),
                Effect.mapError(invalidCursor),
              )
        if (decoded !== undefined && decoded.order !== order) return yield* invalidCursor()

        const limit = query.limit ?? 50
        // Core owns ordered reads and structured anchors. Fetch one extra row here to
        // derive the HTTP page boundaries without exposing that cursor representation.
        const messages = yield* session.messages({
          sessionID: params.sessionID,
          order,
          limit: limit + 1,
          ...(decoded === undefined ? {} : { cursor: decoded.cursor }),
        })
        const backward = decoded?.cursor.direction === "previous"
        const more = messages.length > limit
        // A backward Core read is reversed into the requested order, so its extra row
        // precedes the page rather than follows it.
        const data = backward ? messages.slice(-limit) : messages.slice(0, limit)
        const first = data[0]
        const last = data.at(-1)
        const previous =
          first === undefined || (decoded?.cursor.direction !== "next" && !(backward && more))
            ? undefined
            : encodeCursor(order, { id: first.id, direction: "previous" })
        const next =
          last === undefined || !(decoded?.cursor.direction === "previous" || more)
            ? undefined
            : encodeCursor(order, { id: last.id, direction: "next" })

        return {
          data,
          cursor: {
            ...(previous === undefined ? {} : { previous }),
            ...(next === undefined ? {} : { next }),
          },
        }
      }).pipe(
        Effect.catchTag("Session.NotFoundError", (error) =>
          new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }),
        ),
      ),
    ),
  )
})
