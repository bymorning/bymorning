import * as WorkspaceEvent from "@bymorning/schema/workspace-event"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InputError, InternalError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Protocol-owned URL query codec for the unified Workspace Event stream. */
export const WorkspaceEventQuery = Schema.Struct({ ...WorkspaceQuery.fields })
/** One decoded item from the Workspace Event stream. */
export type WorkspaceEventItem = WorkspaceEvent.Item

export const makeEventGroup = <WorkspaceId extends HttpApiMiddleware.AnyId, WorkspaceService>(
  workspaceMiddleware: Context.Key<WorkspaceId, WorkspaceService>,
) =>
  HttpApiGroup.make("api.event")
    .add(
      HttpApiEndpoint.get("event.subscribe", "/api/event", {
        query: WorkspaceEventQuery,
        success: HttpApiSchema.StreamSse({ data: WorkspaceEvent.Item }),
        error: [InputError, InternalError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.event.subscribe",
          summary: "Subscribe to events",
          description: "Subscribe to the authorized live Workspace Event stream. The first item is server.connected; Events are not replayed.",
        }),
      ),
    )
    .middleware(workspaceMiddleware)
