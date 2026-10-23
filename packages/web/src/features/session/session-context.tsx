import type {
  AgentInfo,
  FormInfo,
  PermissionReplyInput,
  PermissionRequest,
  SessionDetail,
  SessionInfo,
} from "@bymorning/client"
import type { Form } from "@bymorning/schema/form"
import type { Session } from "@bymorning/schema/session"
import { createMemo, onCleanup, type Accessor, type ParentProps } from "solid-js"

import { useData, type Data } from "../../context/data"
import { createSimpleContext } from "../../context/helper"
import { useOptionalWorkspaceEvent } from "../../context/workspace-event"
import type { SessionInbox, SessionPolicyNotice, SessionTranscript, TranscriptEntry } from "../../context/session-state"
import { useSDK } from "../../context/sdk"
import { createProviderCatalog, watchProviderDirectory } from "../../integration/providers/model"
import { useServer } from "../../runtime/server/runtime"
import { createAutoModels } from "../../utils/auto-models"
import { modelOptions, type ModelOption } from "../../utils/model-option"
import type { PromptSubmissionState } from "./prompt-submission-state"
import { createSessionConnection } from "./session-connection"

export namespace SessionUI {
  export type Loadable<A> =
    | { readonly state: "idle" | "loading" }
    | { readonly state: "ready"; readonly data: A }
    | { readonly state: "error"; readonly message: string }
  export type Transcript = SessionTranscript
  export interface Interface {
    readonly data: {
      readonly detail: Accessor<Loadable<SessionDetail>>
      readonly transcript: Accessor<Transcript>
      readonly inbox: Accessor<SessionInbox>
      readonly policyNotices: Accessor<ReadonlyArray<SessionPolicyNotice>>
      readonly topology: Accessor<number>
      readonly entry: (messageID: string) => TranscriptEntry | undefined
      readonly permissions: Accessor<ReadonlyArray<PermissionRequest>>
      readonly forms: Accessor<ReadonlyArray<FormInfo>>
      readonly agents: Accessor<ReturnType<Data["workspace"]["agent"]["list"]>>
      readonly models: Accessor<ReadonlyArray<ModelOption> | undefined>
    }
    readonly composer: {
      readonly pending: Accessor<boolean>
      readonly error: Accessor<string | undefined>
      readonly submit: (input: { readonly text: string; readonly submission: PromptSubmissionState }) => Promise<void>
      readonly compact: () => Promise<void>
      readonly background: () => Promise<void>
      readonly cancel: () => Promise<void>
    }
    readonly history: {
      readonly loadOlder: () => Promise<void>
      readonly windowReplacement: Accessor<number>
    }
    readonly permission: {
      readonly pending: (request: PermissionRequest) => boolean
      readonly error: (request: PermissionRequest) => string | undefined
      readonly reply: (request: PermissionRequest, reply: PermissionReplyInput["reply"]) => Promise<void>
    }
    readonly form: {
      readonly pendingAction: (form: FormInfo) => "submit" | "back" | "cancel" | undefined
      readonly error: (form: FormInfo) => string | undefined
      readonly reply: (form: FormInfo, answer: Form.Answer, action?: "submit" | "back") => Promise<void>
      readonly cancel: (form: FormInfo) => Promise<void>
    }
    readonly selection: {
      readonly error: Accessor<string | undefined>
      readonly busy: (field: "agent" | "model") => Accessor<boolean>
      readonly agent: (agent: AgentInfo["id"]) => Promise<boolean>
      readonly model: (model: SessionInfo["model"]) => Promise<boolean>
    }
    readonly close: () => void
  }
  // createSessionUI captures `props.sessionID` eagerly instead of reading it reactively, which is
  // only correct because every consumer wraps this provider in `<Show keyed>` (session/route.tsx,
  // session-context.test.tsx): a session change remounts the provider instead of updating props.
  export type ProviderProps = ParentProps<{ readonly sessionID: Session.ID }>
}

function createSessionUI(props: SessionUI.ProviderProps): SessionUI.Interface {
  const { client } = useSDK()
  const data = useData()
  const server = useServer()
  const events = useOptionalWorkspaceEvent()
  // The session feature owns its Provider directory: Data carries agents and models only.
  const resource = new AbortController()
  onCleanup(() => resource.abort())
  const providers = createProviderCatalog({
    api: server.scope.api,
    workspace: server.scope.workspace,
    signal: resource.signal,
  })
  if (events) {
    watchProviderDirectory({ events, signal: resource.signal, catalog: providers, model: data.workspace.model })
  }
  void providers.sync().catch(() => undefined)
  const auto = createAutoModels({ api: server.scope.api, workspace: server.scope.workspace })
  const models = createMemo<ReadonlyArray<ModelOption> | undefined>(() => {
    const infos = providers.list()
    const available = data.workspace.model.list()
    if (infos === undefined || available === undefined) return undefined
    return modelOptions(infos, available, auto())
  })
  return createSessionConnection({
    client,
    server,
    sessionID: props.sessionID,
    agents: data.workspace.agent.list,
    models,
  })
}

export const { provider: SessionUIProvider, use: useSessionUI } = createSimpleContext({
  name: "SessionUI",
  init: createSessionUI,
})
