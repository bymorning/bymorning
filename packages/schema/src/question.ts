export * as Question from "./question.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const Prompt = Schema.Struct({
  question: Schema.String,
  header: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      description: Schema.String,
    }),
  ),
  multiple: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Question.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "Question.Answer" })
export type Answer = typeof Answer.Type
