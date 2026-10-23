import { Effect, Schedule, Stream } from "effect"
import { HttpMiddleware, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InternalError } from "@bymorning/protocol/errors"
import { Api } from "../api.js"
import { EventFeed } from "../event-feed.js"

export const EventHeartbeatInterval = "15 seconds"
/** The sole public, authorized, no-replay Event source. */
export const EventHandler = HttpApiBuilder.group(Api, "api.event", (handlers) =>
  handlers.handle("event.subscribe", () =>
    HttpMiddleware.withLoggerDisabled(
      EventFeed.subscribe().pipe(
        Effect.map((stream) => eventResponse(stream.pipe(Stream.map(({ frame }) => frame)))),
        Effect.catchTag("EventHub.EncodingError", () => new InternalError({ error: "Could not encode event stream" })),
      ),
    ),
  ),
)

export const eventResponse = <E>(output: Stream.Stream<string, E>) => HttpServerResponse.stream(
  Stream.merge(output, Stream.fromSchedule(Schedule.spaced(EventHeartbeatInterval)).pipe(Stream.map(() => ": heartbeat\n\n")), { haltStrategy: "left" }).pipe(Stream.encodeText),
  { contentType: "text/event-stream", headers: { "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } },
)
