import type { SessionInfo } from "@bymorning/client"

const pattern = /^(New session|Child session)(?: - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/

export function sessionLabel(session: Pick<SessionInfo, "title" | "parentID">) {
  return sessionTitle(session.title) ?? (session.parentID ? "Child session" : "Untitled")
}

export function sessionTitle(title?: string) {
  if (!title?.trim()) return undefined
  const match = title.match(pattern)
  if (!match) return title
  return match[1] === "New session" ? undefined : match[1]
}
