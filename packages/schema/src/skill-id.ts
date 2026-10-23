import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

/** Canonical generated or stable kebab-case Skill identifier schema. */
export const SkillID = Schema.String.check(
  Schema.isMaxLength(30),
  Schema.isPattern(/^(?:skl_[0-9A-Za-z]{26}|[a-z0-9]+(?:-[a-z0-9]+)*)$/),
).pipe(
  Schema.brand("Skill.ID"),
  statics((schema) => ({ create: () => schema.make("skl_" + ascending()) })),
)
