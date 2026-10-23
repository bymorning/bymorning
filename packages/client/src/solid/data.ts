import { batch, getOwner, onCleanup } from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import * as SDK from "../promise/index.js"
import type { Connection, EventSource } from "./connection.js"
import { createSync } from "./internal/sync.js"

export type WorkspaceID = SDK.WorkspaceListOutput[number]["id"]
export type SessionID = SDK.SessionInfo["id"]
export type Message = SDK.MessageListOutput["data"][number]
export type MessageID = Message["id"]
export type InboxItem = SDK.SessionInboxInfo
export type PromptInput = SDK.SessionPromptInput
export type CompactInput = SDK.SessionCompactInput
export type AdmissionError =
  | SDK.ClientError
  | SDK.InvalidRequestError
  | SDK.ServiceUnavailableError
  | SDK.ForbiddenError
  | SDK.UnauthorizedError
  | SDK.ProtocolInputError
  | SDK.ProtocolInternalError
  | SDK.SessionNotFoundError
  | SDK.SessionPromptConflictError
  | SDK.SessionCompactionConflictError
  | SDK.AgentNotFoundError
  | SDK.AgentModelUnavailableError
export interface DataInput {
  readonly api: () => SDK.ByMorningClient
  readonly workspace: WorkspaceID
  readonly event: EventSource
  readonly connection?: Pick<Connection, "state">
  readonly report?: (cause: unknown) => void
}
export type Submission =
  | {
      readonly id: MessageID
      readonly sessionID: SessionID
      readonly createdAt: Date
      readonly type: "prompt"
      readonly input: PromptInput & { readonly id: MessageID }
      readonly state:
        | { readonly state: "sending" }
        | { readonly state: "failed"; readonly error: AdmissionError }
        | { readonly state: "uncertain"; readonly error: SDK.ClientError | DOMException }
    }
  | {
      readonly id: MessageID
      readonly sessionID: SessionID
      readonly createdAt: Date
      readonly type: "compaction"
      readonly input: CompactInput & { readonly id: MessageID }
      readonly state:
        | { readonly state: "sending" }
        | { readonly state: "failed"; readonly error: AdmissionError }
        | { readonly state: "uncertain"; readonly error: SDK.ClientError | DOMException }
    }

type Page<T> = { rows: T[]; cursor: string | undefined; loading: boolean }
type Record = {
  detail?: SDK.SessionDetail
  active?: "idle" | "running"
  message: Page<Message>
  inbox?: InboxItem[]
  permission?: SDK.PermissionRequest[]
  form?: SDK.FormInfo[]
  submissions: Submission[]
  generation: number
  retained: boolean
}
type Store = {
  project: SDK.ProjectListOutput
  agent: SDK.AgentInfo[]
  model: SDK.ModelListOutput
  session: Page<SDK.SessionInfo>
  active: globalThis.Record<string, "idle" | "running">
  record: globalThis.Record<string, Record>
}
const isAdmission = (cause: unknown): cause is AdmissionError =>
  cause instanceof SDK.ClientError ||
  SDK.isInvalidRequestError(cause) ||
  SDK.isServiceUnavailableError(cause) ||
  SDK.isForbiddenError(cause) ||
  SDK.isUnauthorizedError(cause) ||
  SDK.isProtocolInputError(cause) ||
  SDK.isProtocolInternalError(cause) ||
  SDK.isSessionNotFoundError(cause) ||
  SDK.isSessionPromptConflictError(cause) ||
  SDK.isSessionCompactionConflictError(cause) ||
  SDK.isAgentNotFoundError(cause) ||
  SDK.isAgentModelUnavailableError(cause)
const cursor = (page: { readonly cursor?: string | { readonly next?: string } }) =>
  typeof page.cursor === "string" ? page.cursor : page.cursor?.next
const ordered = <T extends { readonly id: string; readonly sequence: number }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
const merge = <T extends { readonly id: string }>(current: readonly T[], incoming: readonly T[]) => [
  ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
]
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )

export interface Data {
  readonly project: {
    readonly list: () => readonly SDK.ProjectListOutput[number][]
    readonly get: (id: SDK.ProjectListOutput[number]["id"]) => SDK.ProjectListOutput[number] | undefined
    readonly sync: () => Promise<void>
    readonly invalidate: () => void
    readonly create: (input: SDK.ProjectCreateInput) => Promise<SDK.ProjectCreateOutput>
  }
  readonly agent: {
    readonly list: () => readonly SDK.AgentInfo[]
    readonly sync: () => Promise<void>
    readonly invalidate: () => void
  }
  readonly model: {
    readonly list: () => readonly SDK.ModelListOutput[number][]
    readonly sync: () => Promise<void>
    readonly invalidate: () => void
  }
  readonly session: {
    readonly list: () => readonly SDK.SessionInfo[]
    readonly get: (id: SessionID) => SDK.SessionDetail | undefined
    readonly sync: () => Promise<void>
    readonly invalidate: () => void
    readonly more: () => boolean
    readonly loading: () => boolean
    readonly load: () => Promise<void>
    readonly detail: { readonly sync: (id: SessionID) => Promise<void>; readonly invalidate: (id: SessionID) => void }
    readonly active: {
      readonly get: (id: SessionID) => "idle" | "running" | undefined
      readonly sync: () => Promise<void>
      readonly invalidate: () => void
    }
    readonly message: {
      readonly list: (id: SessionID) => readonly Message[]
      readonly get: (id: SessionID, messageID: MessageID) => Message | undefined
      readonly sync: (id: SessionID) => Promise<void>
      readonly invalidate: (id: SessionID) => void
      readonly more: (id: SessionID) => boolean
      readonly loading: (id: SessionID) => boolean
      readonly load: (id: SessionID) => Promise<void>
    }
    readonly inbox: {
      readonly list: (id: SessionID) => readonly InboxItem[]
      readonly sync: (id: SessionID) => Promise<void>
      readonly invalidate: (id: SessionID) => void
    }
    readonly permission: {
      readonly list: (id: SessionID) => readonly SDK.PermissionRequest[]
      readonly sync: (id: SessionID) => Promise<void>
      readonly invalidate: (id: SessionID) => void
      readonly reply: (input: SDK.PermissionReplyInput) => Promise<SDK.PermissionReplyOutput>
    }
    readonly form: {
      readonly list: (id: SessionID) => readonly SDK.FormInfo[]
      readonly sync: (id: SessionID) => Promise<void>
      readonly invalidate: (id: SessionID) => void
      readonly reply: (input: SDK.FormReplyInput) => Promise<SDK.FormReplyOutput>
      readonly cancel: (input: SDK.FormCancelInput) => Promise<SDK.FormCancelOutput>
    }
    readonly submission: {
      readonly list: (id: SessionID) => readonly Submission[]
      readonly dismiss: (id: SessionID, messageID: MessageID) => void
    }
    readonly create: (input: SDK.SessionCreateInput) => Promise<SDK.SessionCreateOutput>
    readonly prompt: (input: PromptInput) => Promise<SDK.SessionPromptOutput>
    readonly compact: (input: CompactInput) => Promise<SDK.SessionCompactOutput>
    readonly interrupt: (input: SDK.SessionInterruptInput) => Promise<SDK.SessionInterruptOutput>
    readonly switchAgent: (input: SDK.SessionSwitchAgentInput) => Promise<SDK.SessionSwitchAgentOutput>
    readonly switchModel: (input: SDK.SessionSwitchModelInput) => Promise<SDK.SessionSwitchModelOutput>
    readonly evict: (id: SessionID) => void
  }
  readonly dispose: () => void
}

