import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

/** Canonical Project identifier schema. */
export const ProjectID = Schema.String.check(Schema.isPattern(/^prj_[0-9A-Za-z]{26}$/)).pipe(
  Schema.brand("Project.ID"),
  statics((schema) => ({ create: () => schema.make("prj_" + ascending()) })),
)
