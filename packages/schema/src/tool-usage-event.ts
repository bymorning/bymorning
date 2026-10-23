/** Declares private durable Tool Usage Events. */
export * as ToolUsageEvent from "./tool-usage-event.js"

import { Schema } from "effect"
import * as Event from "./event.js"
import * as Session from "./session.js"
import * as ToolUsage from "./tool-usage.js"
import * as User from "./user.js"

/** One terminal Tool invocation, aggregated by the User who invoked it. */
export const Recorded = Event.define("tool.usage.recorded", {
  userID: User.ID,
  sessionID: Schema.NullOr(Session.ID),
  tool: ToolUsage.Record.fields.tool,
  status: ToolUsage.Status,
})

export const Definitions = Event.inventory(Recorded)
