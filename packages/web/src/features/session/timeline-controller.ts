import { createMemo, untrack, type Accessor } from "solid-js"

import type { Controller as SessionController } from "./session-controller"
import { createTimelineParser } from "./session-presenter"
import { createTimelineHistory } from "./timeline/model"
import type { SessionUI } from "./ui/session-model"

interface Source {
  readonly data: Pick<SessionController["data"], "transcript" | "policyNotices" | "topology" | "entry" | "models">
  readonly history: { readonly loadOlder: () => Promise<void> }
  readonly preferences?: {
    readonly showAgent: Accessor<boolean>
    readonly showReasoning: Accessor<boolean>
    readonly showUsage: Accessor<boolean>
  }
}

export function createController(source: Source): {
  readonly model: Accessor<SessionUI.Timeline>
  readonly history: ReturnType<typeof createTimelineHistory>
} {
  const parseTimeline = createTimelineParser()
  const model = createMemo<SessionUI.Timeline>((previous) => {
    source.data.topology()
    const models = source.data.models() ?? []
    const preferences = {
      showAgent: source.preferences?.showAgent() ?? true,
      showReasoning: source.preferences?.showReasoning() ?? true,
      showUsage: source.preferences?.showUsage() ?? true,
    }
    return untrack(() =>
      parseTimeline({
        transcript: source.data.transcript(),
        policyNotices: source.data.policyNotices(),
        entry: source.data.entry,
        models,
        preferences,
        ...(previous?.state === "ready" && previous.rows ? { previousRows: previous.rows } : {}),
      }),
    )
  })
  return {
    model,
    history: createTimelineHistory({ transcript: source.data.transcript, loadOlder: source.history.loadOlder }),
  }
}
