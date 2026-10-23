import { Schema } from "effect"

/** Stable Workspace-local Agent identity. */
export const AgentID = Schema.String.pipe(Schema.brand("Agent.ID"))
/** Stable Workspace-local Agent identity. */
export type AgentID = typeof AgentID.Type
