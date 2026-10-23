import type {
  ConnectionInfo,
  IntegrationConnectAwsSigV4Input,
  IntegrationAttempt,
  IntegrationInfo,
  WebSearchProvider,
} from "@bymorning/client"
import type { Credential } from "@bymorning/schema/credential"
import type { Form } from "@bymorning/schema/form"
import { createSignal, onCleanup, type Accessor } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { unwrap } from "solid-js/store"

import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useWorkspace } from "./workspace"
import { useOptionalWorkspaceEvent } from "./workspace-event"
import { errorMessage } from "../utils/error-message"

/** Types for Integration discovery and credential mutations. */
export namespace Integration {
  export type Info = IntegrationInfo
  export type Detail = IntegrationInfo
  export type Loadable<A> =
    | { readonly state: "idle" | "loading" }
    | { readonly state: "ready"; readonly data: A }
    | { readonly state: "error"; readonly message: string }
  export type Request =
    { readonly state: "idle" | "loading" | "success" } | { readonly state: "error"; readonly message: string }
  export type Flow =
    | { readonly state: "idle" }
    | { readonly state: "connecting"; readonly kind: "oauth" | "command" }
    | { readonly state: "oauth"; readonly attempt: IntegrationAttempt }
    | {
        readonly state: "command"
        readonly attemptID: IntegrationAttempt["attemptID"]
        readonly progress: string
      }
    | { readonly state: "failed"; readonly kind: "oauth" | "command"; readonly message: string }
    | { readonly state: "expired"; readonly kind: "oauth" | "command" }
    | { readonly state: "complete"; readonly kind: "oauth" | "command" }
  export type ClientConfigurationOperation =
    | {
        readonly generation: number
        readonly kind: "put"
        readonly mode: "configure" | "replace"
        readonly integrationID: IntegrationInfo["id"]
        readonly methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "oauth" }>["id"]
      }
    | {
        readonly generation: number
        readonly kind: "delete"
        readonly integrationID: IntegrationInfo["id"]
        readonly methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "oauth" }>["id"]
      }
  export type ClientConfigurationMutation =
    | { readonly state: "idle" }
    | { readonly state: "loading" | "success"; readonly operation: ClientConfigurationOperation }
    | {
        readonly state: "committed-refresh-failed"
        readonly operation: ClientConfigurationOperation
        readonly message: string
      }
    | {
        readonly state: "commit-unknown"
        readonly operation: ClientConfigurationOperation
        readonly statusRefreshed: boolean
        readonly message: string
      }
    | {
        readonly state: "error"
        readonly operation: ClientConfigurationOperation
        readonly kind: "400" | "403" | "404" | "network"
        readonly message: string
      }

  export interface Interface {
    readonly list: Accessor<Loadable<ReadonlyArray<Info>>>
    readonly websearch: Accessor<Loadable<ReadonlyArray<WebSearchProvider>>>
    readonly detail: Accessor<Loadable<Detail | null>>
    readonly mutation: Accessor<Request>
    readonly flow: Accessor<Flow>
    readonly clientMutation: Accessor<ClientConfigurationMutation>
    readonly refetch: () => Promise<boolean>
    readonly manage: (integration: IntegrationInfo, providerOnly?: boolean) => void
    readonly get: (integrationID: IntegrationInfo["id"]) => Promise<boolean>
    readonly configureOAuthClient: (
      integrationID: IntegrationInfo["id"],
      methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "oauth" }>["id"],
      mode: "configure" | "replace",
      answer: Form.Answer,
    ) => Promise<"ready" | "committed-refresh-failed" | "commit-unknown" | "failed">
    readonly removeOAuthClient: (
      integrationID: IntegrationInfo["id"],
      methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "oauth" }>["id"],
    ) => Promise<"ready" | "committed-refresh-failed" | "commit-unknown" | "failed">
    readonly retryClientConfigurationRefresh: () => Promise<boolean>
    readonly dismissClientConfigurationMutation: (generation: number) => void
    readonly connect: (
      integrationID: IntegrationInfo["id"],
      key: string,
      label?: string,
      answer?: Form.Answer,
      scope?: Credential.Scope,
    ) => Promise<boolean>
    readonly connectAws: (
      integrationID: IntegrationInfo["id"],
      methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "aws-sigv4" }>["id"],
      input: Pick<
        IntegrationConnectAwsSigV4Input,
        "accessKeyId" | "secretAccessKey" | "sessionToken" | "region" | "label" | "scope"
      >,
    ) => Promise<boolean>
    readonly connectOAuth: (
      integrationID: IntegrationInfo["id"],
      methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "oauth" }>["id"],
      answer?: Form.Answer,
      label?: string,
      scope?: Credential.Scope,
    ) => Promise<boolean>
    readonly completeOAuth: (code: string) => Promise<boolean>
    readonly connectCommand: (
      integrationID: IntegrationInfo["id"],
      methodID: Extract<IntegrationInfo["methods"][number], { readonly type: "command" }>["id"],
      label?: string,
      scope?: Credential.Scope,
    ) => Promise<boolean>
    readonly cancel: () => Promise<void>
    readonly activate: (
      credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"],
    ) => Promise<boolean>
    readonly rename: (
      credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"],
      label: string,
    ) => Promise<boolean>
    readonly remove: (credentialID: Extract<ConnectionInfo, { readonly type: "credential" }>["id"]) => Promise<boolean>
    readonly reset: () => void
  }
}

