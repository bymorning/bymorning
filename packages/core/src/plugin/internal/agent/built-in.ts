import { AgentSchema } from "@bymorning/schema/agent"
import type { Agent } from "../../../agent.js"

/**
 * Seeds one built-in Agent's shipped definition unless a Workspace record
 * already replaces it under the same identity. Every built-in Agent plugin
 * calls this once so the "a saved record wins" rule has a single
 * implementation.
 */
export const seedBuiltIn = (
  editor: Agent.Editor,
  id: AgentSchema.ID,
  fields: Omit<AgentSchema.Info, "id" | "name" | "overridden"> & { readonly name: string },
): void => {
  if (editor.get(id) !== undefined) return
  editor.update(id, (agent) => Object.assign(agent, { ...fields, name: AgentSchema.Name.make(fields.name) }))
}
