import type { SessionUI } from "../ui/session-model"

const contextTools = new Set(["read", "glob", "grep", "list"])

type Entry =
  | { readonly type: "assistant"; readonly message: SessionUI.AssistantMessage }
  | { readonly type: "notice"; readonly notice: SessionUI.Notice }
type Turn = {
  readonly id: string
  readonly user?: SessionUI.UserMessage
  readonly entries: Entry[]
  state: SessionUI.TurnState
  stateEntryIndex: number
}
type GroupRow = Extract<SessionUI.TimelineRow, { type: "assistant-part" }>
type PriorGroup = { readonly index: number; readonly row: GroupRow }
type Usage = NonNullable<SessionUI.MessageDetails["usage"]>

export function projectTimeline(
  items: ReadonlyArray<SessionUI.Item>,
  preferences: SessionUI.Preferences,
  previousRows?: ReadonlyArray<SessionUI.TimelineRow>,
) {
  const turns: Turn[] = []
  const leading: SessionUI.Notice[] = []
  let current: Turn | undefined
  items.forEach((item) => {
    if (item.type === "notice") {
      if (current) current.entries.push({ type: "notice", notice: item })
      if (!current) leading.push(item)
      return
    }
    if (item.user || !current) {
      const next: Turn = {
        id: item.id,
        entries: [],
        state: item.state,
        stateEntryIndex: 0,
        ...(item.user ? { user: item.user } : {}),
      }
      current = next
      turns.push(next)
    }
    current.entries.push(...item.assistant.map((message) => ({ type: "assistant" as const, message })))
    current.state = item.state
    current.stateEntryIndex = current.entries.length
  })

  const userByID = new Map(turns.flatMap((turn) => (turn.user ? [[turn.user.id, turn.user] as const] : [])))
  const noticeByID = new Map(items.flatMap((item) => (item.type === "notice" ? [[item.id, item] as const] : [])))
  const partByKey = new Map<string, SessionUI.TimelinePartEntry>()
  const projected = [
    ...leading.map((notice) => ({
      type: "notice" as const,
      key: `notice:${notice.id}`,
      turnID: turns[0]?.id ?? notice.id,
      noticeID: notice.id,
    })),
    ...turns.flatMap((turn, index) => constructTurnRows(turn, index, preferences, partByKey)),
  ]
  const rows = reuseTimelineRows(previousRows, projected)
  const rowByKey = new Map(rows.map((row) => [row.key, row] as const))
  const messageFirstRowIndex = new Map<string, number>()
  const turnLastRowIndex = new Map<string, number>()
  rows.forEach((row, index) => {
    turnLastRowIndex.set(row.turnID, index)
    const ids =
      row.type === "user-message"
        ? [row.messageID]
        : row.type === "assistant-part"
          ? [...new Set(groupRefs(row.group).map((ref) => ref.messageID))]
          : []
    ids.forEach((id) => {
      if (!messageFirstRowIndex.has(id)) messageFirstRowIndex.set(id, index)
    })
  })
  const activeTurnID = turns.findLast((turn) => turn.state.type !== "queued")?.id ?? turns.at(-1)?.id
  const activeLastIndex = activeTurnID ? turnLastRowIndex.get(activeTurnID) : undefined
  const activeLastRowKey = activeLastIndex === undefined ? undefined : rows[activeLastIndex]?.key
  return {
    rows,
    rowByKey,
    userByID,
    noticeByID,
    partByKey,
    resolvePart: (messageID: string, partID: string) => partByKey.get(`${messageID}:${partID}`),
    messageFirstRowIndex,
    ...(activeLastRowKey ? { activeLastRowKey } : {}),
  }
}