const failure = (cause: unknown) => ({
  state: "error" as const,
  message: errorMessage(cause, "Request failed"),
})

// Mutation variables retain only a spent closure after settlement, never credential inputs.
function transient<A>(request: (() => Promise<A>) | undefined, secrets: ReadonlyArray<string> = []) {
  return async () => {
    try {
      return await request!()
    } catch (cause) {
      const message = secrets.reduce(
        (message, secret) => (secret ? message.replaceAll(secret, "[redacted]") : message),
        typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string"
          ? cause.message
          : failure(cause).message,
      )
      throw Object.assign(new Error(message), {
        _tag: typeof cause === "object" && cause !== null && "_tag" in cause ? String(cause._tag) : undefined,
      })
    } finally {
      request = undefined
      secrets = []
    }
  }
}

const answerSecrets = (answer?: Form.Answer) =>
  Object.values(answer ?? {}).flatMap((value) =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
  )
const requestPolicy = { retry: false, networkMode: "always", gcTime: 0 } as const

/** Own Integration projections and credential request state for one Workspace route. */
function createIntegration(): Integration.Interface {
  const { client } = useSDK()
  const workspace = useWorkspace()
  const events = useOptionalWorkspaceEvent()
  const scope = { workspace: workspace.current().id }
  const [list, setList] = createSignal<Integration.Loadable<ReadonlyArray<Integration.Info>>>({ state: "idle" })
  const [websearch, setWebsearch] = createSignal<Integration.Loadable<ReadonlyArray<WebSearchProvider>>>({
    state: "idle",
  })
  const [detail, setDetail] = createSignal<Integration.Loadable<Integration.Detail | null>>({ state: "idle" })
  const credentialRequest = useMutation(() => ({
    ...requestPolicy,
    mutationFn: (run: () => Promise<void>) => run(),
  }))
  const mutation = (): Integration.Request =>
    credentialRequest.isPending
      ? { state: "loading" }
      : credentialRequest.isError
        ? failure(credentialRequest.error)
        : credentialRequest.isSuccess
          ? { state: "success" }
          : { state: "idle" }
  const [lifecycle, setFlow] = createSignal<Integration.Flow>({ state: "idle" })
  const oauthStart = useMutation(() => ({
    ...requestPolicy,
    mutationFn: (input: { generation: number; run: () => Promise<IntegrationAttempt> }) => input.run(),
  }))
  const commandStart = useMutation(() => ({
    ...requestPolicy,
    mutationFn: (input: { generation: number; run: () => ReturnType<typeof client.integration.command.connect> }) =>
      input.run(),
  }))
  const completion = useMutation(() => ({
    ...requestPolicy,
    mutationFn: (input: { generation: number; run: () => Promise<void> }) => input.run(),
  }))
  const cancellation = useMutation(() => ({ ...requestPolicy, mutationFn: (run: () => Promise<void>) => run() }))
  const flow = (): Integration.Flow => {
    const current = lifecycle()
    if (current.state === "complete" || current.state === "failed" || current.state === "expired") return current
    for (const [request, kind] of [
      [oauthStart, "oauth"],
      [commandStart, "command"],
      [completion, "oauth"],
    ] as const) {
      if (request.variables?.generation !== flowGeneration) continue
      if (request.isPending) return { state: "connecting", kind }
      if (request.isError) return { state: "failed", kind, message: failure(request.error).message }
    }
    // A submitted code still awaits the server's terminal status; do not offer a second POST.
    if (completion.isSuccess && completion.variables?.generation === flowGeneration)
      return { state: "connecting", kind: "oauth" }
    return current
  }
  const [reconciliation, setClientConfigurationMutation] = createSignal<
    | Extract<
        Integration.ClientConfigurationMutation,
        { state: "idle" | "committed-refresh-failed" | "commit-unknown" }
      >
    | { state: "success"; operation: Integration.ClientConfigurationOperation }
  >({
    state: "idle",
  })
  const clientRequest = useMutation(() => ({
    ...requestPolicy,
    mutationFn: async (input: {
      operation: Integration.ClientConfigurationOperation
      only: boolean
      run: () => Promise<void>
    }) => {
      await input.run()
      // Projection recovery cannot change the outcome of the committed write.
      return refreshClientConfigurationProjection(input.operation, input.only).catch(() => false)
    },
  }))
  const clientMutation = (): Integration.ClientConfigurationMutation => {
    const recovery = reconciliation()
    if (recovery.state !== "idle") return recovery
    const operation = clientRequest.variables?.operation
    if (!operation || operation.generation !== clientConfigurationGeneration) return { state: "idle" }
    if (clientRequest.isPending) return { state: "loading", operation }
    if (clientRequest.isError) {
      const cause = clientRequest.error as Error & { _tag?: string }
      const kind =
        cause._tag === "InvalidRequestError"
          ? "400"
          : cause._tag === "ForbiddenError"
            ? "403"
            : cause._tag === "Integration.OAuthMethodNotFoundError"
              ? "404"
              : "network"
      return { state: "error", operation, kind, message: cause.message }
    }
    return clientRequest.isSuccess && clientRequest.data ? { state: "success", operation } : { state: "idle" }
  }
  let listGeneration = 0
  let detailGeneration = 0
  let mutationGeneration = 0
  let flowGeneration = 0
  let clientConfigurationGeneration = 0
  let selectedIntegrationID: IntegrationInfo["id"] | undefined
  let providerOnly = false
  let currentAttempt:
    | {
        readonly kind: "oauth" | "command"
        readonly integrationID: IntegrationInfo["id"]
        readonly attemptID: IntegrationAttempt["attemptID"]
      }
    | undefined
  let flowController: AbortController | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let credentialAdmission: number | undefined
  let clientAdmission: number | undefined
  let startAdmission: number | undefined
  let completionAdmission: number | undefined
  const eventController = new AbortController()

  const refetch = async () => {
    if (disposed) return false
    const generation = ++listGeneration
    setList({ state: "loading" })
    setWebsearch({ state: "loading" })
    const [integrations, providers] = await Promise.allSettled([
      client.integration.list(scope),
      client.websearch.providers(scope),
    ])
    if (disposed || generation !== listGeneration) return false
    setList(
      integrations.status === "fulfilled" ? { state: "ready", data: integrations.value } : failure(integrations.reason),
    )
    setWebsearch(
      providers.status === "fulfilled" ? { state: "ready", data: providers.value } : failure(providers.reason),
    )
    return integrations.status === "fulfilled"
  }

  const get = async (integrationID: IntegrationInfo["id"]) => {
    if (disposed) return false
    if (selectedIntegrationID !== integrationID) clearSelection()
    selectedIntegrationID = integrationID
    const generation = ++detailGeneration
    setDetail({ state: "loading" })
    try {
      const data = await client.integration.get({ integrationID, ...scope })
      if (disposed || generation !== detailGeneration) return false
      setDetail({ state: "ready", data: data ?? null })
      return true
    } catch (cause) {
      if (disposed || generation !== detailGeneration) return false
      setDetail(failure(cause))
      return false
    }
  }

  const mutate = async (request: () => Promise<void>, secrets: ReadonlyArray<string> = []) => {
    if (disposed || credentialAdmission === mutationGeneration) return false
    const generation = ++mutationGeneration
    credentialAdmission = generation
    const integrationID = selectedIntegrationID
    const only = providerOnly
    try {
      await credentialRequest.mutateAsync(transient(request, secrets))
      if (!only) await refetch()
      if (disposed || generation !== mutationGeneration || integrationID !== selectedIntegrationID) return false
      if (only && integrationID) await get(integrationID)
      if (disposed || generation !== mutationGeneration) return false
      return true
    } catch {
      return false
    } finally {
      if (credentialAdmission === generation) credentialAdmission = undefined
    }
  }

  const refreshSelected = async (generation: number) => {
    const integrationID = selectedIntegrationID
    if (!providerOnly) await refetch()
    if (disposed || generation !== flowGeneration || !integrationID || integrationID !== selectedIntegrationID) return
    await get(integrationID)
  }

  const settle = async (generation: number, kind: "oauth" | "command") => {
    if (disposed || generation !== flowGeneration) return
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = undefined
    flowController?.abort()
    flowController = undefined
    currentAttempt = undefined
    setFlow({ state: "complete", kind })
    await refreshSelected(generation)
  }

  const poll = async (generation: number) => {
    pollTimer = undefined
    const attempt = currentAttempt
    const controller = flowController
    if (!attempt || !controller || disposed || generation !== flowGeneration) return
    try {
      const status =
        attempt.kind === "oauth"
          ? await client.integration.oauth.status(
              { integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...scope },
              { signal: controller.signal },
            )
          : await client.integration.command.status(
              { integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...scope },
              { signal: controller.signal },
            )
      if (disposed || generation !== flowGeneration || currentAttempt !== attempt) return
      if (status.status === "complete") {
        await settle(generation, attempt.kind)
        return
      }
      if (status.status === "failed") {
        controller.abort()
        currentAttempt = undefined
        flowController = undefined
        setFlow({ state: "failed", kind: attempt.kind, message: status.message })
        return
      }
      if (status.status === "expired") {
        controller.abort()
        currentAttempt = undefined
        flowController = undefined
        setFlow({ state: "expired", kind: attempt.kind })
        return
      }
      if (attempt.kind === "command") {
        setFlow({
          state: "command",
          attemptID: attempt.attemptID,
          progress: "message" in status && typeof status.message === "string" ? status.message : "",
        })
      }
      pollTimer = setTimeout(() => void poll(generation), 1000)
    } catch (cause) {
      if (disposed || generation !== flowGeneration || controller.signal.aborted) return
      setFlow({ state: "failed", kind: attempt.kind, message: failure(cause).message })
    }
  }

  const cancel = async () => {
    const generation = ++flowGeneration
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = undefined
    flowController?.abort()
    flowController = undefined
    const attempt = currentAttempt
    currentAttempt = undefined
    setFlow({ state: "idle" })
    oauthStart.reset()
    commandStart.reset()
    completion.reset()
    if (!attempt) return
    const controller = new AbortController()
    await cancellation
      .mutateAsync(
        transient(() =>
          attempt.kind === "oauth"
            ? client.integration.oauth.cancel(
                { integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...scope },
                { signal: controller.signal },
              )
            : client.integration.command.cancel(
                { integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...scope },
                { signal: controller.signal },
              ),
        ),
      )
      .catch(() => undefined)
    if (generation !== flowGeneration) controller.abort()
  }

  const refreshClientConfigurationProjection = async (
    operation: Integration.ClientConfigurationOperation,
    only = providerOnly,
  ) => {
    const listReady = only ? true : await refetch()
    if (disposed || operation.generation !== clientConfigurationGeneration) return false
    if (selectedIntegrationID && selectedIntegrationID !== operation.integrationID) return false
    const detailReady = selectedIntegrationID ? await get(operation.integrationID) : true
    return !disposed && operation.generation === clientConfigurationGeneration && listReady && detailReady
  }

  const mutateClientConfiguration = async (
    input:
      | Omit<Extract<Integration.ClientConfigurationOperation, { readonly kind: "put" }>, "generation">
      | Omit<Extract<Integration.ClientConfigurationOperation, { readonly kind: "delete" }>, "generation">,
    request: () => Promise<void>,
    secrets: ReadonlyArray<string> = [],
  ): Promise<"ready" | "committed-refresh-failed" | "commit-unknown" | "failed"> => {
    if (disposed || clientAdmission === clientConfigurationGeneration) return "failed"
    const operation = {
      ...input,
      generation: ++clientConfigurationGeneration,
    } as Integration.ClientConfigurationOperation
    clientAdmission = operation.generation
    setClientConfigurationMutation({ state: "idle" })
    let refreshed = false
    try {
      refreshed = await clientRequest.mutateAsync({ operation, only: providerOnly, run: transient(request, secrets) })
    } catch (cause) {
      if (disposed || operation.generation !== clientConfigurationGeneration) return "failed"
      const tagged = typeof cause === "object" && cause !== null && "_tag" in cause ? String(cause._tag) : undefined
      if (tagged === "Protocol.InternalError") {
        setClientConfigurationMutation({
          state: "commit-unknown",
          operation,
          statusRefreshed: false,
          message:
            operation.kind === "delete"
              ? "The server could not confirm whether the configuration was removed."
              : operation.mode === "replace"
                ? "The server could not confirm whether the replacement configuration was saved."
                : "The server could not confirm whether the configuration was saved.",
        })
        return "commit-unknown"
      }
      return "failed"
    } finally {
      if (clientAdmission === operation.generation) clientAdmission = undefined
    }
    if (disposed || operation.generation !== clientConfigurationGeneration) return "failed"
    if (refreshed) {
      return "ready"
    }
    setClientConfigurationMutation({
      state: "committed-refresh-failed",
      operation,
      message:
        operation.kind === "delete"
          ? "Removed, but the latest configuration status could not be loaded."
          : "Saved, but the latest configuration status could not be loaded.",
    })
    return "committed-refresh-failed"
  }

  const clearSelection = () => {
    void cancel()
    detailGeneration++
    mutationGeneration++
    clientConfigurationGeneration++
    credentialRequest.reset()
    clientRequest.reset()
    setClientConfigurationMutation({ state: "idle" })
  }

  const value: Integration.Interface = {
    list,
    websearch,
    detail,
    mutation,
    flow,
    clientMutation,
    refetch,
    manage: (item, only = false) => {
      if (selectedIntegrationID !== item.id) clearSelection()
      providerOnly = only
      selectedIntegrationID = item.id
      setDetail({ state: "ready", data: item })
    },
    get,
    configureOAuthClient: (integrationID, methodID, mode, answer) => {
      answer = structuredClone(unwrap(answer))
      return mutateClientConfiguration(
        { kind: "put", mode, integrationID, methodID },
        () => client.integration.oauth.client.put({ integrationID, methodID, answer, ...scope }),
        answerSecrets(answer),
      )
    },
    removeOAuthClient: (integrationID, methodID) =>
      mutateClientConfiguration({ kind: "delete", integrationID, methodID }, () =>
        client.integration.oauth.client.remove({ integrationID, methodID, ...scope }),
      ),
    retryClientConfigurationRefresh: async () => {
      const current = clientMutation()
      if (current.state !== "committed-refresh-failed" && current.state !== "commit-unknown") return false
      const refreshed = await refreshClientConfigurationProjection(current.operation)
      if (!refreshed || clientMutation() !== current) return false
      if (current.state === "committed-refresh-failed") {
        setClientConfigurationMutation({ state: "success", operation: current.operation })
        return true
      }
      const projection = detail()
      const method =
        projection.state === "ready"
          ? projection.data?.methods.find(
              (candidate) => candidate.type === "oauth" && candidate.id === current.operation.methodID,
            )
          : undefined
      const status =
        method?.type === "oauth" && method.client
          ? method.client.configured
            ? "Configured"
            : "Not configured"
          : "Unavailable"
      setClientConfigurationMutation({
        ...current,
        statusRefreshed: true,
        message: `Outcome remains unknown. Current status is ${status}, but this does not prove whether the ${current.operation.kind === "put" ? current.operation.mode : "delete"} request committed.`,
      })
      return true
    },
    dismissClientConfigurationMutation: (generation) => {
      const current = clientMutation()
      if (current.state !== "idle" && current.operation.generation === generation) {
        clientConfigurationGeneration++
        clientRequest.reset()
        setClientConfigurationMutation({ state: "idle" })
      }
    },
    connect: async (integrationID, key, label, answer, connectionScope) => {
      answer = answer ? structuredClone(unwrap(answer)) : undefined
      const region = answer?.region
      const connected = await mutate(
        () =>
          client.integration.connect.key({
            integrationID,
            key,
            ...(connectionScope ? { scope: connectionScope } : {}),
            ...(label ? { label } : {}),
            ...(answer && Object.keys(answer).length > 0 ? { answer } : {}),
            ...(region === "us-east-1" || region === "us-west-2"
              ? {
                  configuration: {
                    type: "aws-region" as const,
                    region: region as IntegrationConnectAwsSigV4Input["region"],
                  },
                }
              : {}),
            ...scope,
          }),
        [key, ...answerSecrets(answer)],
      )
      if (connected && selectedIntegrationID === integrationID) await get(integrationID)
      return connected
    },
    connectAws: async (integrationID, methodID, input) => {
      input = { ...input }
      const connected = await mutate(
        () => client.integration.connect.awsSigV4({ integrationID, methodID, ...input, ...scope }),
        [input.accessKeyId, input.secretAccessKey, input.sessionToken ?? ""],
      )
      if (connected && selectedIntegrationID === integrationID) await get(integrationID)
      return connected
    },
    connectOAuth: async (integrationID, methodID, answer, label, connectionScope) => {
      if (disposed || startAdmission === flowGeneration) return false
      answer = answer ? structuredClone(unwrap(answer)) : undefined
      const generation = ++flowGeneration
      startAdmission = generation
      if (pollTimer) clearTimeout(pollTimer)
      flowController?.abort()
      const controller = new AbortController()
      flowController = controller
      currentAttempt = undefined
      setFlow({ state: "idle" })
      try {
        const attempt = await oauthStart.mutateAsync({
          generation,
          run: transient(
            () =>
              client.integration.oauth.connect(
                {
                  integrationID,
                  methodID,
                  ...(connectionScope ? { scope: connectionScope } : {}),
                  ...(answer && Object.keys(answer).length > 0 ? { answer } : {}),
                  ...(label ? { label } : {}),
                  ...scope,
                },
                { signal: controller.signal },
              ),
            answerSecrets(answer),
          ),
        })
        if (disposed || generation !== flowGeneration) {
          const fresh = new AbortController()
          await cancellation
            .mutateAsync(
              transient(() =>
                client.integration.oauth.cancel(
                  { integrationID, attemptID: attempt.attemptID, ...scope },
                  { signal: fresh.signal },
                ),
              ),
            )
            .catch(() => undefined)
          return false
        }
        oauthStart.reset()
        currentAttempt = { kind: "oauth", integrationID, attemptID: attempt.attemptID }
        setFlow({ state: "oauth", attempt })
        if (attempt.mode === "auto") pollTimer = setTimeout(() => void poll(generation), 1000)
        return true
      } catch (cause) {
        if (disposed || generation !== flowGeneration || controller.signal.aborted) return false
        flowController = undefined
        return false
      } finally {
        if (startAdmission === generation) startAdmission = undefined
      }
    },
    completeOAuth: async (code) => {
      if (disposed || completionAdmission === flowGeneration) return false
      const attempt = currentAttempt
      const current = flow()
      if (!attempt || attempt.kind !== "oauth" || current.state !== "oauth") return false
      const generation = flowGeneration
      const controller = flowController
      if (!controller) return false
      completionAdmission = generation
      let result:
        { status: Awaited<ReturnType<typeof client.integration.oauth.status>> } | { error: string } | undefined
      const completionFailure = await completion
        .mutateAsync({
          generation,
          run: transient(async () => {
            try {
              await client.integration.oauth.complete(
                { integrationID: attempt.integrationID, attemptID: attempt.attemptID, code, ...scope },
                { signal: controller.signal },
              )
            } finally {
              // A rejected POST may still have a terminal server outcome. Reconcile before
              // settling the native request, without converting POST rejection to success.
              if (!disposed && generation === flowGeneration && !controller.signal.aborted) {
                result = await client.integration.oauth
                  .status(
                    { integrationID: attempt.integrationID, attemptID: attempt.attemptID, ...scope },
                    { signal: controller.signal },
                  )
                  .then(
                    (status) => ({ status }),
                    (cause) => ({ error: failure(cause).message.replaceAll(code, "[redacted]") }),
                  )
              }
            }
          }, [code]),
        })
        .then(
          () => undefined,
          (cause) => failure(cause).message,
        )
      if (completionAdmission === generation) completionAdmission = undefined
      if (disposed || generation !== flowGeneration || controller.signal.aborted) return false
      if (!result) return false
      if ("error" in result) {
        controller.abort()
        currentAttempt = undefined
        flowController = undefined
        // Read errors belong to the attempt lifecycle; POST errors remain native.
        if (!completionFailure) setFlow({ state: "failed", kind: "oauth", message: result.error })
        return false
      }
      if (result.status.status === "complete") {
        await settle(generation, "oauth")
        return true
      }
      if (result.status.status === "failed") {
        controller.abort()
        currentAttempt = undefined
        flowController = undefined
        setFlow({ state: "failed", kind: "oauth", message: result.status.message.replaceAll(code, "[redacted]") })
        return false
      }
      if (result.status.status === "expired") {
        controller.abort()
        currentAttempt = undefined
        flowController = undefined
        setFlow({ state: "expired", kind: "oauth" })
        return false
      }
      pollTimer = setTimeout(() => void poll(generation), 1000)
      if (completionFailure) {
        completion.reset()
        setFlow({ state: "connecting", kind: "oauth" })
      }
      return false
    },
    connectCommand: async (integrationID, methodID, label, connectionScope) => {
      if (disposed || startAdmission === flowGeneration) return false
      const generation = ++flowGeneration
      startAdmission = generation
      if (pollTimer) clearTimeout(pollTimer)
      flowController?.abort()
      const controller = new AbortController()
      flowController = controller
      currentAttempt = undefined
      setFlow({ state: "idle" })
      try {
        const attempt = await commandStart.mutateAsync({
          generation,
          run: transient(() =>
            client.integration.command.connect(
              {
                integrationID,
                methodID,
                ...(label ? { label } : {}),
                ...(connectionScope ? { scope: connectionScope } : {}),
                ...scope,
              },
              { signal: controller.signal },
            ),
          ),
        })
        if (disposed || generation !== flowGeneration) {
          const fresh = new AbortController()
          await cancellation
            .mutateAsync(
              transient(() =>
                client.integration.command.cancel(
                  { integrationID, attemptID: attempt.attemptID, ...scope },
                  { signal: fresh.signal },
                ),
              ),
            )
            .catch(() => undefined)
          return false
        }
        commandStart.reset()
        currentAttempt = { kind: "command", integrationID, attemptID: attempt.attemptID }
        setFlow({ state: "command", attemptID: attempt.attemptID, progress: "" })
        pollTimer = setTimeout(() => void poll(generation), 1000)
        return true
      } catch (cause) {
        if (disposed || generation !== flowGeneration || controller.signal.aborted) return false
        flowController = undefined
        return false
      } finally {
        if (startAdmission === generation) startAdmission = undefined
      }
    },
    cancel,
    activate: (credentialID) => mutate(() => client.credential.activate({ credentialID, ...scope })),
    rename: (credentialID, label) => mutate(() => client.credential.update({ credentialID, label, ...scope })),
    remove: (credentialID) => mutate(() => client.credential.remove({ credentialID, ...scope })),
    reset: () => {
      void cancel()
      selectedIntegrationID = undefined
      providerOnly = false
      detailGeneration++
      mutationGeneration++
      clientConfigurationGeneration++
      setDetail({ state: "idle" })
      credentialRequest.reset()
      clientRequest.reset()
      setClientConfigurationMutation({ state: "idle" })
    },
  }

  if (events) {
    void (async () => {
      for await (const event of events.subscribe({ signal: eventController.signal })) {
        if (
          event.type !== "integration.updated" &&
          event.type !== "integration.connection.updated" &&
          event.type !== "websearch.updated"
        )
          continue
        const current = clientMutation()
        const listReady = providerOnly && event.type !== "websearch.updated" ? true : await refetch()
        const detailReady = selectedIntegrationID ? await get(selectedIntegrationID) : true
        if (current.state === "committed-refresh-failed" && clientMutation() === current && listReady && detailReady) {
          setClientConfigurationMutation({ state: "success", operation: current.operation })
        }
      }
    })().catch(() => undefined)
  }

  onCleanup(() => {
    eventController.abort()
    disposed = true
    listGeneration++
    detailGeneration++
    mutationGeneration++
    clientConfigurationGeneration++
    void cancel()
  })
  return value
}

/** Provide and access Integration request state. */
export const {
  provider: IntegrationProvider,
  use: useIntegration,
  optional: useOptionalIntegration,
} = createSimpleContext({
  name: "Integration",
  init: createIntegration,
})
