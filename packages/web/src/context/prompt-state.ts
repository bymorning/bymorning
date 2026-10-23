import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import type { Prompt } from "@bymorning/schema/prompt"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { Option, Schema } from "effect"
import { batch, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"

import {
  Persist,
  persisted,
  removePersisted,
  safePersistedStorage,
  type PersistedStorage as DraftStorage,
} from "../runtime/persistence/storage"

export type PromptModel = {
  readonly provider: Provider.Name
  readonly id: string
  readonly variant?: string | null
}

export type PromptSelection = {
  readonly agent?: Agent.ID
  readonly model?: PromptModel
}

export type PromptDocument = PromptSelection & {
  readonly text: string
  readonly cursor?: number
  readonly agents: ReadonlyArray<Prompt.AgentAttachment>
}

/** Draft fields that may be restored without changing request selection identity. */
export type PromptContent = {
  readonly text: string
  readonly cursor: number | undefined
  readonly agents: ReadonlyArray<Prompt.AgentAttachment>
}

type PromptStore = {
  text: string
  cursor?: number
  agents: Array<Prompt.AgentAttachment>
  agent?: Agent.ID
  model?: PromptModel
}

export type InitialPrompt = Partial<PromptDocument>

export type DraftPromptScope = { readonly draftID: string }
export type SessionPromptScope = {
  readonly workspaceID: Workspace.ID
  readonly projectID: Project.ID
  readonly sessionID: Session.ID
}
export type PromptScope = DraftPromptScope | SessionPromptScope

export type PromptReady = Accessor<boolean> & { readonly promise: Promise<true> }

export interface PromptTarget {
  readonly ready: PromptReady
  readonly current: Accessor<string>
  readonly cursor: Accessor<number | undefined>
  readonly revision: Accessor<object>
  /** Revision identity for text, cursor, and structured Agent mentions only. */
  readonly contentRevision: Accessor<object>
  readonly agents: {
    readonly current: Accessor<ReadonlyArray<Prompt.AgentAttachment>>
    readonly set: (agents: ReadonlyArray<Prompt.AgentAttachment>) => void
  }
  readonly agent: {
    readonly current: Accessor<Agent.ID | undefined>
    readonly set: (agent: Agent.ID | undefined) => void
  }
  readonly model: {
    readonly current: Accessor<PromptModel | undefined>
    readonly set: (model: PromptModel | undefined) => void
  }
  readonly selection: {
    readonly current: Accessor<PromptSelection>
    readonly set: (selection: PromptSelection) => void
  }
  readonly set: (text: string, cursorPosition?: number, agents?: ReadonlyArray<Prompt.AgentAttachment>) => void
  /** Replace restorable draft content without mutating Agent or Model selection. */
  readonly restoreContent: (content: PromptContent) => void
  readonly reset: () => void
}

export interface DraftPromptTarget extends PromptTarget {
  readonly scope: DraftPromptScope
}

export interface SessionPromptTarget extends PromptTarget {
  readonly scope: SessionPromptScope
}

const Cursor = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PromptModelSchema = Schema.Struct({
  provider: Provider.Name,
  id: Schema.String,
  variant: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const PersistedPromptDocument = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(2),
    text: Schema.String,
    cursor: Schema.optionalKey(Cursor),
    agents: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          name: Schema.String,
          mention: Schema.optionalKey(Schema.Struct({ start: Schema.Finite, end: Schema.Finite, text: Schema.String })),
        }),
      ),
    ),
    agent: Schema.optionalKey(Agent.ID),
    model: Schema.optionalKey(PromptModelSchema),
  }),
)

const cloneModel = (model: PromptModel): PromptModel => ({
  provider: model.provider,
  id: model.id,
  ...(model.variant === undefined ? {} : { variant: model.variant }),
})

const promptDocument = (initial?: InitialPrompt): PromptStore => {
  const text = initial?.text ?? ""
  const cursor = initial?.cursor ?? (initial?.text === undefined ? undefined : text.length)
  return {
    text,
    agents: initial?.agents?.map(cloneAgentAttachment) ?? [],
    ...(cursor === undefined ? {} : { cursor }),
    ...(initial?.agent === undefined ? {} : { agent: initial.agent }),
    ...(initial?.model === undefined ? {} : { model: cloneModel(initial.model) }),
  }
}

const promptStorageTarget = (scope: PromptScope) =>
  "draftID" in scope
    ? Persist.draft(scope.draftID, "prompt")
    : Persist.session(scope.workspaceID, scope.projectID, scope.sessionID, "prompt")

export const promptStorageKey = (scope: PromptScope) => promptStorageTarget(scope).key