function constructTurnRows(
  turn: Turn,
  turnIndex: number,
  preferences: SessionUI.Preferences,
  partByKey: Map<string, SessionUI.TimelinePartEntry>,
) {
  const rows: SessionUI.TimelineRow[] = []
  if (turnIndex > 0) rows.push({ type: "turn-gap", key: `turn-gap:${turn.id}`, turnID: turn.id })
  if (turn.user)
    rows.push({ type: "user-message", key: `user-message:${turn.user.id}`, turnID: turn.id, messageID: turn.user.id })

  const assistantMessages = turn.entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
  const lastAssistant = assistantMessages.at(-1)
  const compaction = turn.entries.some((entry) => entry.type === "notice" && entry.notice.kind === "compaction")
  const delegating = assistantMessages.some((message) =>
    message.parts.some((part) => part.type === "tool" && part.name === "subagent" && part.state.type === "running"),
  )
  let assistantGroupIndex = 0
  let segment: SessionUI.AssistantMessage[] = []
  const footer = turnFooter(turn, preferences.showAgent, preferences.showUsage)
  const append = () => {
    const entries = segment.flatMap((message, messageIndex) => {
      const visible = message.parts.filter((part) => renderable(part, preferences.showReasoning))
      return visible.map((part) => {
        const ownsFooter = footer?.messageID === message.id && footer.partID === part.id
        const entry = {
          messageID: message.id,
          part,
          streaming: message.streaming && !message.cancelling,
          ...(ownsFooter ? { copyText: footer.text } : {}),
          ...(ownsFooter && footer.details ? { details: footer.details } : {}),
          ...(ownsFooter && footer.interrupted ? { interrupted: true } : {}),
        }
        partByKey.set(partKey({ messageID: message.id, partID: part.id }), entry)
        return { ref: { messageID: message.id, partID: part.id }, part, messageIndex }
      })
    })
    const appendGroups = (values: typeof entries) =>
      groupContent(values).forEach((group) => {
        rows.push({
          type: "assistant-part",
          key: `assistant-part:${group.key}`,
          turnID: turn.id,
          group,
          previousAssistantPart: assistantGroupIndex > 0,
        })
        assistantGroupIndex += 1
      })
    let segmentStart = 0
    segment.forEach((message, messageIndex) => {
      if (message.error?.type !== "interrupted") return
      appendGroups(entries.filter((entry) => entry.messageIndex >= segmentStart && entry.messageIndex <= messageIndex))
      if (!compaction)
        rows.push({
          type: "turn-divider",
          key: `turn-divider:${turn.id}:${message.id}`,
          turnID: turn.id,
        })
      segmentStart = messageIndex + 1
    })
    appendGroups(entries.filter((entry) => entry.messageIndex >= segmentStart))
    if (segment.at(-1) === lastAssistant && lastAssistant?.error?.type === "failed")
      rows.push({ type: "error", key: `error:${turn.id}`, turnID: turn.id, failure: lastAssistant.error.failure })
    segment = []
  }
  const appendTerminal = () => {
    if (
      (turn.state.type === "interrupted" && lastAssistant?.error?.type === "interrupted") ||
      (turn.state.type === "failed" && lastAssistant?.error?.type === "failed")
    )
      return
    if (turn.state.type === "interrupted" && !compaction)
      rows.push({ type: "turn-divider", key: `turn-divider:${turn.id}`, turnID: turn.id })
    if (turn.state.type === "failed")
      rows.push({ type: "error", key: `error:${turn.id}`, turnID: turn.id, failure: turn.state.failure })
  }
  turn.entries.forEach((entry, index) => {
    if (index === turn.stateEntryIndex) {
      append()
      appendTerminal()
    }
    if (entry.type === "assistant") {
      segment.push(entry.message)
      return
    }
    append()
    rows.push({ type: "notice", key: `notice:${entry.notice.id}`, turnID: turn.id, noticeID: entry.notice.id })
  })
  append()

  if (turn.stateEntryIndex === turn.entries.length) appendTerminal()
  if (turn.state.type === "working" && lastAssistant?.retry)
    rows.push({
      type: "retry",
      key: `retry:${turn.id}:${lastAssistant.id}`,
      turnID: turn.id,
      messageID: lastAssistant.id,
      attempt: lastAssistant.retry.attempt,
      at: lastAssistant.retry.at,
    })
  const live = assistantMessages.some((message) =>
    message.parts.some((part) => {
      if (part.type === "tool") return part.state.type === "running"
      return message.streaming && !message.cancelling && renderable(part, preferences.showReasoning)
    }),
  )
  if (turn.state.type === "working" && !lastAssistant?.retry && !delegating && !live)
    rows.push({ type: "thinking", key: `thinking:${turn.id}`, turnID: turn.id })
  return rows
}

function renderable(part: SessionUI.MessagePart, showReasoning: boolean) {
  if (part.type === "text") return !!part.text.trim()
  if (part.type === "reasoning") return showReasoning && !!part.text.trim()
  if (part.name === "todowrite") return false
  if (part.name === "question") return part.state.type !== "running"
  return true
}

