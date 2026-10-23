import { Schema } from "effect"

/** Canonical human-facing Agent identity schema. */
export const AgentName = Schema.String.check(Schema.isPattern(/^(?!agt_).+$/)).pipe(Schema.brand("Agent.Name"))
