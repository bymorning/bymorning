/** Declares the Workspace Agent lifecycle Event contract. */
export * as AgentEvent from "./agent-event.js"

import { Schema } from "effect"
import * as Agent from "./agent.js"
import * as Event from "./event.js"
import * as Workspace from "./workspace.js"

/** Durable creation of one persisted Workspace Agent. */
export const Created = Event.define("agent.created", {
  workspaceID: Workspace.ID,
  id: Agent.ID,
})

/** Durable update of one persisted Workspace Agent. */
export const Updated = Event.define("agent.updated", {
  workspaceID: Workspace.ID,
  id: Agent.ID,
})

/** Durable removal of one persisted Workspace Agent. */
export const Deleted = Event.define("agent.deleted", {
  workspaceID: Workspace.ID,
  id: Agent.ID,
})

/** Current canonical Agent lifecycle definitions used inside the application. */
export const Definitions = Event.inventory(Created, Updated, Deleted)

/** Public Agent lifecycle feed item. */
export const Item = Schema.Struct({
  type: Schema.Literals([Created.type, Updated.type, Deleted.type]),
  id: Agent.ID,
}).annotate({ identifier: "AgentEvent.Item" })
/** Public Agent lifecycle feed item. */
export type Item = typeof Item.Type

/** Project an authoritative Agent lifecycle publication onto its public feed shape. */
export const project = (event: Event.Payload<(typeof Definitions)[number]>): Item => ({
  type: event.type,
  id: event.data.id,
})