function groupContent(
  entries: ReadonlyArray<{
    readonly ref: SessionUI.TimelinePartRef
    readonly part: SessionUI.MessagePart
    readonly messageIndex: number
  }>,
) {
  const groups: SessionUI.TimelinePartGroup[] = []
  let adjacent: { type: "context" | "patch" | "edit"; refs: SessionUI.TimelinePartRef[] } | undefined
  const flush = () => {
    const first = adjacent?.refs[0]
    if (!first || !adjacent) return
    groups.push({
      type: adjacent.type === "context" ? "context" : "file",
      key: `${adjacent.type === "context" ? "context" : "part"}:${first.messageID}:${first.partID}`,
      refs: adjacent.refs,
    })
    adjacent = undefined
  }
  entries.forEach((entry) => {
    const type =
      entry.part.type === "tool" &&
      contextTools.has(entry.part.name) &&
      (entry.part.state.type === "running" || entry.part.state.type === "succeeded") &&
      !hasLoadedFiles(entry.part)
        ? "context"
        : entry.part.type === "tool" &&
            entry.part.name === "patch" &&
            (entry.part.state.type === "running" || entry.part.state.type === "succeeded")
          ? "patch"
          : entry.part.type === "tool" &&
              entry.part.name === "edit" &&
              (entry.part.state.type === "running" || entry.part.state.type === "succeeded")
            ? "edit"
            : undefined
    if (type) {
      if (adjacent?.type !== type) flush()
      adjacent ??= { type, refs: [] }
      adjacent.refs.push(entry.ref)
      return
    }
    flush()
    groups.push({ type: "part", key: `part:${entry.ref.messageID}:${entry.ref.partID}`, ref: entry.ref })
  })
  flush()
  return groups
}

function hasLoadedFiles(part: SessionUI.ToolPart) {
  if (part.name !== "read" || part.state.type !== "succeeded") return false
  const loaded = part.metadata.loaded
  return Array.isArray(loaded) && loaded.some((path) => typeof path === "string")
}

function groupRefs(group: SessionUI.TimelinePartGroup) {
  return group.type === "part" ? [group.ref] : group.refs
}

export function reuseTimelineRows(
  previous: ReadonlyArray<SessionUI.TimelineRow> | undefined,
  rows: ReadonlyArray<SessionUI.TimelineRow>,
) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [row.key, row] as const))
  const groupByPart = new Map<string, PriorGroup>()
  previous.forEach((row, index) => {
    if (row.type !== "assistant-part" || row.group.type === "part") return
    groupRefs(row.group).forEach((ref) => groupByPart.set(partKey(ref), { index, row }))
  })
  const reserved = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row.type !== "assistant-part" || row.group.type === "part") return
    if (byKey.has(row.key) && !reserved.has(row.key)) reserved.set(row.key, index)
  })
  const claimed = new Set<string>()
  const next = rows.map((input, index) => {
    const row = stabilizeGroupKey(groupByPart, reserved, input, index, claimed)
    const existing = byKey.get(row.key)
    return existing && rowEqual(existing, row) ? existing : row
  })
  return previous.length === next.length && previous.every((row, index) => row === next[index]) ? previous : next
}

function stabilizeGroupKey(
  groupByPart: Map<string, PriorGroup>,
  reserved: Map<string, number>,
  row: SessionUI.TimelineRow,
  rowIndex: number,
  claimed: Set<string>,
) {
  if (row.type !== "assistant-part" || row.group.type === "part") return row
  const existing = groupRefs(row.group).reduce<PriorGroup | undefined>((result, ref) => {
    const candidate = groupByPart.get(partKey(ref))
    if (!candidate || claimed.has(candidate.row.key)) return result
    const owner = reserved.get(candidate.row.key)
    if (owner !== undefined && owner !== rowIndex) return result
    return !result || candidate.index < result.index ? candidate : result
  }, undefined)
  if (!existing) return row
  claimed.add(existing.row.key)
  if (row.key === existing.row.key) return row
  return { ...row, key: existing.row.key, group: { ...row.group, key: existing.row.group.key } }
}

function partKey(ref: SessionUI.TimelinePartRef) {
  return `${ref.messageID}:${ref.partID}`
}

