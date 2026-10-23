export type AgentListItem = {
  readonly id: string
  readonly name: string
  readonly instructions: string
  readonly model?: { readonly id: string; readonly provider: string; readonly variant?: string }
  readonly description?: string
  readonly mode: "subagent" | "primary" | "all"
  readonly hidden: boolean
  readonly color?: string
  readonly steps: number | null
  /** Present only for a built-in Agent; true once a Workspace record replaces its shipped definition. */
  readonly overridden?: boolean
}