export function removePersistedPrompt(scope: PromptScope, storage?: DraftStorage) {
  removePersisted(promptStorageTarget(scope), storage)
}

function createPromptStateValue(
  store: PromptStore,
  setStore: SetStoreFunction<PromptStore>,
  ready: PromptReady,
): PromptTarget {
  const contentRevision = createMemo(() => ({
    text: store.text,
    cursor: store.cursor,
    agents: store.agents.map(cloneAgentAttachment),
  }))
  const revision = createMemo(() => ({
    ...contentRevision(),
    agent: store.agent,
    model: store.model === undefined ? undefined : cloneModel(store.model),
  }))
  const selection = createMemo<PromptSelection>(() => ({
    ...(store.agent === undefined ? {} : { agent: store.agent }),
    ...(store.model === undefined ? {} : { model: cloneModel(store.model) }),
  }))
  const setModel = (model: PromptModel | undefined) => {
    if (model === undefined) {
      setStore("model", undefined)
      return
    }
    batch(() => {
      if (model.variant === undefined) setStore("model", undefined)
      setStore("model", cloneModel(model))
    })
  }
  return {
    ready,
    current: () => store.text,
    cursor: () => store.cursor,
    contentRevision,
    agents: {
      current: () => store.agents,
      set: (agents) => setStore("agents", agents.map(cloneAgentAttachment)),
    },
    revision,
    agent: {
      current: () => store.agent,
      set: (agent) => setStore("agent", agent),
    },
    model: {
      current: () => store.model,
      set: setModel,
    },
    selection: {
      current: selection,
      set: (next) =>
        batch(() => {
          setStore("agent", next.agent)
          setModel(next.model)
        }),
    },
    set: (text, cursorPosition, agents = []) =>
      batch(() => {
        setStore("text", text)
        setStore("agents", agents.map(cloneAgentAttachment))
        if (cursorPosition !== undefined) setStore("cursor", cursorPosition)
      }),
    restoreContent: (content) =>
      batch(() => {
        setStore("text", content.text)
        setStore("cursor", content.cursor)
        setStore("agents", content.agents.map(cloneAgentAttachment))
      }),
    reset: () =>
      batch(() => {
        setStore("text", "")
        setStore("cursor", 0)
        setStore("agents", [])
      }),
  }
}

function cloneAgentAttachment(agent: Prompt.AgentAttachment): Prompt.AgentAttachment {
  return {
    name: agent.name,
    ...(agent.mention === undefined ? {} : { mention: { ...agent.mention } }),
  }
}

function createPersistedPrompt(scope: PromptScope, initial?: InitialPrompt, input?: DraftStorage) {
  const fallback = promptDocument(initial)
  const storage = safePersistedStorage(input)
  const target = promptStorageTarget(scope)
  // Explicit store typing selects the store overload across the primitive's sync/async storage union.
  // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments
  const [store, setStore, hydration] = persisted<PromptStore, [Store<PromptStore>, SetStoreFunction<PromptStore>]>(
    target,
    createStore<PromptStore>(fallback),
    {
      storage,
      serialize: (document) => Schema.encodeSync(PersistedPromptDocument)({ version: 2, ...document }),
      deserialize: (encoded) => {
        const document = Option.getOrUndefined(Schema.decodeUnknownOption(PersistedPromptDocument)(encoded))
        if (document) {
          const { version: _, ...value } = document
          return { ...value, agents: value.agents?.map(cloneAgentAttachment) ?? [] }
        }
        void storage.removeItem(target.key)
        return fallback
      },
    },
  )
  const [ready, setReady] = createSignal(!(hydration instanceof Promise))
  const promise =
    hydration instanceof Promise
      ? hydration.then(() => {
          setReady(true)
          return true as const
        })
      : Promise.resolve(true as const)
  return createPromptStateValue(store, setStore, Object.assign(ready, { promise }))
}

export function createDraftPromptSession(
  draftID: string,
  initial?: InitialPrompt,
  storage?: DraftStorage,
): DraftPromptTarget {
  const scope = { draftID }
  return Object.assign(createPersistedPrompt(scope, initial, storage), { scope })
}

export function createPromptSession(
  scope: SessionPromptScope,
  initial?: InitialPrompt,
  storage?: DraftStorage,
): SessionPromptTarget {
  return Object.assign(createPersistedPrompt(scope, initial, storage), { scope })
}

export function createPromptState(initial?: InitialPrompt): PromptTarget {
  const [store, setStore] = createStore<PromptStore>(promptDocument(initial))
  const ready = Object.assign(() => true, { promise: Promise.resolve(true as const) })
  return createPromptStateValue(store, setStore, ready)
}
