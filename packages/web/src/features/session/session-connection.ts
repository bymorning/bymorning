import type { ByMorningClient, FormInfo, PermissionRequest, SessionInfo, PermissionReplyInput } from "@bymorning/client"
import type { Form } from "@bymorning/schema/form"
import type { CompactInput } from "@bymorning/client/solid"
import { useMutation, useMutationState } from "@tanstack/solid-query"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionProjection, type SessionPolicyNotice } from "../../context/session-state"
import type { ServerSync } from "../../runtime/server/sync"
import { scopeKey } from "../../runtime/server/scope"
import { errorMessage } from "../../utils/error-message"
import { createPromptMutation } from "./prompt-mutation"
import type { SessionUI } from "./session-context"

/** Selected-session operations and presentation; shared Data owns every record. */
export function createSessionConnection(input: {
  readonly server: ServerSync
  readonly client: ByMorningClient
  readonly sessionID: SessionInfo["id"]
  readonly agents: SessionUI.Interface["data"]["agents"]
  readonly models: SessionUI.Interface["data"]["models"]
}): SessionUI.Interface {
  const { server, client, sessionID } = input
  const data = server.data
  const key = [...scopeKey(server.scope), "session", sessionID]
  const [presentation, setPresentation] = createStore<{ notices: SessionPolicyNotice[]; closed: boolean }>({
    notices: [],
    closed: false,
  })
  const readiness = () => {
    const state = server.state()
    if (state.state === "error")
      return { state: "error" as const, message: errorMessage(state.error, "Request failed") }
    if (state.state === "loading" || !data.session.get(sessionID)) return { state: "loading" as const }
    return state
  }
  const projection = createSessionProjection(data, sessionID, readiness)
  const prompt = createPromptMutation(data, [...key, "prompt"])
  const compact = useMutation(() => ({
    mutationKey: [...key, "compact"],
    mutationFn: (input: CompactInput) => data.session.compact(input),
    retry: false,
  }))
  const interrupt = useMutation(() => ({
    mutationKey: [...key, "interrupt"],
    mutationFn: () => data.session.interrupt({ sessionID, payload: {} }),
    retry: false,
  }))
  const background = useMutation(() => ({
    mutationKey: [...key, "background"],
    mutationFn: () => client.session.background({ sessionID }),
    retry: false,
  }))
  type PermissionInput = { request: PermissionRequest; reply: PermissionReplyInput["reply"] }
  const permissionKey = [...key, "permission"]
  const permission = useMutation(() => ({
    mutationKey: permissionKey,
    retry: false,
    mutationFn: ({ request, reply }: PermissionInput) =>
      data.session.permission.reply({ sessionID: request.sessionID, requestID: request.id, reply }),
  }))
  const permissionState = useMutationState(() => ({
    filters: { mutationKey: permissionKey, exact: true },
    select: (mutation) => ({ ...mutation.state, variables: mutation.state.variables as PermissionInput | undefined }),
  }))
  const formIdentity = (form: FormInfo) => JSON.stringify([form.id, form.fields])
  type FormInput = { formID: FormInfo["id"]; identity: string } & (
    { action: "submit" | "back"; answer: Form.Answer } | { action: "cancel" }
  )
  const formKey = [...key, "form"]
  const form = useMutation(() => ({
    mutationKey: formKey,
    retry: false,
    mutationFn: async (input: FormInput) => {
      if (input.action === "cancel") await data.session.form.cancel({ sessionID, formID: input.formID })
      else await data.session.form.reply({ sessionID, formID: input.formID, answer: input.answer })
    },
  }))
  const formState = useMutationState(() => ({
    filters: { mutationKey: formKey, exact: true },
    select: (mutation) => ({ ...mutation.state, variables: mutation.state.variables as FormInput | undefined }),
  }))
  const agent = useMutation(() => ({
    mutationKey: [...key, "agent"],
    retry: false,
    scope: { id: JSON.stringify([...key, "agent"]) },
    mutationFn: (agent: SessionInfo["agent"]) => data.session.switchAgent({ sessionID, agent }),
  }))
  const model = useMutation(() => ({
    mutationKey: [...key, "model"],
    retry: false,
    scope: { id: JSON.stringify([...key, "model"]) },
    mutationFn: async (model: SessionInfo["model"]) => {
      await data.session.switchModel({ sessionID, model })
      await data.session.detail.sync(sessionID)
    },
  }))
  const unlisten = server.connection.listen((event) => {
    if (event.type !== "session.policy.enforced" || event.data.sessionID !== sessionID) return
    setPresentation("notices", (rows) => [
      ...rows,
      { ...event.data, id: String(event.id), created: new Date(event.created).toISOString() },
    ])
  })
  const close = () => {
    if (presentation.closed) return
    setPresentation("closed", true)
    unlisten()
  }
  onCleanup(close)
  return {
    data: {
      detail: () => {
        const detail = data.session.get(sessionID)
        if (detail) return { state: "ready", data: detail }
        const state = readiness()
        return state.state === "error" ? state : { state: "loading" }
      },
      transcript: projection.transcript,
      inbox: projection.inbox,
      topology: projection.topology,
      entry: projection.entry,
      policyNotices: () => presentation.notices,
      permissions: () => data.session.permission.list(sessionID),
      forms: () => data.session.form.list(sessionID),
      agents: input.agents,
      models: input.models,
    },
    composer: {
      pending: () => prompt.isPending || compact.isPending || interrupt.isPending || background.isPending,
      error: () => {
        const error = prompt.error ?? compact.error ?? interrupt.error ?? background.error
        return error ? errorMessage(error, "Request failed.") : undefined
      },
      submit: async (value) => {
        await prompt.mutateAsync({ sessionID, ...value })
      },
      compact: async () => {
        const retry = data.session.submission
          .list(sessionID)
          .findLast((row) => row.type === "compaction" && row.state.state !== "sending")
        await compact.mutateAsync(retry?.type === "compaction" ? retry.input : { sessionID })
      },
      cancel: async () => {
        await interrupt.mutateAsync()
      },
      background: async () => {
        await background.mutateAsync()
      },
    },
    history: { loadOlder: projection.loadOlder, windowReplacement: projection.windowReplacement },
    permission: {
      pending: (request) =>
        permissionState().some((state) => state.status === "pending" && state.variables?.request.id === request.id),
      error: (request) => {
        const state = permissionState().findLast((state) => state.variables?.request.id === request.id)
        return state?.error ? errorMessage(state.error, "Permission reply failed.") : undefined
      },
      reply: async (request, reply) => {
        await permission.mutateAsync({ request, reply })
      },
    },
    form: {
      pendingAction: (item) =>
        formState().findLast((state) => state.status === "pending" && state.variables?.identity === formIdentity(item))
          ?.variables?.action,
      error: (item) => {
        const state = formState().findLast((state) => state.variables?.identity === formIdentity(item))
        return state?.error ? errorMessage(state.error, "Form response failed. Try again.") : undefined
      },
      reply: async (item, answer, action = "submit") => {
        await form.mutateAsync({ formID: item.id, identity: formIdentity(item), answer, action })
      },
      cancel: async (item) => {
        await form.mutateAsync({ formID: item.id, identity: formIdentity(item), action: "cancel" })
      },
    },
    selection: {
      error: () =>
        agent.error || model.error ? errorMessage(agent.error ?? model.error, "Selection switch failed.") : undefined,
      busy: (field) => () => (field === "agent" ? agent.isPending : model.isPending),
      agent: async (value) => {
        if (agent.isPending) return false
        try {
          await agent.mutateAsync(value)
          return true
        } catch {
          return false
        }
      },
      model: async (value) => {
        try {
          await model.mutateAsync(value)
          return true
        } catch {
          return false
        }
      },
    },
    close,
  }
}
