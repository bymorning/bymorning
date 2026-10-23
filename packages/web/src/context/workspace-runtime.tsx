import { Project } from "@bymorning/schema/project"
import * as Workspace from "@bymorning/schema/workspace"
import { Option, Schema } from "effect"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createComposerSubmitState } from "../features/session/composer-submit"
import { Persist, safeSyncStorage } from "../runtime/persistence/storage"
import { createSimpleContext } from "./helper"
import {
  createDraftPromptSession,
  createPromptSession,
  removePersistedPrompt,
  type InitialPrompt,
  type PromptScope,
  type PromptTarget,
} from "./prompt-state"

export type NewSessionDraft = {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly projectID: Project.ID
}
const Draft = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), workspaceID: Workspace.ID, projectID: Project.ID }),
)
type Entry<T> = { readonly value: T; readonly dispose: VoidFunction }

/** User-authored drafts outlive route selection; server records never live here. */
function createWorkspaceRuntime() {
  const owner = getOwner()
  const storage = safeSyncStorage()
  const prompts = new Map<string, Entry<PromptTarget>>()
  const submissions = new Map<string, Entry<ReturnType<typeof createComposerSubmitState>>>()
  const ensure = <T,>(entries: Map<string, Entry<T>>, key: string, init: () => T) => {
    const existing = entries.get(key)
    if (existing) return existing.value
    const entry = createRoot((dispose) => ({ value: init(), dispose }), owner)
    entries.set(key, entry)
    return entry.value
  }
  const promptKey = (scope: PromptScope) =>
    "draftID" in scope ? `draft:${scope.draftID}` : `session:${scope.workspaceID}:${scope.sessionID}`
  const removeDraft = (draftID: string) => {
    prompts.get(`draft:${draftID}`)?.dispose()
    prompts.delete(`draft:${draftID}`)
    submissions.get(draftID)?.dispose()
    submissions.delete(draftID)
    storage.removeItem(Persist.draft(draftID, "metadata").key)
    removePersistedPrompt({ draftID })
  }
  onCleanup(() => {
    for (const entry of [...prompts.values(), ...submissions.values()]) entry.dispose()
  })
  return {
    prompt: (scope: PromptScope, initial?: InitialPrompt) =>
      ensure(prompts, promptKey(scope), () =>
        "draftID" in scope ? createDraftPromptSession(scope.draftID, initial) : createPromptSession(scope),
      ),
    submission: (draftID: string) => ensure(submissions, draftID, createComposerSubmitState),
    draft: {
      create: (workspaceID: Workspace.ID, projectID: Project.ID, initial?: InitialPrompt) => {
        const draft = { id: crypto.randomUUID(), workspaceID, projectID }
        storage.setItem(
          Persist.draft(draft.id, "metadata").key,
          Schema.encodeSync(Draft)({ version: 1, workspaceID, projectID }),
        )
        if (initial) ensure(prompts, `draft:${draft.id}`, () => createDraftPromptSession(draft.id, initial))
        return draft
      },
      get: (draftID: string) => {
        const value = storage.getItem(Persist.draft(draftID, "metadata").key)
        if (value === null) return
        const draft = Option.getOrUndefined(Schema.decodeUnknownOption(Draft)(value))
        return draft ? { id: draftID, workspaceID: draft.workspaceID, projectID: draft.projectID } : undefined
      },
      update: (draft: NewSessionDraft, projectID: Project.ID) => {
        storage.setItem(
          Persist.draft(draft.id, "metadata").key,
          Schema.encodeSync(Draft)({ version: 1, workspaceID: draft.workspaceID, projectID }),
        )
        return { ...draft, projectID }
      },
      remove: removeDraft,
    },
  }
}
export const { provider: WorkspaceRuntimeProvider, use: useWorkspaceRuntime } = createSimpleContext({
  name: "WorkspaceRuntime",
  gate: false,
  init: createWorkspaceRuntime,
})
