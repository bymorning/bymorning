import type { SessionInfo } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import type { Project } from "@bymorning/schema/project"
import { useLocation, useNavigate } from "@solidjs/router"
import { useMutation, useMutationState } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { usePrompt } from "../context/prompt"
import { useWorkspaceRuntime } from "../context/workspace-runtime"
import { useWorkspace } from "../context/workspace"
import { useWorkspaceEvent } from "../context/workspace-event"
import { createComposerModel } from "../features/session/composer-model"
import { createPromptMutation } from "../features/session/prompt-mutation"
import type { SessionSelection } from "../features/session/ui/session-selection"
import { useProviderManagement } from "../integration/providers/management"
import { watchProviderDirectory, createProviderCatalog } from "../integration/providers/model"
import { createAutoModels } from "../utils/auto-models"
import { modelOptionKey, type ModelOption, modelOptions } from "../utils/model-option"
import { errorMessage } from "../utils/error-message"
import { sessionRouteHref, workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { useScope, useServer } from "../runtime/server/runtime"
import { scopeKey } from "../runtime/server/scope"
import { createVisibility } from "../utils/model-visibility"

export function createNewSessionDraftController(props: { readonly draftID: string }) {
  const workspace = useWorkspace()
  const data = useData()
  const events = useWorkspaceEvent()
  const runtime = useWorkspaceRuntime()
  const navigate = useNavigate()
  const location = useLocation()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const prompt = usePrompt()
  const scope = useScope()
  const server = useServer()
  const [draft, setDraft] = createSignal(runtime.draft.get(props.draftID))
  // The draft composer owns its Provider directory; Data carries agents and models only.
  const providerSignal = new AbortController()
  onCleanup(() => providerSignal.abort())
  const providers = createProviderCatalog({
    api: server.scope.api,
    workspace: server.scope.workspace,
    signal: providerSignal.signal,
  })
  watchProviderDirectory({
    events,
    signal: providerSignal.signal,
    catalog: providers,
    model: data.workspace.model,
  })
  let hasConnected = false
  const creationKey = [...scopeKey(scope), "session", "create", props.draftID]
  const creation = useMutationState(() => ({ filters: { mutationKey: creationKey, exact: true } }))
  const create = useMutation(() => ({
    mutationKey: creationKey,
    retry: false,
    mutationFn: (input: Parameters<typeof data.shared.session.create>[0]) => data.shared.session.create(input),
  }))
  const admission = createPromptMutation(data.shared, [...scopeKey(scope), "session", "prompt", props.draftID])
  const catalogsReady = () => providers.state().state === "ready" && data.workspace.model.state().state === "ready"
  createEffect(
    on(
      () => events.status(),
      (status) => {
        if (status !== "connected") return
        void data.workspace.agent.sync().catch(() => undefined)
        if (hasConnected) {
          providers.invalidate()
          data.workspace.model.invalidate()
        }
        hasConnected = true
        void Promise.all([providers.sync(), data.workspace.model.sync()]).catch(() => undefined)
        void data.workspace.skill.sync().catch(() => undefined)
      },
    ),
  )
  const agents = () => (data.workspace.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const auto = createAutoModels({ api: server.scope.api, workspace: server.scope.workspace })
  const models = createMemo<ReadonlyArray<ModelOption> | undefined>(() => {
    const infos = providers.list()
    const available = data.workspace.model.list()
    if (infos === undefined || available === undefined) return undefined
    return modelOptions(infos, available, auto())
  })

  const visibility = createVisibility(() => models() ?? [])
  const selectedAgent = createMemo(
    () =>
      agents().find((agent) => agent.id === prompt.agent.current()) ??
      agents().find((agent) => agent.id === Agent.DefaultID) ??
      agents()[0],
  )
  const selectedModel = createMemo(() => {
    const choices = models() ?? []
    const find = (ref: { readonly provider: string; readonly id: string } | undefined) =>
      ref ? choices.find((model) => model.provider === ref.provider && model.id === ref.id) : undefined
    // Precedence mirrors the server's own resolution in `Session.createSession`:
    // an explicit choice for this draft, then the selected Agent's pinned
    // Model, then the Workspace's configured default — never an arbitrary
    // first entry, so a brand-new chat matches what the console has set.
    return (
      find(prompt.model.current()) ?? find(selectedAgent()?.model) ?? find(data.workspace.model.default()) ?? choices[0]
    )
  })
  const selectedVariant = () => {
    const model = selectedModel()
    if (!model) return undefined
    const explicit = prompt.model.current()?.variant
    if (explicit === null) return undefined
    if (explicit && model.variants.includes(explicit)) return explicit
    const configured = selectedAgent()?.model
    if (configured?.provider !== model.provider || configured.id !== model.id) return undefined
    return configured.variant && model.variants.includes(configured.variant) ? configured.variant : undefined
  }
  const selectedModelRef = (): SessionInfo["model"] | undefined => {
    const model = selectedModel()
    if (!model) return undefined
    const variant = selectedVariant()
    return { provider: model.provider, id: model.id, ...(variant ? { variant } : {}) }
  }
  const selection: SessionSelection.Model = {
    agent: {
      options: () => agents().map((agent) => ({ key: agent.id, label: agent.name })),
      current: () => selectedAgent()?.id,
      pending: () => ["idle", "loading"].includes(data.workspace.agent.state().state),

      select: (key) => {
        const agent = agents().find((item) => item.id === key)
        if (agent) prompt.agent.set(agent.id)
      },
    },
    model: {
      options: () => (models() ?? []).map(visibility.option),
      current: () => {
        const model = selectedModel()
        return model ? modelOptionKey(model) : undefined
      },
      pending: () =>
        [data.workspace.model.state(), providers.state()].some(
          (state) => state.state === "idle" || state.state === "loading",
        ),
      select: (key) => {
        const model = (models() ?? []).find((item) => modelOptionKey(item) === key)
        if (!model) return
        visibility.set(model, true)
        const variant = prompt.model.current()?.variant
        prompt.model.set({
          provider: model.provider,
          id: model.id,
          ...(variant === null || (variant && model.variants.includes(variant)) ? { variant } : {}),
        })
      },
    },
    variant: {
      options: () =>
        ["default", ...new Set(selectedModel()?.variants ?? [])].map((variant) => ({
          key: variant,
          label: variant === "default" ? "Default" : variant,
        })),
      current: () => selectedVariant() ?? "default",
      pending: () => selection.model.pending(),
      select: (key) => {
        const model = selectedModel()
        if (!model || (key !== "default" && !model.variants.includes(key))) return
        prompt.model.set({ provider: model.provider, id: model.id, variant: key === "default" ? null : key })
      },
    },
    error: () => {
      for (const state of [data.workspace.agent.state(), data.workspace.model.state(), providers.state()]) {
        if (state.state === "error") return state.message
      }
      return undefined
    },
  }

  data.projectDirectory.observe(() => draft()?.projectID)
  const composer = createComposerModel({
    prompt,
    submissionState: runtime.submission(props.draftID),
    adapter: {
      pending: () =>
        !catalogsReady() ||
        create.isPending ||
        admission.isPending ||
        creation().some((state) => state.status === "pending"),
      error: () => {
        const cause = create.error ?? admission.error ?? creation().at(-1)?.error
        return cause ? errorMessage(cause, "Session could not be created.") : undefined
      },
      selection: () => {
        const agent = selectedAgent()?.id
        const model = selectedModelRef()
        return agent && model ? { agent, model } : undefined
      },
      submit: async ({ text, submission }) => {
        const initiatingDraft = draft()
        const initiatingPath = location.pathname
        if (!initiatingDraft) return
        const agent = submission.selection.agent
        const selected = submission.selection.model
        if (!agent || !selected) return
        const model = {
          provider: selected.provider,
          id: selected.id,
          ...(selected.variant === null || selected.variant === undefined ? {} : { variant: selected.variant }),
        }
        const revision = prompt.revision()
        const submissionWorkspace = workspace.current().id
        const submissionProject = initiatingDraft.projectID
        const session = await create.mutateAsync({
          projectID: submissionProject,
          agent,
          model,
        })
        const sessionPrompt = runtime.prompt({
          workspaceID: submissionWorkspace,
          projectID: session.projectID,
          sessionID: session.id,
        })
        submission.retarget(sessionPrompt, { text, cursor: text.length })
        const admitted = admission.mutateAsync({ sessionID: session.id, text, submission })
        if (prompt.revision() === revision && draft()?.projectID === submissionProject) {
          runtime.draft.remove(initiatingDraft.id)
        }
        if (!disposed && location.pathname === initiatingPath && workspace.current().id === submissionWorkspace) {
          // The composer that held focus is unmounted by this navigation; ask the session composer to take over.
          navigate(sessionRouteHref(submissionWorkspace, session.id), { replace: true, state: { focusComposer: true } })
        }
        await admitted
      },
    },
    command: () => (draft() ? "submit" : undefined),
    selection,
    selectionVisibility: { agent: () => true, variant: () => true },
    projectFiles: {
      scope: () => draft()?.projectID,
      list: () => {
        const current = draft()
        return current ? data.projectDirectory.list(current.projectID) : []
      },
      search: (query, signal) => {
        const current = draft()
        return current ? data.projectDirectory.search(current.projectID, query, signal) : Promise.resolve([])
      },
    },
    skills: data.workspace.skill.list,
    agents: data.workspace.agent.list,

    write: data.projectDirectory.write,
    directory: data.projectDirectory,
  })

  // The provider prompt unmounts as soon as a provider activates; its dialog must outlive it.
  const dialog = useDialog()
  const manageProvider = useProviderManagement(providers)

  return {
    composer,
    provider: {
      catalog: providers,
      /** Stable owner for the provider connection dialog. */
      owner: { dialog, manage: manageProvider },
      models: {
        state: data.workspace.model.state,
        count: () => models()?.length,
      },
      access: () => (workspace.current().role === "admin" ? ("admin" as const) : ("member" as const)),
      manage: () => workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.gatewayModels),
      retry: async () => {
        providers.invalidate()
        data.workspace.model.invalidate()
        await Promise.all([providers.sync(), data.workspace.model.sync()])
      },
    },
    project: {
      current: draft,
      list: () => server.data.project.list(),
      confirmed: () => server.bootstrapState().state === "ready",
      select: (projectID: Project.ID) => {
        const current = draft()
        if (current) setDraft(runtime.draft.update(current, projectID))
      },
    },
  }
}

export type NewSessionDraftController = ReturnType<typeof createNewSessionDraftController>
