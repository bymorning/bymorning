import type { PermissionReplyInput, PermissionRequest, SessionInfo } from "@bymorning/client"
import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"

import type { Controller as SessionController } from "./session-controller"
import type { SessionPermission } from "./ui/session-permission"

type Source = {
  readonly data: Pick<SessionController["data"], "permissions" | "transcript">
  readonly permission: SessionController["permission"]
  readonly children?: {
    readonly sessionID: SessionInfo["id"]
    readonly sessions: () => ReadonlyArray<Pick<SessionInfo, "id" | "parentID" | "title">>
    readonly revision: (sessionID: SessionInfo["id"]) => number
    readonly connected: () => boolean
    readonly list: (signal: AbortSignal) => Promise<ReadonlyArray<PermissionRequest>>
  }
}

/** Present and settle this Session's requests together with its descendants' requests. */
export function createController(source: Source): SessionPermission.Model {
  const children = childPermission(source.children)
  const request = createMemo(() => source.data.permissions()[0] ?? children.requests()[0])
  const pending = () => {
    const current = request()
    return current !== undefined && source.permission.pending(current)
  }
  const error = () => {
    const current = request()
    return (current === undefined ? undefined : source.permission.error(current)) ?? children.error()
  }
  const replies: Record<SessionPermission.Reply, PermissionReplyInput["reply"]> = {
    reject: "reject",
    once: "once",
  }
  const reply = async (value: SessionPermission.Reply) => {
    const current = request()
    if (current === undefined || pending()) return
    try {
      await source.permission.reply(current, replies[value])
      await children.settle(current)
    } catch {
      /* The native mutation owns the failure. */
    }
  }
  return {
    item: () => {
      const current = request()
      if (current === undefined) return undefined
      const transcript = source.data.transcript()
      const entry =
        current.source && transcript.state === "ready"
          ? transcript.data.find((candidate) => candidate.message.id === current.source?.messageID)
          : undefined
      const tool =
        entry?.message.type === "assistant"
          ? entry.message.content.find((part) => part.type === "tool" && part.id === current.source?.callID)
          : undefined
      const child = source.children?.sessions().find((session) => session.id === current.sessionID)
      return {
        id: current.id,
        title:
          child && current.sessionID !== source.children?.sessionID
            ? `${child.title} · ${current.action}`
            : tool?.type !== "tool"
              ? current.action
              : `Called ${tool.name}`,
        action: current.action,
        resources: current.resources,
      }
    },
    pending,
    error,
    reply,
  }
}

function childPermission(source: Source["children"]) {
  const [state, setState] = createStore<{
    requests: ReadonlyArray<PermissionRequest>
    error: string | undefined
  }>({ requests: [], error: undefined })
  const owner = new AbortController()
  let snapshot: AbortController | undefined
  const descendants = createMemo(
    () => {
      const sessions = source?.sessions() ?? []
      const byID = new Map(sessions.map((session) => [session.id, session]))
      return new Set(
        sessions
          .filter((session) => {
            const visited = new Set<SessionInfo["id"]>([session.id])
            let parentID = session.parentID
            while (parentID !== undefined && !visited.has(parentID)) {
              if (parentID === source?.sessionID) return true
              visited.add(parentID)
              parentID = byID.get(parentID)?.parentID
            }
            return false
          })
          .map((session) => session.id),
      )
    },
    undefined,
    { equals: (left, right) => left.size === right.size && [...left].every((id) => right.has(id)) },
  )
  const refresh = async () => {
    snapshot?.abort()
    const current = new AbortController()
    snapshot = current
    if (!source || owner.signal.aborted) return
    if (descendants().size === 0) {
      setState({ requests: [], error: undefined })
      return
    }
    if (!source.connected()) return
    try {
      const requests = await source.list(current.signal)
      if (current.signal.aborted || owner.signal.aborted) return
      setState({ requests: requests.filter((request) => descendants().has(request.sessionID)), error: undefined })
    } catch (cause) {
      if (current.signal.aborted || owner.signal.aborted) return
      setState(
        "error",
        cause instanceof Error ? cause.message : "Could not load subagent permissions. Reconnect to retry.",
      )
    }
  }
  createEffect(() => {
    for (const id of descendants()) source?.revision(id)
    source?.connected()
    untrack(() => void refresh())
  })
  onCleanup(() => {
    owner.abort()
    snapshot?.abort()
  })
  return {
    requests: () => state.requests.filter((request) => descendants().has(request.sessionID)),
    error: () => state.error,
    settle: async (request: PermissionRequest) => {
      if (!source || owner.signal.aborted || !descendants().has(request.sessionID)) return
      snapshot?.abort()
      setState("requests", (requests) => requests.filter((item) => item.id !== request.id))
      await refresh()
    },
  }
}

export type Controller = ReturnType<typeof createController>
