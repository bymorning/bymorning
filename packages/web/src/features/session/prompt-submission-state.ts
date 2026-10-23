import type { PromptSelection, PromptTarget } from "../../context/prompt-state"

/** Capture and guard the prompt state involved in one asynchronous submission. */
export function createPromptSubmissionState(input: {
  readonly target: PromptTarget
  readonly prompt?: string
  readonly cursor?: number
  readonly selection?: PromptSelection
  readonly complete?: () => void
}) {
  let prompt = input.prompt ?? input.target.current()
  let cursor = input.cursor ?? input.target.cursor()
  const agents = input.target.agents.current().map((agent) => ({
    name: agent.name,
    ...(agent.mention === undefined ? {} : { mention: { ...agent.mention } }),
  }))
  const selection: PromptSelection = input.selection ?? input.target.selection.current()
  let target = input.target
  let revision = target.contentRevision()

  return {
    prompt,
    cursor,
    agents,
    selection,
    target: () => target,
    clear() {
      if (target.contentRevision() !== revision) return
      target.reset()
      revision = target.contentRevision()
    },
    retarget(next: PromptTarget, content?: { readonly text: string; readonly cursor: number }) {
      next.selection.set(selection)
      target = next
      revision = next.contentRevision()
      if (!content) return
      prompt = content.text
      cursor = content.cursor
    },
    current: (value: PromptTarget) => target === value,
    restore() {
      if (target.contentRevision() !== revision) return undefined
      return { target, content: { text: prompt, cursor, agents } }
    },
    complete: () => input.complete?.(),
  }
}

export type PromptSubmissionState = ReturnType<typeof createPromptSubmissionState>
