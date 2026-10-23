import type { Component } from "solid-js"

import type { SessionUI } from "../session-model"

export interface ToolRendererProps {
  readonly tool: SessionUI.ToolPart
  readonly agents: ReadonlyArray<SessionUI.AgentPresentation>
  readonly actions: SessionUI.TimelineActions
  readonly subagentNavigation?: SessionUI.SubagentNavigation
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onContentRendered?: () => void
}

export type ToolRenderer = Component<ToolRendererProps>

const state = new Map<string, { readonly render: ToolRenderer; readonly handlesFailure: boolean }>()

export const ToolRegistry = {
  register(input: { readonly name: string; readonly render: ToolRenderer; readonly handlesFailure?: boolean }) {
    state.set(input.name, { render: input.render, handlesFailure: input.handlesFailure ?? false })
    return input
  },
  render(name: string) {
    return state.get(name)?.render
  },
  handlesFailure(name: string) {
    return state.get(name)?.handlesFailure ?? false
  },
}
