/** Declares the Agent contract owned by this module. */
export * as Agent from "./agent.js"
export * as AgentSchema from "./agent.js"

import { Schema } from "effect"
import { AgentID } from "./agent-id.js"
import { AgentName } from "./agent-name.js"
import { Ref as ModelRef } from "./model.js"
import { Ruleset } from "./permission.js"

/** Stable Workspace-local Agent identity. */
export const ID = AgentID
/** Stable Workspace-local Agent identity. */
export type ID = typeof ID.Type

/** A non-empty, Workspace-unique human-facing Agent name. */
export const Name = AgentName
/** A non-empty, Workspace-unique human-facing Agent name. */
export type Name = typeof Name.Type

/** Stable identity of the platform-shipped default Agent, the only primary Agent. */
export const DefaultID = ID.make("default")
/** Stable identity of the platform-shipped general subagent. */
export const GeneralID = ID.make("general")
/** Stable identity of the platform-shipped explore subagent. */
export const ExploreID = ID.make("explore")

/**
 * Platform-shipped Agent identities. A Workspace record saved under one of
 * these identities replaces its built-in definition; removing that record
 * restores the built-in.
 */
export const BuiltIn: ReadonlySet<ID> = new Set<ID>([DefaultID, GeneralID, ExploreID])

/** Optional Agent presentation color. */
export const Color = Schema.String.annotate({ identifier: "Agent.Color" })
/** Optional Agent presentation color. */
export type Color = typeof Color.Type

/** Determines where an Agent can be selected. */
export const Mode = Schema.Literals(["subagent", "primary", "all"])
/** Determines where an Agent can be selected. */
export type Mode = typeof Mode.Type

/** A one-based maximum logical Step allowance. */
export const Steps = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }))
/** A one-based maximum logical Step allowance. */
export type Steps = typeof Steps.Type

/** Agent execution-profile information. */
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  instructions: Schema.String,
  model: Schema.optionalKey(ModelRef),
  description: Schema.optionalKey(Schema.String),
  mode: Mode,
  hidden: Schema.Boolean,
  color: Schema.optionalKey(Color),
  steps: Schema.NullOr(Steps),
  permissions: Ruleset,
  /**
   * Present only for a built-in Agent identity; true when a Workspace record
   * replaces its shipped definition, false when the shipped definition is
   * still in effect. Absent for an Agent that has no built-in definition.
   */
  overridden: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Agent.Info" })
/** Agent execution-profile information. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Mutable Agent execution-profile fields; the Agent ID remains its identity. */
export const Update = Info.mapFields(
  ({ name, instructions, model, description, mode, hidden, color, steps, permissions }) => ({
    name,
    instructions,
    model,
    description,
    mode,
    hidden,
    color,
    steps,
    permissions,
  }),
)
/** Mutable Agent execution-profile fields. */
export interface Update extends Schema.Schema.Type<typeof Update> {}
