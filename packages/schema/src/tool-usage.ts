/** Exposes the Tool Usage contract owned by this module. */
export * as ToolUsage from "./tool-usage.js"
export * as ToolUsageSchema from "./tool-usage.js"

import { Schema } from "effect"
import * as Session from "./session.js"
import { Timestamp } from "./schema.js"
import * as User from "./user.js"
import * as Workspace from "./workspace.js"

/** Stable identity of one recorded Tool invocation. */
export const ID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ToolUsage.ID"))
/** Stable identity of one recorded Tool invocation. */
export type ID = typeof ID.Type

/** Terminal outcome of a Tool invocation. */
export const Status = Schema.Literals(["completed", "error"])
/** Terminal outcome of a Tool invocation. */
export type Status = typeof Status.Type

/** One immutable terminal Tool invocation attributed to a Workspace User. */
export const Record = Schema.Struct({
  id: ID,
  workspaceID: Workspace.ID,
  userID: User.ID,
  sessionID: Schema.NullOr(Session.ID),
  tool: Schema.String.check(Schema.isMinLength(1)),
  status: Status,
  occurredAt: Timestamp,
}).annotate({ identifier: "ToolUsage.Record" })

/** One immutable terminal Tool invocation attributed to a Workspace User. */
export interface Record extends Schema.Schema.Type<typeof Record> {}