function rowEqual(left: SessionUI.TimelineRow, right: SessionUI.TimelineRow) {
  if (left.type !== right.type || left.turnID !== right.turnID) return false
  if (left.type === "turn-gap" && right.type === "turn-gap") return true
  if (left.type === "user-message" && right.type === "user-message") return left.messageID === right.messageID
  if (left.type === "assistant-part" && right.type === "assistant-part")
    return left.previousAssistantPart === right.previousAssistantPart && groupEqual(left.group, right.group)
  if (left.type === "notice" && right.type === "notice") return left.noticeID === right.noticeID
  if (left.type === "turn-divider" && right.type === "turn-divider") return true
  if (left.type === "error" && right.type === "error") return failureEqual(left.failure, right.failure)
  if (left.type === "retry" && right.type === "retry")
    return left.messageID === right.messageID && left.attempt === right.attempt && left.at === right.at
  return left.type === "thinking" && right.type === "thinking"
}

function failureEqual(left: SessionUI.ExecutionFailure, right: SessionUI.ExecutionFailure) {
  if (left.type !== right.type) return false
  if (left.type === "generic" && right.type === "generic") return left.message === right.message
  if (left.type === "provider" && right.type === "provider")
    return (
      left.summary === right.summary &&
      left.message === right.message &&
      left.requestID === right.requestID &&
      left.responseBody === right.responseBody &&
      left.bodyTruncated === right.bodyTruncated
    )
  return left.type === "policy" && right.type === "policy" && left.agent === right.agent && left.model === right.model
}

function groupEqual(left: SessionUI.TimelinePartGroup, right: SessionUI.TimelinePartGroup) {
  if (left.type !== right.type || left.key !== right.key) return false
  const leftRefs = groupRefs(left)
  const rightRefs = groupRefs(right)
  return (
    leftRefs.length === rightRefs.length &&
    leftRefs.every(
      (ref, index) => ref.messageID === rightRefs[index]?.messageID && ref.partID === rightRefs[index]?.partID,
    )
  )
}

function turnFooter(turn: Turn, showAgent: boolean, showUsage: boolean) {
  const messages = turn.entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
  if (turn.state.type === "working" || messages.some((message) => message.streaming)) return undefined
  const message = messages.findLast((candidate) =>
    candidate.parts.some((part) => part.type === "text" && !!part.text.trim()),
  )
  const part = message?.parts.findLast((candidate) => candidate.type === "text" && !!candidate.text.trim())
  if (!message || part?.type !== "text") return undefined
  const completed = messages.reduce<number | undefined>((latest, candidate) => {
    const value = candidate.details?.completedAt
    if (value === undefined) return latest
    return latest === undefined ? value : Math.max(latest, value)
  }, undefined)
  const durationMs =
    turn.user?.createdAt !== undefined && completed !== undefined && completed >= turn.user.createdAt
      ? completed - turn.user.createdAt
      : message.details?.durationMs
  const usage = messages.reduce<Usage | undefined>((total, candidate) => {
    const value = candidate.details?.usage
    if (!value) return total
    return {
      tokens: (total?.tokens ?? 0) + value.tokens,
      cost: (total?.cost ?? 0) + value.cost,
      costComplete: (total?.costComplete ?? true) && value.costComplete,
    }
  }, undefined)
  return {
    messageID: message.id,
    partID: part.id,
    text: part.text,
    details: messageDetails(message, showAgent, durationMs, showUsage ? usage : undefined),
    interrupted: turn.state.type === "interrupted",
  }
}

function messageDetails(message: SessionUI.AssistantMessage, showAgent: boolean, durationMs?: number, usage?: Usage) {
  if (!message.details) return undefined
  return [
    showAgent ? message.details.agent : undefined,
    message.details.model,
    duration(durationMs),
    usageDetails(usage),
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" · ")
}

function usageDetails(usage?: Usage) {
  if (!usage) return undefined
  const cost = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(usage.cost)
  return `${usage.tokens.toLocaleString()} tokens · ${usage.costComplete ? cost : `at least ${cost} (known subtotal; pricing incomplete)`}`
}

function duration(milliseconds?: number) {
  if (milliseconds === undefined) return undefined
  const total = Math.round(milliseconds / 1_000)
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`
}
