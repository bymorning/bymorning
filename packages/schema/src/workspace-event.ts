/** Declares the unified Workspace Event stream contract. */
export * as WorkspaceEvent from "./workspace-event.js"

import { Schema } from "effect"
import * as AgentEvent from "./agent-event.js"
import * as Event from "./event.js"
import { Config } from "./config.js"
import { Integration } from "./integration.js"
import { OutboundMCP } from "./outbound-mcp.js"
import { Plugin } from "./plugin.js"
import { Project } from "./project.js"
import { ScheduledTask } from "./scheduled-task.js"
import * as SessionEvent from "./session-event.js"
import { WebSearch } from "./websearch.js"

/** Marks acquisition of the authorized live Event subscription. */
export const Connected = Schema.Struct({
  id: Event.ID,
  type: Schema.Literal("server.connected"),
  data: Schema.Struct({}),
})
/** Direct client-visible Event values carried by the Workspace feed. */
export const Item = Schema.Union([
  Connected,
  AgentEvent.Created,
  AgentEvent.Updated,
  AgentEvent.Deleted,
  Config.Event.Updated,
  Plugin.Event.Added,
  Plugin.Event.Updated,
  Integration.Event.Updated,
  Integration.Event.ConnectionUpdated,
  WebSearch.Event.Updated,
  OutboundMCP.Event.StatusChanged,
  Project.FileChanged,
  SessionEvent.Payload,
  ScheduledTask.Updated,
  ScheduledTask.Deleted,
]).annotate({ identifier: "WorkspaceEvent.Item" })
export type Item = typeof Item.Type
