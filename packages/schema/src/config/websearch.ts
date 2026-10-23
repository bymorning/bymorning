export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { WebSearch } from "../websearch.js"

/** Explicit web-search provider selection. */
export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([Schema.Literal("random"), WebSearch.ID]),
}) {}

/** Web-search configuration or an explicit disabled state. */
export const Selection = Schema.Union([Schema.Literal(false), Info])

/** Web-search configuration or an explicit disabled state. */
export type Selection = typeof Selection.Type
