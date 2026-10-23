/** Declares canonical prompt attachment contracts. */
export * as Prompt from "./prompt.js"

import { Schema } from "effect"

/** Exact source range occupied by a visible prompt mention. */
export const PromptMention = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}).annotate({ identifier: "Prompt.Mention" })
/** Exact source range occupied by a visible prompt mention. */
export interface PromptMention extends Schema.Schema.Type<typeof PromptMention> {}

/** Agent selected by an optional visible prompt mention. */
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  mention: Schema.optionalKey(PromptMention),
}).annotate({ identifier: "Prompt.AgentAttachment" })
/** Agent selected by an optional visible prompt mention. */
export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
