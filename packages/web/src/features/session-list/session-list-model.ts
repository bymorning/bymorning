export type SessionListItem = {
  readonly key: string
  readonly id: string
  readonly title: string
  readonly updatedAt: Date
  /** The Session was started by a Scheduled Task. */
  readonly scheduledTask?: boolean
  readonly project: {
    readonly name: string
    readonly avatar?: string
  }
}

export type SessionListGroup = {
  readonly id: string
  readonly title: string
  readonly items: ReadonlyArray<SessionListItem>
}

export type SessionListScope = "workspace" | "project"

export type SessionListStatus = {
  readonly open: boolean
  readonly indicator: "attention" | "idle" | "unread" | "working"
}