export const createData = (input: DataInput): Data => {
  if (getOwner() === null) throw new Error("createData must run under a Solid owner")
  const report = input.report ?? console.error
  const sync = createSync()
  const controller = new AbortController()
  let disposed = false
  const [store, setStore] = createStore<Store>({
    project: [],
    agent: [],
    model: [],
    session: { rows: [], cursor: undefined, loading: false },
    active: {},
    record: {},
  })
  const blank = (): Record => ({
    message: { rows: [], cursor: undefined, loading: false },
    submissions: [],
    generation: 0,
    retained: true,
  })
  const occupancy = new Map<SessionID, { generation: number; retained: boolean }>()
  const occupy = (id: SessionID, retained: boolean, generation?: number) => {
    const next = { generation: generation ?? occupancy.get(id)?.generation ?? 0, retained }
    occupancy.set(id, next)
    return next
  }
  const materialize = (id: SessionID) => {
    const occupied = occupancy.get(id) ?? occupy(id, true, 0)
    if (store.record[id]?.message) {
      if (store.record[id]!.retained !== occupied.retained) setStore("record", id, "retained", occupied.retained)
      if (store.record[id]!.generation !== occupied.generation) setStore("record", id, "generation", occupied.generation)
      return
    }
    const next = { ...(unwrap(store.record)[id] ?? blank()), ...occupied }
    setStore("record", (rows) => ({ ...unwrap(rows), [id]: next }))
    if (!store.record[id]?.message) setStore("record", id, next)
  }
  const ensure = (id: SessionID) => {
    if (!occupancy.has(id)) occupy(id, true, 0)
    materialize(id)
    return store.record[id] ?? { ...blank(), ...occupancy.get(id)! }
  }
  const retain = (id: SessionID) => {
    const occupied = occupy(id, true)
    materialize(id)
    if (store.record[id] && !store.record[id]!.retained) setStore("record", id, "retained", true)
    return { ...(store.record[id] ?? blank()), generation: occupied.generation, retained: true as const }
  }
  const abortCause = (cause: unknown) =>
    cause instanceof SDK.ClientError && cause.cause instanceof DOMException && cause.cause.name === "AbortError"
      ? cause.cause
      : cause
  const generated = (cause: unknown) =>
    isAdmission(cause) || (typeof cause === "object" && cause !== null && "_tag" in cause)
  const mutation = <T>(request: () => Promise<T>) =>
    Promise.resolve()
      .then(request)
      .catch((cause) => {
        const original = abortCause(cause)
        if (!(original instanceof DOMException && original.name === "AbortError") && !generated(cause)) report(cause)
        throw original
      })
  const run = (key: string, load: () => Promise<void>) => {
    if (disposed) return Promise.reject(new DOMException("Data disposed", "AbortError"))
    return sync.run(key, async () => {
      if (disposed) throw new DOMException("Data disposed", "AbortError")
      try {
        await load()
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError") && !isAdmission(cause)) report(cause)
        throw cause
      }
    })
  }
  const api = () => input.api()
  const signal = { signal: controller.signal }
  const work = new Map<string, Promise<unknown>>()
  const inputs = new Map<string, { type: Submission["type"]; input: Submission["input"] }>()
  let revision = 0
  const revisions = new Map<string, Map<string, number>>()
  const touch = (key: string, id: string) => {
    let rows = revisions.get(key)
    if (!rows) revisions.set(key, (rows = new Map()))
    rows.set(id, ++revision)
  }
  const overlay = <T extends { readonly id: string }>(
    key: string,
    since: number,
    fetched: readonly T[],
    current: readonly T[],
  ) => {
    const changed = (id: string) => (revisions.get(key)?.get(id) ?? 0) > since
    return merge(
      fetched.filter((row) => !changed(row.id)),
      current.filter((row) => changed(row.id)),
    )
  }
  const deleted = new Set<SessionID>()
  const summaries = new Map<SessionID, SDK.SessionInfo>()
  const history = new Map<SessionID, Set<MessageID>>()
  const windows = new Map<SessionID, number>()
  const runtime = new Map<
    SessionID,
    {
      seen: Map<string, MessageID | undefined>
      terminal: Set<MessageID>
      started: Set<MessageID>
      steps: Set<string>
      phases: Map<string, number>
    }
  >()
  const live = (id: SessionID) => {
    let value = runtime.get(id)
    if (!value)
      runtime.set(
        id,
        (value = { seen: new Map(), terminal: new Set(), started: new Set(), steps: new Set(), phases: new Map() }),
      )
    return value
  }
  let inventoryWindow = 0
  let inventoryPages = 0
  const valid = (id: SessionID, epoch: number) => {
    const occupied = occupancy.get(id)
    return !disposed && !deleted.has(id) && !!occupied?.retained && occupied.generation === epoch
  }
  const recordRun = (kind: string, id: SessionID, load: (epoch: number) => Promise<void>) => {
    if (disposed || deleted.has(id)) return Promise.reject(new DOMException("Data unavailable", "AbortError"))
    const epoch = retain(id).generation
    return run(`${kind}:${id}`, async () => {
      retain(id)
      if (!valid(id, epoch)) throw new DOMException("Session evicted", "AbortError")
      await load(epoch)
    })
  }
  const compacting = new Map<SessionID, Promise<unknown>>()
  const messageLoads = new Map<SessionID, Promise<void>>()
  let sessionLoad: Promise<void> | undefined
  const retire = (id: SessionID, messageID: MessageID) =>
    setStore("record", id, "submissions", (rows) => rows.filter((row) => row.id !== messageID))
  const date = (value: string | Date) => (value instanceof Date ? value : new Date(value))
  // Events are wire values, whereas generated read results contain Date objects.
  // Normalize every date-bearing Message shape before it enters the shared view.
  const message = (value: unknown): Message => {
    const row = value as {
      createdAt: string | Date
      time?: { created: string | Date; streamed?: string | Date; completed?: string | Date }
      retry?: { at: string | Date }
      usage?: { costComplete?: boolean }
      content?: Array<{
        type: string
        time?: { created: string | Date; ran?: string | Date; completed?: string | Date }
      }>
    }
    return {
      ...row,
      createdAt: date(row.createdAt),
      ...(row.retry && { retry: { ...row.retry, at: date(row.retry.at) } }),
      ...(row.usage && { usage: { ...row.usage, costComplete: row.usage.costComplete ?? true } }),
      ...(row.time && { time: Object.fromEntries(Object.entries(row.time).map(([key, value]) => [key, date(value)])) }),
      ...(row.content && {
        content: row.content.map((part) =>
          part.type === "reasoning" || part.type === "tool"
            ? {
                ...part,
                ...(part.time && {
                  time: Object.fromEntries(Object.entries(part.time).map(([key, value]) => [key, date(value)])),
                }),
              }
            : part,
        ),
      }),
    } as Message
  }
  const advance = (id: SessionID) => sync.invalidate(`detail:${id}`)
  const acknowledge = (id: SessionID, messageID: MessageID) => {
    if (disposed) return
    let known = history.get(id)
    if (!known) history.set(id, (known = new Set()))
    known.add(messageID)
    if (!store.record[id] || disposed) return
    retire(id, messageID)
    touch(`inbox:${id}`, messageID)
    if (occupancy.get(id)?.retained)
      setStore("record", id, "inbox", (rows = []) => rows.filter((row) => row.id !== messageID))
    else trimHistory(id)
  }
  const trimHistory = (id: SessionID) => {
    if (occupancy.get(id)?.retained) return
    const pending = [...inputs.values()].filter((entry) => entry.input.sessionID === id)
    // A coalesced compaction's canonical ID is not known until HTTP settles.
    if (pending.some((entry) => entry.type === "compaction")) return
    const keep = new Set([
      ...pending.map((entry) => entry.input.id),
      ...(store.record[id]?.submissions.map((entry) => entry.id) ?? []),
    ])
    const rows = history.get(id)
    if (rows) for (const item of rows) if (!keep.has(item)) rows.delete(item)
    if (!rows?.size) history.delete(id)
  }
  const root = (row: SDK.SessionInfo) => !row.parentID && !row.archivedAt
  const summary = (raw: SDK.SessionInfo) => {
    const { archivedAt, ...value } = raw
    const row = {
      ...value,
      createdAt: date(raw.createdAt),
      updatedAt: date(raw.updatedAt),
      ...(archivedAt ? { archivedAt: date(archivedAt) } : {}),
    }
    if (deleted.has(row.id)) return
    summaries.set(row.id, row)
    touch("session", row.id)
    setStore("session", "rows", (rows) => (root(row) ? merge(rows, [row]) : rows.filter((item) => item.id !== row.id)))
    const detail = store.record[row.id]?.detail
    if (detail) setStore("record", row.id, "detail", reconcile({ ...row, usage: detail.usage }))
    sync.invalidate(`detail:${row.id}`)
    sync.invalidate("session")
  }
  // Event lookup metadata only; Messages remain exclusively in the reactive store.
  // Validate cached positions because pagination and window replacement can reorder rows.
  const messagePositions = new WeakMap<readonly Message[], Map<MessageID, number>>()
  const messageIndex = (id: SessionID, messageID: MessageID) => {
    const rows = store.record[id]?.message.rows
    if (!rows) return -1
    let positions = messagePositions.get(rows)
    const cached = positions?.get(messageID)
    if (cached !== undefined && rows[cached]?.id === messageID) return cached
    positions = new Map(rows.map((row, index) => [row.id, index]))
    messagePositions.set(rows, positions)
    return positions.get(messageID) ?? -1
  }
  const replaceWindow = (id: SessionID, rows: readonly Message[], next: string | undefined, loading: boolean) =>
    batch(() => {
      const current = store.record[id]!.message.rows
      const positions = new Map(current.map((row, index) => [row.id, index]))
      const retained = rows.map((row) => {
        const index = positions.get(row.id)
        if (index === undefined) return row
        // Part IDs are scoped by type, so the default recursive `id` key can collide.
        setStore("record", id, "message", "rows", index, reconcile(row, { key: null }))
        return store.record[id]!.message.rows[index]!
      })
      setStore("record", id, "message", "rows", retained)
      setStore("record", id, "message", { cursor: next, loading })
    })
  const replaceMessage = (
    id: SessionID,
    messageID: MessageID,
    update: (row: Extract<Message, { type: "assistant" }>) => Message,
  ) => {
    const index = messageIndex(id, messageID)
    const row = store.record[id]?.message.rows[index]
    if (row?.type !== "assistant") {
      sync.invalidate(`message:${id}`)
      return
    }
    touch(`message:${id}`, messageID)
    setStore("record", id, "message", "rows", index, reconcile(update(row), { key: null }))
  }
  const insertMessage = (id: SessionID, row: Message) => {
    advance(id)
    acknowledge(id, row.id)
    touch(`message:${id}`, row.id)
    const page = store.record[id]!.message
    replaceWindow(id, ordered(merge(page.rows, [row])), page.cursor, page.loading)
  }
  const observed = (id: SessionID, rows: readonly Message[], since: number) => {
    const state = live(id)
    for (const row of rows) {
      if ((revisions.get(`message:${id}`)?.get(row.id) ?? 0) > since) continue
      state.started.delete(row.id)
      if (row.type === "assistant") {
        if (row.time.completed) state.terminal.add(row.id)
        for (const part of row.content) {
          const phase =
            part.type === "tool"
              ? part.state.status === "completed" || part.state.status === "error"
                ? 4
                : part.state.status === "running"
                  ? 3
                  : 1
              : part.type === "reasoning" && part.time?.completed
                ? 2
                : 0
          if (phase) state.phases.set(`${row.id}:${part.type}:${part.id}`, phase)
        }
      } else if (row.type === "compaction" && row.status !== "running") state.terminal.add(row.id)
    }
  }
  const event = (value: SDK.WorkspaceEventItem) => {
    if (disposed) return
    if (value.type === "server.connected") {
      sync.invalidate()
      return
    }
    if (value.type === "agent.created" || value.type === "agent.updated") {
      sync.invalidate("agent")
      return
    }
    if (
      value.type === "config.updated" ||
      value.type === "plugin.added" ||
      value.type === "plugin.updated" ||
      value.type === "integration.updated" ||
      value.type === "integration.connection.updated" ||
      value.type === "mcp.status.changed"
    ) {
      sync.invalidate("model")
      return
    }
    const data = value.data as {
      sessionID?: SessionID
      item?: { id: MessageID }
      inboxID?: MessageID
      messageID?: MessageID
    }
    if (!data.sessionID) return
    if (deleted.has(data.sessionID)) {
      if (value.type === "session.input.admitted" || value.type === "session.synthetic.admitted")
        retire(data.sessionID, value.data.item.id)
      if (value.type === "session.input.promoted" || value.type === "session.synthetic.promoted")
        retire(data.sessionID, value.data.inboxID)
      if (value.type === "session.compaction.requested" && data.messageID) retire(data.sessionID, data.messageID)
      if (
        value.type === "session.compaction.started" ||
        value.type === "session.compaction.ended" ||
        value.type === "session.compaction.failed"
      )
        retire(data.sessionID, value.data.message.id)
      return
    }
    if (runtime.get(data.sessionID)?.seen.has(`${value.type}:${value.id}`)) return
    if (value.type === "session.created" || value.type === "session.updated") {
      summary(value.data.session)
      return
    }
    if (value.type === "session.deleted") {
      ensure(data.sessionID)
      session.evict(data.sessionID)
      deleted.add(data.sessionID)
      summaries.delete(data.sessionID)
      touch("session", data.sessionID)
      touch("active", data.sessionID)
      setStore("active", data.sessionID, undefined!)
      setStore("session", "rows", (rows) => rows.filter((row) => row.id !== data.sessionID))
      sync.invalidate("session")
      return
    }
    if (value.type.startsWith("session.run.")) touch("active", data.sessionID)
    if (value.type === "session.run.started") setStore("active", data.sessionID, "running")
    if (
      value.type === "session.run.succeeded" ||
      value.type === "session.run.failed" ||
      value.type === "session.run.interrupted"
    )
      setStore("active", data.sessionID, "idle")
    // A first live event establishes a projection; an explicitly evicted record
    // remains marked unretained and must not be hydrated by a late event.
    const record = store.record[data.sessionID] ?? ensure(data.sessionID)
    if (value.type === "session.input.admitted" || value.type === "session.synthetic.admitted") {
      const item = { ...value.data.item, createdAt: date(value.data.item.createdAt) } as InboxItem
      retire(data.sessionID, item.id)
      touch(`inbox:${data.sessionID}`, item.id)
      if (occupancy.get(data.sessionID)?.retained && !history.get(data.sessionID)?.has(item.id))
        setStore("record", data.sessionID, "inbox", (rows = []) => merge(rows, [item]))
      sync.invalidate(`inbox:${data.sessionID}`)
    }
    if (value.type === "session.input.promoted" || value.type === "session.synthetic.promoted")
      acknowledge(data.sessionID, value.data.inboxID)
    if (value.type === "session.compaction.requested" && data.messageID) retire(data.sessionID, data.messageID)
    if (
      value.type === "session.compaction.started" ||
      value.type === "session.compaction.ended" ||
      value.type === "session.compaction.failed"
    )
      acknowledge(data.sessionID, value.data.message.id)
    if (value.type === "session.next.agent.switched" || value.type === "session.next.model.switched") {
      const known = store.record[data.sessionID]?.detail ?? store.session.rows.find((row) => row.id === data.sessionID)
      if (known)
        summary({
          ...known,
          ...(value.type === "session.next.agent.switched" ? { agent: value.data.agent } : { model: value.data.model }),
          updatedAt: new Date(value.created),
        })
      switched(data.sessionID)
    }
    if (!occupancy.get(data.sessionID)?.retained) return
    const state = live(data.sessionID)
    const occurrence = `${value.type}:${value.id}`
    if (state.seen.has(occurrence)) return
    const change = value.data as {
      message?: { id: MessageID }
      messageID?: MessageID
      partID?: string
      callID?: string
    }
    const messageID = change.messageID ?? change.message?.id
    const settled =
      value.type === "session.execution.succeeded" ||
      value.type === "session.execution.failed" ||
      value.type === "session.execution.interrupted" ||
      value.type === "session.compaction.ended" ||
      value.type === "session.compaction.failed"
    if (messageID && state.terminal.has(messageID) && !settled) return
    state.seen.set(occurrence, messageID)
    if (
      value.type === "session.execution.started" &&
      !record.message.rows.some((row) => row.id === value.data.message.id)
    )
      state.started.add(value.data.message.id)
    if (
      value.type === "session.execution.succeeded" ||
      value.type === "session.execution.failed" ||
      value.type === "session.execution.interrupted" ||
      value.type === "session.compaction.ended" ||
      value.type === "session.compaction.failed"
    ) {
      state.terminal.add(value.data.message.id)
      state.started.delete(value.data.message.id)
      for (const key of state.phases.keys()) if (key.startsWith(`${value.data.message.id}:`)) state.phases.delete(key)
      for (const key of state.steps) if (key.startsWith(`${value.data.message.id}:`)) state.steps.delete(key)
      for (const [key, id] of state.seen) if (id === value.data.message.id) state.seen.delete(key)
      state.seen.set(occurrence, messageID)
    }
    const kind = change.callID ? "tool" : value.type.startsWith("session.reasoning.") ? "reasoning" : "text"
    const partID = change.callID ?? change.partID
    if (messageID && partID) {
      const key = `${messageID}:${kind}:${partID}`
      const phase =
        value.type.endsWith("success") || value.type.endsWith("failed")
          ? 4
          : value.type.endsWith("called") || value.type.endsWith("progress")
            ? 3
            : value.type.endsWith("ended")
              ? 2
              : 1
      const previous = state.phases.get(key) ?? 0
      if (phase < previous || previous === 4 || (previous === 2 && kind !== "tool")) return
      state.phases.set(key, phase)
    }
    // Token notifications touch only their part; preserve the surrounding store paths.
    if (
      value.type === "session.text.delta" ||
      value.type === "session.reasoning.delta" ||
      value.type === "session.tool.input.delta"
    ) {
      const index = messageIndex(data.sessionID, value.data.messageID)
      const row = record.message.rows[index]
      if (row?.type === "assistant") {
        const partIndex = row.content.findIndex((part) => part.id === partID && part.type === kind)
        const part = row.content[partIndex]
        if (part) {
          touch(`message:${data.sessionID}`, row.id)
          setStore(
            "record",
            data.sessionID,
            "message",
            "rows",
            index,
            produce((draft) => {
              if (draft.type !== "assistant") return
              const target = draft.content[partIndex]!
              if (target.type === "text" || target.type === "reasoning") target.text += value.data.text
              else if (target.state.status === "streaming") target.state.input += value.data.text
            }),
          )
          return
        }
        if (kind === "tool") {
          sync.invalidate(`message:${data.sessionID}`)
          return
        }
      }
    }
    if (value.type === "session.execution.model.routed") {
      const { model, requestedModel, route } = value.data
      const same =
        model.id === requestedModel.id &&
        model.provider === requestedModel.provider &&
        (model.variant ?? "default") === (requestedModel.variant ?? "default")
      replaceMessage(data.sessionID, value.data.messageID, (row) => {
        const { requestedModel: _requested, retry: _retry, route: _route, ...current } = row
        return { ...current, model, ...(same ? {} : { requestedModel }), ...(route === undefined ? {} : { route }) }
      })
    }
    if (value.type === "session.execution.streamed")
      replaceMessage(data.sessionID, value.data.messageID, (row) => ({
        ...row,
        time: { ...row.time, streamed: new Date(value.created) },
      }))
    if (value.type === "session.retry.scheduled")
      replaceMessage(data.sessionID, value.data.messageID, (row) => ({
        ...row,
        retry: { attempt: value.data.attempt, at: new Date(value.data.at), error: value.data.error },
      }))
    if (value.type === "session.step.ended") {
      const key = `${value.data.messageID}:${value.data.index}`
      if (state.started.has(value.data.messageID) && !state.steps.has(key)) {
        state.steps.add(key)
        replaceMessage(data.sessionID, value.data.messageID, (row) => {
          const b = value.data.usage
          const a: NonNullable<typeof row.usage> = row.usage ?? {
            cost: 0,
            costComplete: true,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
          return {
            ...row,
            usage: {
              cost: a.cost + b.cost,
              costComplete: (a.costComplete ?? true) && (b.costComplete ?? true),
              tokens: {
                input: a.tokens.input + b.tokens.input,
                output: a.tokens.output + b.tokens.output,
                reasoning: a.tokens.reasoning + b.tokens.reasoning,
                ...((a.tokens.total !== undefined || b.tokens.total !== undefined) && {
                  total: (a.tokens.total ?? 0) + (b.tokens.total ?? 0),
                }),
                cache: {
                  read: a.tokens.cache.read + b.tokens.cache.read,
                  write: a.tokens.cache.write + b.tokens.cache.write,
                },
              },
            },
          }
        })
      } else sync.invalidate(`message:${data.sessionID}`)
    }
    if (value.type === "session.input.promoted" || value.type === "session.synthetic.promoted") {
      retire(data.sessionID, value.data.inboxID)
      setStore("record", data.sessionID, "inbox", (rows = []) => rows.filter((row) => row.id !== value.data.inboxID))
      insertMessage(data.sessionID, message(value.data.message))
      sync.invalidate(`message:${data.sessionID}`)
      sync.invalidate(`inbox:${data.sessionID}`)
    }
    if (value.type === "session.compaction.requested" && data.messageID) retire(data.sessionID, data.messageID)
    if (value.type === "session.execution.started") {
      if (!record.message.rows.some((row) => row.id === value.data.message.id))
        insertMessage(data.sessionID, message(value.data.message))
      else sync.invalidate(`message:${data.sessionID}`)
    }
    if (
      value.type === "session.execution.succeeded" ||
      value.type === "session.execution.failed" ||
      value.type === "session.execution.interrupted"
    ) {
      insertMessage(data.sessionID, message({ ...value.data.message, retry: undefined }))
      sync.invalidate("session")
    }
    if (
      value.type === "session.text.started" ||
      value.type === "session.reasoning.started" ||
      value.type === "session.tool.input.started"
    ) {
      const change: any = value.data
      const part =
        value.type === "session.text.started"
          ? { type: "text", id: change.partID, text: "" }
          : value.type === "session.reasoning.started"
            ? { type: "reasoning", id: change.partID, text: "", time: { created: new Date(value.created) } }
            : {
                type: "tool",
                id: change.callID,
                name: change.name,
                state: { status: "streaming", input: "" },
                time: { created: new Date(value.created) },
                providerExecuted: change.providerExecuted,
                providerMetadata: change.providerMetadata,
              }
      replaceMessage(data.sessionID, change.messageID, (row) => ({
        ...row,
        content: row.content.some((item) => item.id === part.id && item.type === part.type)
          ? row.content
          : [...row.content.slice(0, change.ordinal), part as never, ...row.content.slice(change.ordinal)],
      }))
    }
    if (
      value.type === "session.text.delta" ||
      value.type === "session.text.ended" ||
      value.type === "session.reasoning.delta" ||
      value.type === "session.reasoning.ended"
    ) {
      const change = value.data
      const kind = value.type.startsWith("session.text") ? "text" : "reasoning"
      replaceMessage(data.sessionID, change.messageID, (row) => ({
        ...row,
        content: (row.content.some((part) => part.id === change.partID && part.type === kind)
          ? row.content
          : [
              ...row.content,
              {
                type: kind,
                id: change.partID,
                text: "",
                ...(kind === "reasoning" && { time: { created: new Date(value.created) } }),
              } satisfies Extract<Message, { type: "assistant" }>["content"][number],
            ]
        ).map((part) =>
          part.id !== change.partID || part.type !== kind
            ? part
            : {
                ...part,
                text: value.type.endsWith("delta") ? part.text + change.text : change.text,
                ...(kind === "reasoning" &&
                  value.type.endsWith("ended") && {
                    time: {
                      created: new Date(value.created),
                      ...("time" in part ? part.time : {}),
                      completed: new Date(value.created),
                    },
                  }),
                ...(value.type.endsWith("ended") &&
                  "providerMetadata" in change && { providerMetadata: change.providerMetadata }),
              },
        ),
      }))
    }
    if (
      value.type === "session.tool.input.delta" ||
      value.type === "session.tool.input.ended" ||
      value.type === "session.tool.called" ||
      value.type === "session.tool.progress" ||
      value.type === "session.tool.success" ||
      value.type === "session.tool.failed"
    ) {
      const change: any = value.data
      replaceMessage(data.sessionID, change.messageID, (row) => {
        const parts =
          row.content.some((part) => part.id === change.callID && part.type === "tool") ||
          value.type.endsWith("delta") ||
          value.type.endsWith("progress")
            ? row.content
            : [
                ...row.content,
                {
                  type: "tool" as const,
                  id: change.callID,
                  name: change.name,
                  state: { status: "streaming" as const, input: "" },
                  time: { created: new Date(value.created) },
                },
              ]
        const content = parts.map((original) => {
          if (original.id !== change.callID || original.type !== "tool") return original
          const part = {
            ...original,
            ...(change.providerExecuted !== undefined && { providerExecuted: change.providerExecuted }),
            ...(change.providerMetadata !== undefined && { providerMetadata: change.providerMetadata }),
          }
          if (part.id !== change.callID || part.type !== "tool") return part
          if (value.type === "session.tool.input.delta")
            return {
              ...part,
              state: {
                status: "streaming",
                input: typeof part.state.input === "string" ? part.state.input + change.text : change.text,
              },
            } as never
          if (value.type === "session.tool.input.ended")
            return {
              ...part,
              name: change.name,
              state: { status: "streaming", input: change.input },
              ...(change.providerMetadata && { providerMetadata: change.providerMetadata }),
            } as never
          if (value.type === "session.tool.called")
            return {
              ...part,
              name: change.name,
              state: { status: "running", input: change.input },
              time: { ...part.time, ran: new Date(value.created) },
              ...(change.providerMetadata && { providerMetadata: change.providerMetadata }),
            } as never
          if (value.type === "session.tool.progress")
            return {
              ...part,
              state: { ...part.state, ...(part.state.status === "running" && { metadata: change.metadata }) },
            } as never
          if (value.type === "session.tool.success")
            return {
              ...part,
              name: change.name,
              time: { ...part.time, completed: new Date(value.created) },
              state: {
                status: "completed",
                input: change.input,
                content: change.content,
                ...(change.result !== undefined && { result: change.result }),
                ...(change.metadata && { metadata: change.metadata }),
              },
              ...(change.providerMetadata && { providerMetadata: change.providerMetadata }),
            } as never
          return {
            ...part,
            name: change.name,
            time: { ...part.time, completed: new Date(value.created) },
            state: {
              status: "error",
              input: change.input,
              error: change.error,
              ...(change.metadata && { metadata: change.metadata }),
            },
            ...(change.providerMetadata && { providerMetadata: change.providerMetadata }),
          } as never
        })
        return { ...row, content }
      })
    }
    if (
      value.type === "session.compaction.started" ||
      value.type === "session.compaction.ended" ||
      value.type === "session.compaction.failed"
    ) {
      if (
        value.type !== "session.compaction.started" ||
        !record.message.rows.some((row) => row.id === value.data.message.id)
      )
        insertMessage(data.sessionID, message(value.data.message))
      else sync.invalidate(`message:${data.sessionID}`)
      sync.invalidate("session")
    }
    if (value.type === "session.compaction.delta") {
      advance(data.sessionID)
      touch(`message:${data.sessionID}`, value.data.messageID)
      const index = messageIndex(data.sessionID, value.data.messageID)
      const row = record.message.rows[index]
      if (row?.type === "compaction" && row.status === "running")
        setStore(
          "record",
          data.sessionID,
          "message",
          "rows",
          index,
          reconcile({ ...row, summary: row.summary + value.data.text }),
        )
    }
    if (value.type === "session.next.agent.switched" || value.type === "session.next.model.switched") {
      insertMessage(data.sessionID, message(value.data.message))
    }
    if (value.type === "session.instruction.updated") {
      if (value.data.system) insertMessage(data.sessionID, message(value.data.system))
      else advance(data.sessionID)
    }
    if (
      value.type === "session.step.started" ||
      value.type === "session.step.ended" ||
      value.type === "session.step.failed" ||
      value.type === "session.policy.enforced"
    )
      advance(data.sessionID)
    if (value.type === "permission.v2.asked") {
      touch(`permission:${data.sessionID}`, value.data.id)
      setStore("record", data.sessionID, "permission", (rows = []) => merge(rows, [value.data]))
      sync.invalidate(`permission:${data.sessionID}`)
    }
    if (value.type === "permission.v2.replied") {
      touch(`permission:${data.sessionID}`, value.data.requestID)
      setStore("record", data.sessionID, "permission", (rows = []) =>
        rows.filter((row) => row.id !== value.data.requestID),
      )
      sync.invalidate(`permission:${data.sessionID}`)
    }
    if (value.type === "form.created") {
      touch(`form:${data.sessionID}`, value.data.id)
      setStore("record", data.sessionID, "form", (rows = []) => merge(rows, [value.data]))
      sync.invalidate(`form:${data.sessionID}`)
    }
    if (value.type === "form.replied" || value.type === "form.cancelled") {
      touch(`form:${data.sessionID}`, value.data.id)
      setStore("record", data.sessionID, "form", (rows = []) => rows.filter((row) => row.id !== value.data.id))
      sync.invalidate(`form:${data.sessionID}`)
    }
  }
  const off = input.event.listen((value) => batch(() => event(value)))
  const detailSync = (id: SessionID) =>
    recordRun("detail", id, async (epoch) => {
      const since = revision
      try {
        const value = await api().session.get({ sessionID: id }, signal)
        if (!valid(id, epoch)) return
        const current = summaries.get(id) ?? store.record[id]?.detail ?? store.session.rows.find((row) => row.id === id)
        const newer = (revisions.get("session")?.get(id) ?? 0) > since
        setStore("record", id, "detail", reconcile(newer && current ? { ...current, usage: value.usage } : value))
      } catch (cause) {
        if (SDK.isSessionNotFoundError(cause) && valid(id, epoch)) {
          session.evict(id)
          deleted.add(id)
          touch("session", id)
          touch("active", id)
          setStore("session", "rows", (rows) => rows.filter((row) => row.id !== id))
          setStore("active", id, undefined!)
        }
        throw cause
      }
    })
  const messageSync = (id: SessionID) =>
    recordRun("message", id, async (epoch) => {
      const since = revision
      const before = [...store.record[id]!.message.rows]
      const page = await api().message.list({ sessionID: id, limit: 50, order: "desc" }, signal)
      if (disposed) return
      for (const row of page.data) acknowledge(id, row.id)
      if (!valid(id, epoch)) return
      const record = store.record[id]!
      const newest = ordered(page.data.map(message))
      observed(id, newest, since)
      const overlap = before.some((row) => newest.some((item) => item.id === row.id))
      const joined = windows.has(id) && cursor(page) !== undefined && overlap
      const baseline = joined
        ? merge(
            record.message.rows.filter((row) => row.sequence < newest[0]!.sequence),
            newest,
          )
        : newest
      const rows = overlay(`message:${id}`, since, baseline, record.message.rows)
      const next = joined ? record.message.cursor : cursor(page)
      sync.invalidate(`message:load:${id}:${epoch}:${windows.get(id)}`)
      windows.set(id, (windows.get(id) ?? 0) + 1)
      messageLoads.delete(id)
      replaceWindow(id, ordered(rows), next, false)
    })
  const inboxSync = (id: SessionID) =>
    recordRun("inbox", id, async (epoch) => {
      const since = revision
      const value = await api().session.inbox.list({ sessionID: id }, signal)
      if (valid(id, epoch)) {
        setStore(
          "record",
          id,
          "inbox",
          reconcile(
            overlay(
              `inbox:${id}`,
              since,
              value.filter((row) => !history.get(id)?.has(row.id)),
              store.record[id]!.inbox ?? [],
            ),
          ),
        )
        for (const item of value) retire(id, item.id)
      }
    })
  const permissionSync = (id: SessionID) =>
    recordRun("permission", id, async (epoch) => {
      const since = revision
      const value = await api().permission.list({ sessionID: id }, signal)
      if (valid(id, epoch))
        setStore(
          "record",
          id,
          "permission",
          reconcile(overlay(`permission:${id}`, since, value, store.record[id]!.permission ?? [])),
        )
    })
  const formSync = (id: SessionID) =>
    recordRun("form", id, async (epoch) => {
      const since = revision
      const value = await api().form.list({ sessionID: id }, signal)
      if (valid(id, epoch))
        setStore("record", id, "form", reconcile(overlay(`form:${id}`, since, value, store.record[id]!.form ?? [])))
    })
  const data: Data = {
    project: {
      list: () => store.project,
      get: (id) => store.project.find((row) => row.id === id),
      sync: () =>
        run("project", async () => {
          const rows = await api().project.list({ workspace: input.workspace }, signal)
          if (!disposed) setStore("project", reconcile(rows))
        }),
      invalidate: () => sync.invalidate("project"),
      create: async (value) => {
        const output = await mutation(() => api().project.create(value, signal))
        sync.invalidate("project")
        if (!disposed) setStore("project", (rows) => merge(rows, [output]))
        return output
      },
    },
    agent: {
      list: () => store.agent,
      sync: () =>
        run("agent", async () => {
          const rows = await api().agent.list({ workspace: input.workspace }, signal)
          if (!disposed) setStore("agent", reconcile(rows))
        }),
      invalidate: () => sync.invalidate("agent"),
    },
    model: {
      list: () => store.model,
      sync: () =>
        run("model", async () => {
          const rows = await api().model.list({ workspace: input.workspace }, signal)
          if (!disposed) setStore("model", reconcile(rows))
        }),
      invalidate: () => sync.invalidate("model"),
    },
    session: {} as Data["session"],
    dispose: () => {
      if (disposed) return
      disposed = true
      controller.abort()
      off()
      occupancy.clear()
      revisions.clear()
      history.clear()
      windows.clear()
      runtime.clear()
      summaries.clear()
      inputs.clear()
      work.clear()
      messageLoads.clear()
      sync.invalidate()
      setStore(
        reconcile({
          project: [],
          agent: [],
          model: [],
          session: { rows: [], cursor: undefined, loading: false },
          active: {},
          record: {},
        }),
      )
    },
  }
  const session = data.session
  Object.assign(session, {
    list: () => store.session.rows,
    get: (id: SessionID) => store.record[id]?.detail,
    sync: () =>
      run("session", async () => {
        const window = ++inventoryWindow
        sessionLoad = undefined
        setStore("session", "loading", false)
        const since = revision
        const complete = inventoryPages > 0 && store.session.cursor === undefined
        const depth = Math.max(1, inventoryPages)
        let next: string | undefined
        let rows: SDK.SessionInfo[] = []
        let pages = 0
        do {
          const page = await api()
            .session.list(
              { workspace: input.workspace, limit: 50, parentID: null, archived: false, ...(next && { cursor: next }) },
              signal,
            )
            .catch((cause) => {
              if (!disposed && window === inventoryWindow && SDK.isSessionInvalidCursorError(cause)) {
                inventoryWindow++
                setStore("session", { cursor: undefined, loading: false })
                sync.invalidate("session")
              }
              throw cause
            })
          if (disposed || window !== inventoryWindow) return
          rows = merge(rows, page.data.filter(root))
          next = cursor(page)
          pages++
        } while (next && (complete || pages < depth))
        if (!disposed) {
          inventoryWindow++
          sessionLoad = undefined
          inventoryPages = pages
          setStore(
            "session",
            reconcile({
              ...store.session,
              rows: overlay(
                "session",
                since,
                rows.filter((row) => !deleted.has(row.id)),
                store.session.rows,
              ),
              cursor: next,
              loading: false,
            }),
          )
        }
      }),
    invalidate: () => sync.invalidate("session"),
    more: () => store.session.cursor !== undefined,
    loading: () => store.session.loading,
    load: () => {
      if (sessionLoad) return sessionLoad
      const current = store.session.cursor
      if (!current) return Promise.resolve()
      const window = inventoryWindow
      const since = revision
      sync.invalidate("session:load")
      const pending = run("session:load", async () => {
        if (disposed || window !== inventoryWindow) return
        setStore("session", "loading", true)
        try {
          const page = await api().session.list(
            { workspace: input.workspace, limit: 50, parentID: null, archived: false, cursor: current },
            signal,
          )
          if (!disposed && window === inventoryWindow) {
            inventoryPages++
            setStore(
              "session",
              reconcile({
                ...store.session,
                rows: overlay(
                  "session",
                  since,
                  merge(
                    store.session.rows,
                    page.data.filter((row) => root(row) && !deleted.has(row.id)),
                  ),
                  store.session.rows,
                ),
                cursor: cursor(page),
                loading: false,
              }),
            )
          }
        } catch (cause) {
          if (!disposed && window === inventoryWindow && SDK.isSessionInvalidCursorError(cause)) {
            setStore("session", "cursor", undefined)
            sync.invalidate("session")
          }
          throw cause
        } finally {
          if (!disposed && window === inventoryWindow) setStore("session", "loading", false)
        }
      })
      sessionLoad = pending
      void pending
        .finally(() => {
          if (sessionLoad === pending) sessionLoad = undefined
        })
        .catch(() => undefined)
      return pending
    },
    detail: { sync: detailSync, invalidate: (id: SessionID) => sync.invalidate(`detail:${id}`) },
    active: {
      get: (id: SessionID) => store.active[id],
      sync: () =>
        run("active", async () => {
          const since = revision
          const active = await api().session.active({ workspace: input.workspace }, signal)
          if (!disposed) {
            const rows = Object.fromEntries(
              Object.keys(active)
                .filter((id) => !deleted.has(id as SessionID))
                .map((id) => [id, active[id] ? ("running" as const) : ("idle" as const)]),
            )
            for (const [id, changed] of revisions.get("active") ?? [])
              if (changed > since) {
                if (store.active[id]) rows[id] = store.active[id]!
                else delete rows[id]
              }
            setStore("active", reconcile(rows))
          }
        }),
      invalidate: () => sync.invalidate("active"),
    },
    message: {
      list: (id: SessionID) => store.record[id]?.message.rows ?? [],
      get: (id: SessionID, messageID: MessageID) => store.record[id]?.message.rows.find((row) => row.id === messageID),
      sync: messageSync,
      invalidate: (id: SessionID) => sync.invalidate(`message:${id}`),
      more: (id: SessionID) => store.record[id]?.message.cursor !== undefined,
      loading: (id: SessionID) => store.record[id]?.message.loading ?? false,
      load: (id: SessionID) => {
        const active = messageLoads.get(id)
        if (active) return active
        const record = store.record[id]
        const current = record?.message.cursor
        if (!current) return Promise.resolve()
        const generation = record.generation
        const window = windows.get(id)
        const since = revision
        const owns = () => valid(id, generation) && windows.get(id) === window
        const key = `message:load:${id}:${generation}:${window}`
        sync.invalidate(key)
        const pending = run(key, async () => {
          if (!owns()) return
          setStore("record", id, "message", "loading", true)
          try {
            const page = await api().message.list({ sessionID: id, limit: 50, order: "desc", cursor: current }, signal)
            if (!disposed) for (const row of page.data) acknowledge(id, row.id)
            if (owns()) {
              observed(id, page.data, since)
              const fresh = store.record[id]!
              replaceWindow(
                id,
                ordered(
                  overlay(
                    `message:${id}`,
                    since,
                    merge(fresh.message.rows, page.data.map(message)),
                    fresh.message.rows,
                  ),
                ),
                cursor(page),
                false,
              )
            }
          } catch (cause) {
            if (SDK.isSessionInvalidCursorError(cause) && owns()) {
              setStore("record", id, "message", "cursor", undefined)
              sync.invalidate(`message:${id}`)
            }
            throw cause
          } finally {
            if (owns()) setStore("record", id, "message", "loading", false)
          }
        })
        messageLoads.set(id, pending)
        void pending
          .finally(() => {
            if (messageLoads.get(id) === pending) messageLoads.delete(id)
          })
          .catch(() => undefined)
        return pending
      },
    },
    inbox: {
      list: (id: SessionID) => store.record[id]?.inbox ?? [],
      sync: inboxSync,
      invalidate: (id: SessionID) => sync.invalidate(`inbox:${id}`),
    },
    permission: {
      list: (id: SessionID) => store.record[id]?.permission ?? [],
      sync: permissionSync,
      invalidate: (id: SessionID) => sync.invalidate(`permission:${id}`),
      reply: async (value: SDK.PermissionReplyInput) => {
        const epoch = store.record[value.sessionID]?.generation
        try {
          const output = await mutation(() => api().permission.reply(value, signal))
          if (epoch !== undefined && valid(value.sessionID, epoch)) {
            touch(`permission:${value.sessionID}`, value.requestID)
            setStore("record", value.sessionID, "permission", (rows = []) =>
              rows.filter((row) => row.id !== value.requestID),
            )
          }
          return output
        } catch (cause) {
          sync.invalidate(`permission:${value.sessionID}`)
          throw cause
        } finally {
          sync.invalidate(`permission:${value.sessionID}`)
        }
      },
    },
    form: {
      list: (id: SessionID) => store.record[id]?.form ?? [],
      sync: formSync,
      invalidate: (id: SessionID) => sync.invalidate(`form:${id}`),
      reply: async (value: SDK.FormReplyInput) => {
        const epoch = store.record[value.sessionID]?.generation
        try {
          const output = await mutation(() => api().form.reply(value, signal))
          if (epoch !== undefined && valid(value.sessionID, epoch)) {
            touch(`form:${value.sessionID}`, value.formID)
            setStore("record", value.sessionID, "form", (rows = []) => rows.filter((row) => row.id !== value.formID))
          }
          return output
        } finally {
          sync.invalidate(`form:${value.sessionID}`)
        }
      },
      cancel: async (value: SDK.FormCancelInput) => {
        const epoch = store.record[value.sessionID]?.generation
        try {
          const output = await mutation(() => api().form.cancel(value, signal))
          if (epoch !== undefined && valid(value.sessionID, epoch)) {
            touch(`form:${value.sessionID}`, value.formID)
            setStore("record", value.sessionID, "form", (rows = []) => rows.filter((row) => row.id !== value.formID))
          }
          return output
        } finally {
          sync.invalidate(`form:${value.sessionID}`)
        }
      },
    },
    submission: {
      list: (id: SessionID) => store.record[id]?.submissions ?? [],
      dismiss: (id: SessionID, messageID: MessageID) =>
        setStore("record", id, "submissions", (rows = []) =>
          rows.filter((row) => row.id !== messageID || row.state.state === "sending"),
        ),
    },
    create: async (value: SDK.SessionCreateInput) => {
      const output = await mutation(() => api().session.create(value, signal))
      if (!disposed) summary(output)
      sync.invalidate("session")
      return output
    },
    prompt: (value: PromptInput) =>
      admission("prompt", value, (request) => api().session.prompt(request as PromptInput, signal)),
    compact: (value: CompactInput) => {
      if (value.id === undefined) {
        const active = compacting.get(value.sessionID) as Promise<SDK.SessionCompactOutput> | undefined
        if (active) return active
      }
      const pending = admission("compaction", value, (request) =>
        api().session.compact(request as CompactInput, signal),
      )
      if (value.id === undefined) {
        compacting.set(value.sessionID, pending)
        void pending
          .finally(() => {
            if (compacting.get(value.sessionID) === pending) compacting.delete(value.sessionID)
          })
          .catch(() => undefined)
      }
      return pending
    },
    interrupt: (value: SDK.SessionInterruptInput) => mutation(() => api().session.interrupt(value, signal)),
    switchAgent: (value: SDK.SessionSwitchAgentInput) =>
      mutation(() => api().session.switchAgent(value, signal)).then((output) => {
        switched(value.sessionID)
        return output
      }),
    switchModel: (value: SDK.SessionSwitchModelInput) =>
      mutation(() => api().session.switchModel(value, signal)).then((output) => {
        switched(value.sessionID)
        return output
      }),
    evict: (id: SessionID) => {
      const record = store.record[id]
      const occupied = occupancy.get(id)
      if (!record && !occupied) return
      if (occupied && !occupied.retained && bare(record) && !tracked(id)) return
      const generation = (occupied?.generation ?? record?.generation ?? 0) + 1
      occupy(id, false, generation)
      sync.invalidate(`message:load:${id}:${record?.generation}:${windows.get(id)}`)
      messageLoads.delete(id)
      windows.delete(id)
      runtime.delete(id)
      for (const kind of ["message", "inbox", "permission", "form"]) revisions.delete(`${kind}:${id}`)
      sync.forget(`detail:${id}`)
      sync.forget(`message:${id}`)
      sync.forget(`inbox:${id}`)
      sync.forget(`permission:${id}`)
      sync.forget(`form:${id}`)
      setStore(
        "record",
        id,
        reconcile({
          message: { rows: [], cursor: undefined, loading: false },
          submissions: record?.submissions ?? [],
          generation,
          retained: false,
        }),
      )
      trimHistory(id)
    },
  })
  // An evicted Session that keeps receiving live events has nothing left to drop;
  // repeating the full eviction would only churn the store and its generation.
  const bare = (record: Record | undefined) =>
    !record ||
    (!record.retained &&
      record.message.rows.length === 0 &&
      record.message.cursor === undefined &&
      !record.message.loading &&
      !record.detail &&
      !record.inbox &&
      !record.permission &&
      !record.form)
  const tracked = (id: SessionID) =>
    windows.has(id) ||
    messageLoads.has(id) ||
    runtime.has(id) ||
    ["message", "inbox", "permission", "form"].some((kind) => revisions.has(`${kind}:${id}`))
  const switched = (id: SessionID) => {
    sync.invalidate("session")
    sync.invalidate(`detail:${id}`)
    sync.invalidate(`message:${id}`)
  }
  const admission = <T extends SDK.SessionPromptOutput>(
    type: Submission["type"],
    value: PromptInput | CompactInput,
    request: (input: PromptInput | CompactInput) => Promise<T>,
  ): Promise<T> => {
    if (disposed) return Promise.reject(new DOMException("Data disposed", "AbortError"))
    const id = (value.id ?? crypto.randomUUID()) as MessageID
    const sessionID = value.sessionID
    ensure(sessionID)
    const entry = store.record[sessionID]?.submissions.find((row) => row.id === id)
    const input = structuredClone(unwrap({ ...value, id })) as Submission["input"]
    const prior = inputs.get(`${sessionID}:${id}`) ?? entry
    if (prior && (prior.type !== type || canonical(prior.input) !== canonical(input))) {
      const conflict =
        type === "prompt"
          ? {
              _tag: "Session.PromptConflictError" as const,
              sessionID,
              messageID: id,
              message: "A different prompt already uses this message ID",
            }
          : {
              _tag: "Session.CompactionConflictError" as const,
              sessionID,
              messageID: id,
              message: "A different compaction already uses this message ID",
            }
      return Promise.reject(conflict)
    }
    const existing = work.get(`${sessionID}:${id}`) as Promise<T> | undefined
    if (existing) return existing
    inputs.set(`${sessionID}:${id}`, { type, input })
    const epoch = store.record[sessionID]!.generation
    if (entry)
      setStore("record", sessionID, "submissions", (rows) =>
        rows.map((row) => (row.id === id ? { ...row, state: { state: "sending" } } : row)),
      )
    if (!entry)
      setStore("record", sessionID, "submissions", (rows) => [
        ...rows,
        { id, sessionID, createdAt: new Date(), type, input, state: { state: "sending" } } as Submission,
      ])
    const promise = Promise.resolve()
      .then(() => request(input))
      .then(
        (output) => {
          batch(() => {
            if (!disposed && store.record[sessionID]) {
              retire(sessionID, id)
              retire(sessionID, output.id)
              if (valid(sessionID, epoch) && !history.get(sessionID)?.has(output.id)) {
                const item: InboxItem = {
                  id: output.id,
                  sessionID,
                  admittedSequence: output.admittedSequence,
                  createdAt: date(output.createdAt),
                  delivery: output.delivery ?? (type === "prompt" ? "steer" : "queue"),
                  ...(type === "prompt"
                    ? {
                        type: "user" as const,
                        payload: {
                          text: output.text,
                          ...(output.agents === undefined ? {} : { agents: output.agents }),
                          ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
                        },
                      }
                    : { type: "compaction" as const, payload: {} }),
                }
                touch(`inbox:${sessionID}`, output.id)
                setStore("record", sessionID, "inbox", (rows = []) => merge(rows, [item]))
                sync.invalidate(`inbox:${sessionID}`)
              }
            }
          })
          return output
        },
        (cause) => {
          const abort =
            cause instanceof SDK.ClientError && cause.cause instanceof DOMException && cause.cause.name === "AbortError"
              ? cause.cause
              : cause
          if (disposed) throw abort
          if (!store.record[sessionID]) throw abort
          const transport = cause instanceof SDK.ClientError && cause.reason === "Transport"
          if (isAdmission(cause) && !transport)
            setStore("record", sessionID, "submissions", (rows) =>
              rows.map((row) =>
                row.id === id ? ({ ...row, state: { state: "failed", error: cause } } as Submission) : row,
              ),
            )
          else {
            const error =
              abort instanceof DOMException
                ? abort
                : new SDK.ClientError("Transport", { cause: cause instanceof Error ? cause : undefined })
            setStore("record", sessionID, "submissions", (rows) =>
              rows.map((row) =>
                row.id === id ? ({ ...row, state: { state: "uncertain", error } } as Submission) : row,
              ),
            )
            if (!(abort instanceof DOMException)) report(cause)
          }
          throw abort
        },
      )
    work.set(`${sessionID}:${id}`, promise)
    void promise
      .finally(() => {
        work.delete(`${sessionID}:${id}`)
        inputs.delete(`${sessionID}:${id}`)
        trimHistory(sessionID)
      })
      .catch(() => undefined)
    return promise
  }
  onCleanup(data.dispose)
  return data
}
