/** Declares the private Workspace usage observation Event contract. */
export * as UsageEvent from "./usage-event.js"

import { Schema } from "effect"
import * as Event from "./event.js"
import * as Model from "./model.js"
import * as Session from "./session.js"
import * as Usage from "./usage.js"

/** Aggregate isolated from the public Session log and sequence. */
export const AggregateID = Schema.String.check(Schema.isStartsWith("usage:"))

/** One normalized provider Step usage observation. Private to usage accounting. */
export const Observed = Event.define("usage.observed", {
  aggregateID: AggregateID,
  sessionID: Session.ID,
  model: Model.Ref,
  usage: Usage.Usage,
})

export const Definitions = Event.inventory(Observed)
