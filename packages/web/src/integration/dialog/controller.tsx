import type { ConnectionInfo, IntegrationConnectAwsSigV4Input, IntegrationInfo } from "@bymorning/client"
import type { Credential } from "@bymorning/schema/credential"
import type { Form } from "@bymorning/schema/form"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog, useEntry } from "../../context/dialog"
import { MCPValuesDialog } from "../../mcp/values-dialog"
import { useIntegration, type Integration } from "../../context/integration"
import { useWorkspace } from "../../context/workspace"
import { defaults, fieldActive, normalize, validate } from "../form"

/** Why the dialog reported a change, so consumers can skip refreshes the change cannot affect. */
export type ChangeReason = "activate" | "connect" | "disconnect" | "rename"

export function createIntegrationDialogController(
  initialIntegration?: IntegrationInfo,
  providerOnly = false,
  initialManagement = initialIntegration !== undefined,
  onChange?: (reason: ChangeReason) => void | Promise<unknown>,
) {
  const integration = useIntegration()
  const dialog = useDialog()
  const entry = useEntry()
  const workspace = useWorkspace()
  let editorGeneration = 0
  let disposed = false
  const currentEditor = (generation: number) => !disposed && generation === editorGeneration
  const [store, setStore] = createStore({
    view: (initialIntegration ? "connection" : "picker") as
      "picker" | "connection" | "method" | "key" | "aws-sigv4" | "oauth" | "oauth-client" | "command" | "success",
    selectedID: initialIntegration?.id as IntegrationInfo["id"] | undefined,
    methodType: undefined as "key" | "aws-sigv4" | "oauth" | "command" | undefined,
    methodID: undefined as string | undefined,
    scope: "workspace" as Credential.Scope,
    key: "",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    code: "",
    label: "",
    answers: {} as Record<string, Form.Value | undefined>,
    clientAnswers: {} as Record<string, Form.Value | undefined>,
    clientMode: undefined as "configure" | "replace" | undefined,
    clientMessage: undefined as string | undefined,
    renameID: undefined as string | undefined,
    renameLabel: "",
    mutationMessage: undefined as string | undefined,
    validationMessage: undefined as string | undefined,
    management: initialManagement,
  })

  const clearTransient = () =>
    setStore({
      key: "",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      code: "",
      label: "",
      answers: {},
      clientAnswers: {},
      validationMessage: undefined,
    })
  const notifyChange = (reason: ChangeReason) =>
    void Promise.resolve()
      .then(() => onChange?.(reason))
      .catch(() => undefined)
  const clientMessage = () => {
    const mutation = integration.clientMutation()
    return mutation.state === "error" ||
      mutation.state === "commit-unknown" ||
      mutation.state === "committed-refresh-failed"
      ? mutation.message
      : store.clientMessage
  }
  const websearchIDs = createMemo<ReadonlySet<string>>(() => {
    const state = integration.websearch()
    return new Set(state.state === "ready" ? state.data.map((provider) => provider.id) : [])
  })
  const catalog = createMemo(() => {
    const state = integration.list()
    if (state.state !== "ready") return []
    // MCP servers a member can connect lead the list: they are few and workspace-specific.
    const mcp = (id: string) => id.startsWith("mcp-")
    return state.data.toSorted(
      (left, right) =>
        Number(mcp(right.id)) - Number(mcp(left.id)) ||
        Number(websearchIDs().has(left.id)) - Number(websearchIDs().has(right.id)) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
  })
  const selected = createMemo(() => {
    const state = integration.detail()
    return state.state === "ready" ? state.data : undefined
  })
  // Shared Workspace Connections are an administrator decision (NIST 3.1.7); members connect personally.
  const canShareWorkspace = () => workspace.current().role === "admin"
  const connectionScope = () => {
    if (providerOnly) return "workspace"
    if (selected()?.connectionPolicy === "member-only") return "member"
    return canShareWorkspace() ? store.scope : "member"
  }
  const connectionLabel = () => (providerOnly ? undefined : store.label.trim() || undefined)
  const credentials = createMemo(
    () =>
      selected()?.connections.filter((item) => item.type === "credential" || item.type === "regional-credential") ?? [],
  )
  const activeCredentialID = createMemo(() => credentials()[0]?.id)
  const isPrimary = (connection: Extract<ConnectionInfo, { type: "credential" | "regional-credential" }>) =>
    connection.active ?? connection.id === activeCredentialID()
  const displayConnections = createMemo(() => [
    ...credentials().toSorted(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    ),
    ...(selected()?.connections.filter(
      (item) => item.type === "env" || item.type === "regional-env" || item.type === "regional-deployment",
    ) ?? []),
  ])
  const methods = createMemo(
    () => selected()?.methods.filter(
        (method) => method.type !== "env" && method.type !== "env-group" && method.type !== "values",
      ) ?? [],
  )
  const selectedMethod = createMemo(() =>
    selected()?.methods.find((method) => {
      if (method.type !== store.methodType) return false
      if (method.type === "key") return true
      return method.id === store.methodID
    }),
  )
  const form = createMemo(() => {
    const method = selectedMethod()
    return method?.type === "key" || method?.type === "oauth" ? (method.form ?? []) : []
  })
  const clientForm = createMemo(() => {
    const method = selectedMethod()
    return method?.type === "oauth" ? (method.client?.fields ?? []) : []
  })
  const clientConfigured = () => {
    const method = selectedMethod()
    return method?.type === "oauth" && method.client?.configured === true
  }
  const clientAnswer = () => normalize(clientForm(), store.clientAnswers)
  const clientValidity = () => validate(clientForm(), clientAnswer())
  const clientMethodAvailable = () => {
    const method = selectedMethod()
    return method?.type === "oauth" && method.client !== undefined
  }
  const selectedMethodLabel = () => {
    const method = selectedMethod()
    return method?.type === "oauth" ? method.label : "OAuth"
  }
  const authorizationURL = createMemo(() => {
    const flow = integration.flow()
    if (flow.state !== "oauth" || !URL.canParse(flow.attempt.url)) return undefined
    const url = new URL(flow.attempt.url)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  })
  const oauthFlow = createMemo(() => {
    const flow = integration.flow()
    return flow.state === "oauth" ? flow : undefined
  })
  const commandFlow = createMemo(() => {
    const flow = integration.flow()
    return flow.state === "command" ? flow : undefined
  })
  const failedFlow = createMemo(() => {
    const flow = integration.flow()
    return flow.state === "failed" ? flow : undefined
  })
  const connectionFieldActive = (field: Exclude<Form.Field, Form.ExternalField>) => fieldActive(field, store.answers)
  const detailError = () => {
    const state = integration.detail()
    return state.state === "error" ? state.message : "Request failed"
  }
  const mutationError = () => {
    const state = integration.mutation()
    return state.state === "error" ? state.message : "Request failed"
  }

  const close = () => {
    editorGeneration++
    const clientConfiguration = integration.clientMutation()
    if (clientConfiguration.state !== "idle") {
      integration.dismissClientConfigurationMutation(clientConfiguration.operation.generation)
    }
    clearTransient()
    integration.reset()
    dialog.close()
  }
  const back = () => {
    editorGeneration++
    if (store.view === "picker") return close()
    if (providerOnly && store.view === "connection") return close()
    if (
      store.view === "method" ||
      store.view === "key" ||
      store.view === "oauth" ||
      store.view === "oauth-client" ||
      store.view === "aws-sigv4" ||
      store.view === "command"
    ) {
      const clientConfiguration = integration.clientMutation()
      if (clientConfiguration.state !== "idle") {
        integration.dismissClientConfigurationMutation(clientConfiguration.operation.generation)
      }
      clearTransient()
      void integration.cancel()
      if (store.management) {
        setStore("view", "connection")
        return
      }
      if (providerOnly) return close()
    }
    if (integration.flow().state !== "idle") {
      clearTransient()
      void integration.cancel()
      setStore("view", "connection")
      return
    }
    integration.reset()
    clearTransient()
    setStore({ view: "picker", selectedID: undefined, management: false })
  }
  const select = (item: Integration.Info) => {
    // An MCP server that asks each member for their own values is connected through its own form.
    if (item.methods.some((method) => method.type === "values")) {
      entry.replace(() => <MCPValuesDialog integrationID={item.id} onComplete={() => notifyChange("connect")} />)
      return
    }
    editorGeneration++
    setStore({
      selectedID: item.id,
      scope: "workspace",
      view: "connection",
      key: "",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      code: "",
      label: "",
      answers: {},
      clientAnswers: {},
      clientMode: undefined,
      clientMessage: undefined,
      methodType: undefined,
      methodID: undefined,
      management: item.connections.length > 0,
    })
    void integration.get(item.id)
  }
  const choose = (method: Integration.Info["methods"][number]) => {
    editorGeneration++
    // Member values belong to an MCP server and are entered through its own dialog.
    if (method.type === "env" || method.type === "env-group" || method.type === "values") return
    // OAuth application setup is a Workspace administrator function; members go straight to the member connection flow.
    const clientSetup = method.type === "oauth" && method.client && !method.client.configured && canShareWorkspace()
    setStore({
      view: clientSetup ? "oauth-client" : method.type,
      methodType: method.type,
      methodID: method.type === "key" ? undefined : method.id,
      key: "",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      code: "",
      label: "",
      answers: defaults(
        method.type === "key" || method.type === "oauth"
          ? (method.form ?? [])
          : method.type === "aws-sigv4"
            ? [method.region]
            : [],
      ),
      clientAnswers: defaults(method.type === "oauth" ? (method.client?.fields ?? []) : []),
      clientMode: clientSetup ? "configure" : undefined,
      clientMessage: undefined,
    })
  }
  const add = () => {
    if (methods().length !== 1) {
      setStore("view", "method")
      return
    }
    const method = methods()[0]
    if (method) choose(method)
  }
  const submit = async (event: SubmitEvent) => {
    const generation = editorGeneration
    event.preventDefault()
    const method = selectedMethod()
    if (!store.selectedID || !method) return
    if (store.methodType === "key" && !store.key.trim()) return
    const answer = normalize(form(), store.answers)
    const invalid = validate(form(), answer)
    if (invalid) {
      setStore("validationMessage", invalid)
      return
    }
    const key = store.key.trim()
    const label = connectionLabel()
    clearTransient()
    const connected =
      store.methodType === "key"
        ? await integration.connect(store.selectedID, key, label, answer, connectionScope())
        : store.methodType === "oauth" && method.type === "oauth"
          ? await integration.connectOAuth(store.selectedID, method.id, answer, label, connectionScope())
          : false
    if (currentEditor(generation) && connected && store.methodType === "key") {
      setStore("view", "success")
      notifyChange("connect")
    }
  }
  const submitAws = async (event: SubmitEvent) => {
    const generation = editorGeneration
    event.preventDefault()
    const method = selectedMethod()
    if (!store.selectedID || method?.type !== "aws-sigv4") return
    const answer = normalize([method.region], store.answers)
    const invalid = validate([method.region], answer)
    if (invalid || !store.accessKeyId.trim() || !store.secretAccessKey.trim()) {
      setStore("validationMessage", invalid ?? "AWS access key ID and secret access key are required.")
      return
    }
    const region = answer[method.region.key] as IntegrationConnectAwsSigV4Input["region"]
    const input = {
      scope: connectionScope(),
      accessKeyId: store.accessKeyId.trim(),
      secretAccessKey: store.secretAccessKey.trim(),
      ...(store.sessionToken.trim() ? { sessionToken: store.sessionToken.trim() } : {}),
      region,
      ...(connectionLabel() ? { label: connectionLabel() } : {}),
    }
    clearTransient()
    if (!(await integration.connectAws(store.selectedID, method.id, input))) return
    if (!currentEditor(generation)) return
    setStore("view", "success")
    notifyChange("connect")
  }
  const submitCommand = async (event: SubmitEvent) => {
    event.preventDefault()
    const method = selectedMethod()
    if (!store.selectedID || method?.type !== "command") return
    const label = connectionLabel()
    clearTransient()
    await integration.connectCommand(store.selectedID, method.id, label, connectionScope())
  }
  const completeOAuth = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!store.code.trim()) return
    const code = store.code.trim()
    setStore("code", "")
    await integration.completeOAuth(code)
  }
  const activate = async (credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"]) => {
    const generation = editorGeneration
    setStore("mutationMessage", undefined)
    if (!(await integration.activate(credentialID))) return
    if (!currentEditor(generation)) return
    setStore("mutationMessage", "Active connection changed.")
    notifyChange("activate")
    if (store.selectedID) void integration.get(store.selectedID)
  }
  const rename = async (credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"]) => {
    const generation = editorGeneration
    setStore("mutationMessage", undefined)
    if (!(await integration.rename(credentialID, store.renameLabel.trim()))) return
    if (!currentEditor(generation)) return
    notifyChange("rename")
    if (store.selectedID) await integration.get(store.selectedID)
    if (!currentEditor(generation)) return
    setStore({ renameID: undefined, renameLabel: "", mutationMessage: "Connection renamed." })
  }
  const remove = async (credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"]) => {
    const generation = editorGeneration
    setStore("mutationMessage", undefined)
    if (!(await integration.remove(credentialID))) return
    if (!currentEditor(generation)) return
    setStore("mutationMessage", "Connection removed.")
    notifyChange("disconnect")
    if (store.selectedID) void integration.get(store.selectedID)
  }
  const chooseOAuthClient = (mode: "configure" | "replace") => {
    const method = selectedMethod()
    if (method?.type !== "oauth" || !method.client) return
    setStore({
      view: "oauth-client",
      clientMode: mode,
      clientAnswers: defaults(method.client.fields),
      clientMessage: undefined,
    })
  }
  const clearOAuthClientSecrets = () => {
    const secret = new Set(
      clientForm().flatMap((field) => (field.type === "string" && field.secret ? [field.key] : [])),
    )
    setStore("clientAnswers", (answers) =>
      Object.fromEntries(Object.entries(answers).filter(([key]) => !secret.has(key))),
    )
  }
  const submitOAuthClient = async (event: SubmitEvent) => {
    const generation = editorGeneration
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }
    const method = selectedMethod()
    if (!store.selectedID || method?.type !== "oauth" || !method.client || !store.clientMode) return
    const invalid = clientValidity()
    if (invalid) {
      setStore("clientMessage", invalid)
      return
    }
    const answer = clientAnswer()
    setStore("clientMessage", undefined)
    clearOAuthClientSecrets()
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = ""
    const result = await integration.configureOAuthClient(store.selectedID, method.id, store.clientMode, answer)
    if (!currentEditor(generation)) return
    const mutation = integration.clientMutation()
    if (result === "ready") {
      setStore({
        view: "oauth",
        clientMode: undefined,
        clientAnswers: {},
        clientMessage: "OAuth client saved.",
      })
      return
    }
    if (result === "committed-refresh-failed" || result === "commit-unknown") {
      return
    }
    if (mutation.state === "error") {
      if (mutation.kind !== "400") setStore("clientAnswers", {})
      if (mutation.kind === "404") {
        setStore({
          methodID: undefined,
          methodType: undefined,
          clientMode: undefined,
          clientAnswers: {},
        })
        await integration.refetch()
        if (!currentEditor(generation)) return
        if (store.selectedID) await integration.get(store.selectedID)
        if (!currentEditor(generation)) return
        const current = integration.detail()
        setStore("view", current.state === "ready" && current.data ? "connection" : "picker")
      }
    }
  }
  const removeOAuthClient = async () => {
    const generation = editorGeneration
    const method = selectedMethod()
    if (!store.selectedID || method?.type !== "oauth" || !method.client) return
    setStore({ view: "oauth-client", clientAnswers: {}, clientMessage: undefined })
    const result = await integration.removeOAuthClient(store.selectedID, method.id)
    if (!currentEditor(generation)) return
    if (result === "ready") {
      setStore({
        view: "connection",
        clientMode: undefined,
        clientMessage: "OAuth client removed. Existing connections may require reconnection.",
        management: true,
      })
      return
    }
  }
  const retryClientConfigurationRefresh = async () => {
    const generation = editorGeneration
    await integration.retryClientConfigurationRefresh()
    if (!currentEditor(generation)) return
    const mutation = integration.clientMutation()
    if (mutation.state === "success") {
      setStore({
        view: mutation.operation.kind === "delete" ? "connection" : "oauth",
        ...(mutation.operation.kind === "delete" ? { management: true } : {}),
      })
    }
  }
  const retryUnknownClientConfigurationMutation = async () => {
    const mutation = integration.clientMutation()
    if (mutation.state !== "commit-unknown" || mutation.operation.integrationID !== store.selectedID) return
    if (!clientMethodAvailable()) {
      setStore("clientMessage", "This OAuth client method is no longer available.")
      return
    }
    if (mutation.operation.kind === "delete") return removeOAuthClient()
    chooseOAuthClient(mutation.operation.mode)
  }

  // Side-effectful orchestration (navigation, transient resets) keyed on explicit dependencies;
  // inner reads such as add() must not widen the trigger set.
  createEffect(
    on([() => store.view, integration.detail, () => store.management], () => {
      if (store.view !== "connection") return
      const state = integration.detail()
      if (state.state !== "ready" || state.data === null) return
      if (state.data.connections.length > 0) {
        setStore("management", true)
        return
      }
      if (store.management) return
      if (!state.data.methods.some((method) => method.type !== "env")) return
      add()
    }),
  )
  createEffect(
    on([integration.clientMutation, () => store.selectedID], ([mutation]) => {
      if (mutation.state !== "success" || mutation.operation.integrationID !== store.selectedID) return
      setStore({
        view: mutation.operation.kind === "delete" ? "connection" : "oauth",
        clientMode: undefined,
        clientAnswers: {},
        clientMessage:
          mutation.operation.kind === "delete"
            ? "OAuth client removed. Existing connections may require reconnection."
            : "OAuth client saved.",
        ...(mutation.operation.kind === "delete" ? { management: true } : {}),
      })
    }),
  )
  createEffect(
    on([() => store.view, integration.clientMutation, selectedMethod, selected], () => {
      if (store.view !== "oauth-client") return
      const mutation = integration.clientMutation()
      const method = selectedMethod()
      if (method?.type === "oauth" && method.client) return
      setStore("clientAnswers", {})
      if (mutation.state === "commit-unknown") return
      setStore({
        view: selected() ? "connection" : "picker",
        methodID: undefined,
        methodType: undefined,
        clientMode: undefined,
        clientAnswers: {},
      })
    }),
  )
  createEffect(
    on(
      () => integration.flow().state,
      (state) => {
        if (state === "failed" || state === "expired") {
          clearTransient()
          return
        }
        if (state !== "complete") return
        clearTransient()
        setStore("view", "success")
        notifyChange("connect")
      },
    ),
  )

  if (initialIntegration) {
    integration.manage(initialIntegration, providerOnly)
    void integration.get(initialIntegration.id)
  }
  if (!providerOnly) void integration.refetch()
  onCleanup(() => {
    disposed = true
    integration.reset()
  })

  return {
    list: integration.list,
    detail: integration.detail,
    mutation: integration.mutation,
    flow: integration.flow,
    clientMutation: integration.clientMutation,
    clientMessage,
    refetch: integration.refetch,
    store,
    providerOnly,
    canShareWorkspace,
    setStore,
    websearchIDs,
    catalog,
    selected,
    activeCredentialID,
    isPrimary,
    connectionScope,
    displayConnections,
    methods,
    form,
    clientForm,
    clientConfigured,
    clientValidity,
    clientMethodAvailable,
    selectedMethodLabel,
    authorizationURL,
    oauthFlow,
    commandFlow,
    failedFlow,
    fieldActive: connectionFieldActive,
    detailError,
    mutationError,
    close,
    back,
    select,
    add,
    choose,
    submit,
    submitAws,
    submitCommand,
    completeOAuth,
    activate,
    rename,
    remove,
    chooseOAuthClient,
    submitOAuthClient,
    removeOAuthClient,
    retryClientConfigurationRefresh,
    retryUnknownClientConfigurationMutation,
  }
}

export type IntegrationDialogController = ReturnType<typeof createIntegrationDialogController>
