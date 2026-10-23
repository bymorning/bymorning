/** Declares the Skill contract owned by this module. */
export * as Skill from "./skill.js"
export * as SkillSchema from "./skill.js"

import { Schema } from "effect"
import { SkillID } from "./skill-id.js"

/** Immutable identity of a Workspace-owned Skill. */
export const ID = SkillID

/** Immutable identity of a Workspace-owned Skill. */
export type ID = typeof ID.Type

/** Non-empty human-facing Skill name. */
export const Name = Schema.NonEmptyString

/** Non-empty human-facing Skill name. */
export type Name = typeof Name.Type

/** Public Skill information. */
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  description: Schema.String,
  instructions: Schema.String,
})

/** Public Skill information. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Input for creating a Skill, derived from public Skill information. */
export const Create = Info.mapFields(({ name, description, instructions }) => ({ name, description, instructions }))

/** Input for creating a Skill, derived from public Skill information. */
export interface Create extends Schema.Schema.Type<typeof Create> {}
