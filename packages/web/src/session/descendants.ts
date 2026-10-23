import type { ByMorningClient, SessionInfo } from "@bymorning/client"
import type { Connection, SessionID, WorkspaceID } from "@bymorning/client/solid"
import { createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

type Row = Pick<SessionInfo, "id" | "parentID" | "title">

const row = (session: SessionInfo): Row => ({
  id: session.id,
  ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
  title: session.title,
})

/** Feature-local relationship discovery. Never contributes rows to the root inventory. */
export function createDescendants(input: {
  readonly client: ByMorningClient
  readonly connection: Pick<Connection, "listen">
  readonly workspace: WorkspaceID
  readonly sessionID: () => SessionID
}) {
  const [state, setState] = createStore({ revision: 0 })
  let pending: AbortController | undefined
  // Live events that arrive while discovery is in flight may predate or postdate
  // the pages already read; the fetcher repeats once instead of guessing.
  let dirty = false
  const children = async (parentID: SessionID, signal: AbortSignal) => {
    const rows: SessionInfo[] = []
    let cursor: string | undefined
    do {
      const page = await input.client.session.list(
        {
          workspace: input.workspace,
          parentID,
          archived: false,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        },
        { signal },
      )
      rows.push(...page.data)
      cursor = page.cursor
    } while (cursor !== undefined)
    return rows
  }
  const discover = async (id: SessionID, signal: AbortSignal) => {
    const result: Row[] = []
    const visited = new Set<SessionID>([id])
    // Breadth-first by level: every parent at one depth is listed in one round trip.
    let parents = [id]
    while (parents.length > 0) {
      const pages = await Promise.all(parents.map((parentID) => children(parentID, signal)))
      parents = []
      for (const session of pages.flat()) {
        if (visited.has(session.id)) continue
        visited.add(session.id)
        result.push(row(session))
        parents.push(session.id)
      }
    }
    return result
  }
  // A primitive key keeps upstream identity changes of the same Session from refetching.
  const key = createMemo(() => `${state.revision}:${input.sessionID()}`)
  const [rows, { mutate }] = createResource(key, async (current) => {
    const id = current.slice(current.indexOf(":") + 1) as SessionID
    pending?.abort()
    const controller = (pending = new AbortController())
    let result: Row[]
    do {
      dirty = false
      result = await discover(id, controller.signal)
    } while (dirty && !controller.signal.aborted)
    return result
  })
  const refresh = () => setState("revision", (revision) => revision + 1)
  const remove = (current: readonly Row[], id: SessionID) => {
    const gone = new Set<SessionID>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const item of current)
        if (!gone.has(item.id) && item.parentID !== undefined && gone.has(item.parentID)) {
          gone.add(item.id)
          changed = true
        }
    }
    return current.filter((item) => !gone.has(item.id))
  }
  const off = input.connection.listen((event) => {
    if (event.type === "server.connected") return refresh()
    if (event.type !== "session.created" && event.type !== "session.updated" && event.type !== "session.deleted") return
    const current = rows.latest
    if (rows.loading || current === undefined) {
      dirty = true
      return
    }
    const root = input.sessionID()
    const known = current.some((item) => item.id === event.data.sessionID)
    if (event.type === "session.deleted") {
      if (known) mutate(remove(current, event.data.sessionID))
      return
    }
    const session = event.data.session
    const inside =
      session.parentID !== undefined &&
      session.archivedAt === undefined &&
      (session.parentID === root || current.some((item) => item.id === session.parentID))
    if (!inside) {
      if (known) mutate(remove(current, session.id))
      return
    }
    if (known) mutate(current.map((item) => (item.id === session.id ? row(session) : item)))
    else if (event.type === "session.created") mutate([...current, row(session)])
    // An unknown Session surfacing through an update may already have children.
    else refresh()
  })
  onCleanup(() => {
    pending?.abort()
    off()
  })
  return rows
}
