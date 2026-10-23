import type { AgentInfo } from "@bymorning/client"

import type { SessionUI as Connection } from "./session-context"
import type { SessionUI } from "./ui/session-model"

type ToolPart = Extract<
  Extract<Connection.Transcript, { state: "ready" }>["data"][number]["message"],
  { type: "assistant" }
>["content"][number] & { type: "tool" }

export function presentBackground(input: {
  readonly transcript: Connection.Transcript
  readonly agents: ReadonlyArray<AgentInfo>
}) {
  const entries = input.transcript.state === "ready" ? input.transcript.data : []
  const latest = entries
    .filter(
      (entry) =>
        entry.message.type === "assistant" &&
        entry.message.finish === undefined &&
        entry.message.time.completed === undefined,
    )
    .at(-1)
  const blocking =
    latest?.message.type === "assistant"
      ? latest.message.content.flatMap((part) =>
          part.type === "tool" && (part.name === "subagent" || part.name === "shell") && part.state.status === "running"
            ? [part.id]
            : [],
        )
      : []
  const settled = new Set<string>()
  entries.forEach(({ message }) => {
    if (message.type !== "synthetic") return
    const metadata = message.metadata
    if (metadata?.source !== "subagent" && metadata?.source !== "shell") return
    if (!terminalState(metadata.state)) return
    const identity = metadata.source === "subagent" ? metadata.childID : metadata.shellID
    if (typeof identity !== "string" || typeof metadata.startedAt !== "number") return
    settled.add(`${metadata.source}:${identity}:${metadata.startedAt}`)
  })

  const agents = new Map<string, AgentInfo>(input.agents.map((agent) => [agent.id, agent]))
  const candidates = new Map<string, SessionUI.BackgroundTask>()
  const add = (tool: ToolPart) => {
    if (tool.state.status !== "completed" || (tool.name !== "subagent" && tool.name !== "shell")) return
    if (tool.state.metadata?.status !== "running" || typeof tool.state.metadata.startedAt !== "number") return
    const kind = tool.name
    const identity = kind === "subagent" ? tool.state.metadata.sessionID : tool.state.metadata.shellID
    if (typeof identity !== "string") return
    const id = `${kind}:${identity}:${tool.state.metadata.startedAt}`
    if (settled.has(id)) return
    if (kind === "shell") {
      const description = recordString(tool.state.input, "command")
      candidates.set(id, { id, kind, ...(description ? { description } : {}) })
      return
    }
    const agentID = recordString(tool.state.input, "agent")
    const agent = agentID ? agents.get(agentID) : undefined
    const title = agent?.name ?? agentID
    const description = recordString(tool.state.input, "description")
    candidates.set(id, {
      id,
      kind,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      sessionID: identity,
      ...(agent?.color ? { color: agent.color } : {}),
    })
  }
  entries.forEach(({ message }) => {
    if (message.type !== "assistant") return
    message.content.forEach((part) => {
      if (part.type === "tool") add(part)
    })
  })
  return { blocking, active: [...candidates.values()] }
}

function recordString(input: unknown, key: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = Reflect.get(input, key)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function terminalState(state: unknown) {
  return state === "completed" || state === "error" || state === "cancelled"
}
