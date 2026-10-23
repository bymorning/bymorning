import type { SessionInfo } from "@bymorning/client"

export const HOME_SESSION_PAGE_LIMIT = 100
export const SESSION_RECENT_LIMIT = 50
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000

export async function loadHomeSessionIndex(
  list: (
    input: { readonly limit: number; readonly cursor?: string },
    options: { readonly signal?: AbortSignal },
  ) => Promise<{ readonly data: ReadonlyArray<SessionInfo>; readonly cursor?: string }>,
  signal?: AbortSignal,
) {
  const data: SessionInfo[] = []
  let cursor: string | undefined

  for (;;) {
    const response = await list(
      { limit: HOME_SESSION_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      signal === undefined ? {} : { signal },
    )
    data.push(...response.data)
    if (response.cursor === undefined) return parseHomeSessionIndex(data)
    cursor = response.cursor
  }
}

export function parseHomeSessionIndex(sessions: ReadonlyArray<SessionInfo>) {
  return sessions.filter((session) => session.parentID === undefined && session.archivedAt === undefined)
}

export function mergeHomeSessionIndex(fetched: ReadonlyArray<SessionInfo>, known: ReadonlyArray<SessionInfo>) {
  return parseHomeSessionIndex([
    ...new Map([...fetched, ...known].map((session) => [session.id, session] as const)).values(),
  ])
}

export function retainHomeSessions(sessions: ReadonlyArray<SessionInfo>, limit: number, now: number) {
  return [...Map.groupBy(sessions, (session) => session.projectID).values()].flatMap((items) => {
    const sorted = items.toSorted(compareSessionTime)
    return [
      ...sorted.slice(0, limit),
      ...sorted
        .slice(limit)
        .filter((session) => session.updatedAt.valueOf() > now - SESSION_RECENT_WINDOW)
        .slice(0, SESSION_RECENT_LIMIT),
    ]
  })
}

export function compareSessionTime(left: SessionInfo, right: SessionInfo) {
  return right.updatedAt.valueOf() - left.updatedAt.valueOf() || left.id.localeCompare(right.id)
}
