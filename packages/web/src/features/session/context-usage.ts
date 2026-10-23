import type { SessionDetail } from "@bymorning/client"
import { context } from "@bymorning/schema/usage"

import type { TranscriptEntry } from "../../context/session-state"
import type { ModelOption } from "../../utils/model-option"

type ModelRef = Pick<ModelOption, "id" | "provider">

export interface ContextUsage {
  /** Context-window tokens occupied after the latest observed execution. */
  readonly tokens: number
  /** Cumulative estimated Session cost. */
  readonly cost: number
  readonly costComplete: boolean
  readonly percentage?: number
}

const find = (models: ReadonlyArray<ModelOption> | undefined, ref: ModelRef | undefined) =>
  ref === undefined ? undefined : models?.find((item) => item.id === ref.id && item.provider === ref.provider)

/**
 * Project the Session header's context-window indicator.
 *
 * Occupancy is measured from the latest completed Assistant execution inside the current
 * compaction window, matching automatic compaction. Session totals re-count replayed history on
 * every request, so they only supply cost. The limit comes from the Session's selected Model,
 * falling back to the execution's resolved Model when the selection (such as Auto) has none.
 */
export function contextUsage(input: {
  readonly usage: SessionDetail["usage"]
  readonly model: ModelRef
  readonly entries: ReadonlyArray<TranscriptEntry>
  readonly models: ReadonlyArray<ModelOption> | undefined
}): ContextUsage {
  let tokens = 0
  let resolved: ModelRef | undefined
  for (let index = input.entries.length - 1; index >= 0; index--) {
    const message = input.entries[index]!.message
    if (message.type === "compaction" && message.status === "completed") break
    if (message.type !== "assistant" || message.time.completed === undefined || message.usage === undefined) continue
    const used = context(message.usage)
    if (used === 0) continue
    tokens = used
    resolved = message.model
    break
  }
  const limit = find(input.models, input.model)?.limit.context || find(input.models, resolved)?.limit.context
  return {
    tokens,
    cost: input.usage.cost,
    costComplete: "costComplete" in input.usage ? input.usage.costComplete !== false : true,
    ...(limit ? { percentage: Math.min(100, Math.round((tokens / limit) * 100)) } : {}),
  }
}
