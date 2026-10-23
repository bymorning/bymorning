import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { render, waitFor } from "@solidjs/testing-library"
import { type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { IntegrationProvider, useIntegration, type Integration } from "./integration"
import { SDKProvider } from "./sdk"
import { WorkspaceScope } from "./workspace"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { Credential } from "@bymorning/schema/credential"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Integration as IntegrationSchema } from "@bymorning/schema/integration"
import { WebSearch } from "@bymorning/schema/websearch"
import { Event } from "@bymorning/schema/event"
import { WorkspaceEventProvider } from "../test/workspace-event"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Default",
  status: "active",
  role: "admin",
})
const exaID = IntegrationSchema.ID.make("exa")
const parallelID = IntegrationSchema.ID.make("parallel")

function mount(client: ByMorningClient, events = false) {
  const queryClient = new QueryClient()
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  let integration!: Integration.Interface
  function Consumer(): JSX.Element {
    integration = useIntegration()
    return <div />
  }
  const content = () => (
    <IntegrationProvider>
      <Consumer />
    </IntegrationProvider>
  )
  const view = render(() => (
    <QueryClientProvider client={queryClient}>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          {events ? <WorkspaceEventProvider>{content()}</WorkspaceEventProvider> : content()}
        </WorkspaceScope>
      </SDKProvider>
    </QueryClientProvider>
  ))
  return { integration: () => integration, unmount: view.unmount, queryClient }
}

describe("IntegrationProvider", () => {
  it("uses native pending/error state, suppresses same-tick writes, redacts cache errors, and retries", async () => {
    const pending = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const connect = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        connect: { ...base.integration.connect, key: connect },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    })
    const request = mounted.integration().connect(exaID, "private-key")
    await expect(mounted.integration().connect(exaID, "duplicate")).resolves.toBe(false)
    await waitFor(() => expect(mounted.integration().mutation().state).toBe("loading"))
    expect(connect).toHaveBeenCalledOnce()
    const native = mounted.queryClient.getMutationCache().getAll()[0]!
    expect(native.state.status).toBe("pending")
    expect(typeof native.state.variables).toBe("function")
    pending.reject(new Error("Rejected private-key"))
    await expect(request).resolves.toBe(false)
    expect(native.state.status).toBe("error")
    expect(native.state.error?.message).toBe("Rejected [redacted]")
    expect(mounted.integration().mutation()).toEqual({ state: "error", message: "Rejected [redacted]" })
    await expect(mounted.integration().connect(exaID, "replacement")).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    mounted.integration().reset()
    await waitFor(() => expect(mounted.queryClient.getMutationCache().getAll()).toHaveLength(0))
    mounted.unmount()
  })

  it("captures credential inputs and never refreshes a newly selected editor after an old write", async () => {
    const pending = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const old = { id: exaID, name: "Exa", methods: [], connections: [] }
    const next = { ...old, id: parallelID, name: "Parallel" }
    const get = vi.fn().mockResolvedValue(next)
    const connect = vi.fn().mockReturnValue(pending.promise)
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        get,
        connect: { ...base.integration.connect, key: connect },
      },
    })
    mounted.integration().manage(old, true)
    const answer = { region: "us-east-1" }
    const request = mounted.integration().connect(exaID, "secret", undefined, answer)
    answer.region = "us-west-2"
    await waitFor(() => expect(connect).toHaveBeenCalledOnce())
    expect(connect.mock.calls[0]?.[0].answer).toEqual({ region: "us-east-1" })
    mounted.integration().manage(next, true)
    pending.resolve()
    await expect(request).resolves.toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(mounted.integration().detail()).toEqual({ state: "ready", data: next })
    expect(mounted.integration().mutation()).toEqual({ state: "idle" })
    mounted.unmount()
  })

  it("keeps OAuth start and best-effort cancellation failures native", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const start = Promise.withResolvers<IntegrationSchema.Attempt>()
    const connect = vi
      .fn()
      .mockReturnValueOnce(start.promise)
      .mockResolvedValue(
        IntegrationSchema.Attempt.make({
          attemptID: IntegrationSchema.AttemptID.make("con_native"),
          url: "https://example.com",
          instructions: "Approve",
          mode: "code",
          time: { created: 1, expires: 2 },
        }),
      )
    const cancel = vi.fn().mockRejectedValue(new Error("Cancel offline"))
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        oauth: { ...base.integration.oauth, connect, cancel },
      },
    })
    const request = mounted
      .integration()
      .connectOAuth(exaID, IntegrationSchema.MethodID.make("oauth"), { secret: "oauth-secret" })
    await expect(mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("oauth"))).resolves.toBe(
      false,
    )
    await waitFor(() => expect(mounted.integration().flow()).toEqual({ state: "connecting", kind: "oauth" }))
    start.reject(new Error("Rejected oauth-secret"))
    await expect(request).resolves.toBe(false)
    expect(mounted.integration().flow()).toEqual({ state: "failed", kind: "oauth", message: "Rejected [redacted]" })
    expect(
      mounted.queryClient
        .getMutationCache()
        .getAll()
        .some(
          (mutation) => mutation.state.status === "error" && mutation.state.error?.message === "Rejected [redacted]",
        ),
    ).toBe(true)
    await expect(mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("oauth"))).resolves.toBe(
      true,
    )
    await expect(mounted.integration().cancel()).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
    expect(mounted.integration().flow()).toEqual({ state: "idle" })
    expect(
      mounted.queryClient
        .getMutationCache()
        .getAll()
        .some((mutation) => mutation.state.status === "error" && mutation.state.error?.message === "Cancel offline"),
    ).toBe(true)
    mounted.unmount()
  })

  it("does not let a disposed credential owner refresh or admit another write", async () => {
    const pending = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const connect = vi.fn().mockReturnValue(pending.promise)
    const list = vi.fn().mockResolvedValue([])
    const mounted = mount({
      ...base,
      integration: { ...base.integration, list, connect: { ...base.integration.connect, key: connect } },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    })
    const request = mounted.integration().connect(exaID, "secret")
    await waitFor(() => expect(connect).toHaveBeenCalledOnce())
    mounted.unmount()
    pending.resolve()
    await expect(request).resolves.toBe(false)
    expect(list).not.toHaveBeenCalled()
    await expect(mounted.integration().connect(exaID, "another")).resolves.toBe(false)
    expect(connect).toHaveBeenCalledOnce()
  })

  it("invalidates a detail read when management moves to another integration", async () => {
    const pending = Promise.withResolvers<IntegrationSchema.Info>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const mounted = mount({
      ...base,
      integration: { ...base.integration, get: vi.fn().mockReturnValue(pending.promise) },
    })
    const request = mounted.integration().get(exaID)
    const next = { id: parallelID, name: "Parallel", methods: [], connections: [] }
    mounted.integration().manage(next, true)
    pending.resolve(IntegrationSchema.Info.make({ id: exaID, name: "Exa", methods: [], connections: [] }))
    await expect(request).resolves.toBe(false)
    expect(mounted.integration().detail()).toEqual({ state: "ready", data: next })
    mounted.unmount()
  })

  it("can reconcile a rejected completion as connected while retaining native POST failure", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        oauth: {
          ...base.integration.oauth,
          connect: vi.fn().mockResolvedValue(
            IntegrationSchema.Attempt.make({
              attemptID: IntegrationSchema.AttemptID.make("con_committed"),
              url: "https://example.com",
              instructions: "Approve",
              mode: "code",
              time: { created: 1, expires: 2 },
            }),
          ),
          complete: vi.fn().mockRejectedValue(new Error("Lost response for private-code")),
          status: vi.fn().mockResolvedValue({ status: "complete", time: { created: 1, expires: 2 } }),
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    })
    await mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("oauth"))
    await expect(mounted.integration().completeOAuth("private-code")).resolves.toBe(true)
    expect(mounted.integration().flow()).toEqual({ state: "complete", kind: "oauth" })
    expect(
      mounted.queryClient
        .getMutationCache()
        .getAll()
        .some(
          (mutation) =>
            mutation.state.status === "error" && mutation.state.error?.message === "Lost response for [redacted]",
        ),
    ).toBe(true)
    mounted.unmount()
  })

  it("redacts native client configuration failures and snapshots their answers", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const put = vi.fn().mockRejectedValue({ _tag: "InvalidRequestError", message: "Rejected client-secret" })
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        oauth: { ...base.integration.oauth, client: { ...base.integration.oauth.client, put } },
      },
    })
    const answer = { client_secret: "client-secret" }
    const request = mounted
      .integration()
      .configureOAuthClient(exaID, IntegrationSchema.MethodID.make("oauth"), "configure", answer)
    answer.client_secret = "changed"
    await expect(request).resolves.toBe("failed")
    expect(put.mock.calls[0]?.[0].answer).toEqual({ client_secret: "client-secret" })
    expect(mounted.integration().clientMutation()).toMatchObject({
      state: "error",
      kind: "400",
      message: "Rejected [redacted]",
    })
    const native = mounted.queryClient.getMutationCache().getAll()[0]!
    expect(native.state.status).toBe("error")
    expect(native.state.error?.message).toBe("Rejected [redacted]")
    expect(JSON.stringify(native.state.variables)).not.toContain("client-secret")
    mounted.unmount()
  })

  it("injects the route Workspace into every generated request", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi.fn().mockResolvedValue([])
    const providers = vi.fn().mockResolvedValue([])
    const client: ByMorningClient = {
      ...base,
      integration: { ...base.integration, list },
      websearch: { ...base.websearch, providers },
    }
    const mounted = mount(client)
    await mounted.integration().refetch()
    expect(list).toHaveBeenCalledWith({ workspace: workspace.id })
    expect(providers).toHaveBeenCalledWith({ workspace: workspace.id })
    mounted.unmount()
  })

  it("loads both generated catalogs and ignores a stale detail completion", async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise((resolve) => (resolveFirst = resolve))
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([{ id: exaID, name: "Exa", methods: [], connections: [] }]),
        get: vi
          .fn()
          .mockReturnValueOnce(first)
          .mockResolvedValueOnce({ id: parallelID, name: "Parallel", methods: [], connections: [] }),
      },
      websearch: {
        ...base.websearch,
        providers: vi.fn().mockResolvedValue([{ id: WebSearch.ID.make("parallel"), name: "Parallel" }]),
      },
    }
    const mounted = mount(client)

    await mounted.integration().refetch()
    expect(mounted.integration().list()).toMatchObject({ state: "ready", data: [{ id: "exa" }] })
    expect(mounted.integration().websearch()).toMatchObject({ state: "ready", data: [{ id: "parallel" }] })

    const stale = mounted.integration().get(exaID)
    await mounted.integration().get(parallelID)
    resolveFirst({ id: exaID, name: "Exa", methods: [], connections: [] })
    await stale
    expect(mounted.integration().detail()).toMatchObject({ state: "ready", data: { id: "parallel" } })
    mounted.unmount()
  })

  it("connects, activates, and removes credentials before refreshing, and exposes request failures", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi.fn().mockResolvedValue([])
    const connect = vi.fn().mockResolvedValue(undefined)
    const update = vi.fn().mockResolvedValue(undefined)
    const activate = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    const client: ByMorningClient = {
      ...base,
      integration: { ...base.integration, list, connect: { ...base.integration.connect, key: connect } },
      credential: { activate, update, remove },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)

    await expect(mounted.integration().connect(exaID, "secret", "work")).resolves.toBe(true)
    expect(connect).toHaveBeenCalledWith({
      integrationID: "exa",
      key: "secret",
      label: "work",
      workspace: workspace.id,
    })
    expect(list).toHaveBeenCalledOnce()
    expect(mounted.integration().mutation().state).toBe("success")

    await expect(mounted.integration().activate(Credential.ID.make("cred_2"))).resolves.toBe(true)
    expect(activate).toHaveBeenCalledWith({ credentialID: "cred_2", workspace: workspace.id })
    expect(list).toHaveBeenCalledTimes(2)

    await expect(mounted.integration().rename(Credential.ID.make("cred_1"), "team")).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith({ credentialID: "cred_1", label: "team", workspace: workspace.id })
    expect(list).toHaveBeenCalledTimes(3)

    await expect(mounted.integration().remove(Credential.ID.make("cred_1"))).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({ credentialID: "cred_1", workspace: workspace.id })
    expect(list).toHaveBeenCalledTimes(4)

    connect.mockRejectedValueOnce(new Error("Key rejected"))
    await expect(mounted.integration().connect(exaID, "bad")).resolves.toBe(false)
    await waitFor(() => expect(mounted.integration().mutation()).toEqual({ state: "error", message: "Key rejected" }))
    mounted.unmount()
  })

  it("connects AWS credentials and refreshes the integration projection without retaining request data", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi.fn().mockResolvedValue([])
    const connect = vi.fn().mockResolvedValue(undefined)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list,
        connect: { ...base.integration.connect, awsSigV4: connect },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)

    await expect(
      mounted.integration().connectAws(exaID, IntegrationSchema.MethodID.make("bedrock-sigv4"), {
        accessKeyId: "AKIA-SECRET",
        secretAccessKey: "secret-access-key",
        region: AwsRegion.make("us-east-1"),
      }),
    ).resolves.toBe(true)

    expect(connect).toHaveBeenCalledWith({
      integrationID: exaID,
      methodID: "bedrock-sigv4",
      accessKeyId: "AKIA-SECRET",
      secretAccessKey: "secret-access-key",
      region: "us-east-1",
      workspace: workspace.id,
    })
    expect(list).toHaveBeenCalledOnce()
    expect(mounted.integration().mutation()).toEqual({ state: "success" })
    mounted.unmount()
  })

  it("separates committed refresh failure from commit-unknown and never replays a mutation on refresh", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const methodID = IntegrationSchema.MethodID.make("oauth")
    const configured = {
      id: exaID,
      name: "Exa",
      methods: [
        {
          id: methodID,
          type: "oauth" as const,
          label: "OAuth",
          client: {
            fields: [{ key: "client_id", type: "string" as const, required: true }] as const,
            configured: true,
          },
        },
      ],
      connections: [],
    }
    const put = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({
      _tag: "Protocol.InternalError",
      error: "publication failed",
    })
    const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([configured])
    const get = vi.fn().mockResolvedValue(configured)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list,
        get,
        oauth: {
          ...base.integration.oauth,
          client: { ...base.integration.oauth.client, put },
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)
    await mounted.integration().get(exaID)

    await expect(
      mounted.integration().configureOAuthClient(exaID, methodID, "configure", { client_id: "client" }),
    ).resolves.toBe("committed-refresh-failed")
    expect(mounted.integration().clientMutation()).toMatchObject({
      state: "committed-refresh-failed",
      message: "Saved, but the latest configuration status could not be loaded.",
    })
    await expect(mounted.integration().retryClientConfigurationRefresh()).resolves.toBe(true)
    expect(mounted.integration().clientMutation().state).toBe("success")
    expect(put).toHaveBeenCalledOnce()

    await expect(
      mounted.integration().configureOAuthClient(exaID, methodID, "replace", { client_id: "replacement" }),
    ).resolves.toBe("commit-unknown")
    expect(mounted.integration().clientMutation()).toMatchObject({
      state: "commit-unknown",
      statusRefreshed: false,
      message: "The server could not confirm whether the replacement configuration was saved.",
    })
    expect(list).toHaveBeenCalledTimes(2)
    await expect(mounted.integration().retryClientConfigurationRefresh()).resolves.toBe(true)
    expect(mounted.integration().clientMutation()).toMatchObject({
      state: "commit-unknown",
      statusRefreshed: true,
      message:
        "Outcome remains unknown. Current status is Configured, but this does not prove whether the replace request committed.",
    })
    expect(put).toHaveBeenCalledTimes(2)
    mounted.unmount()
  })

  it("invalidates a dismissed in-flight application mutation generation", async () => {
    const pending = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const put = vi.fn().mockReturnValue(pending.promise)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        oauth: { ...base.integration.oauth, client: { ...base.integration.oauth.client, put } },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)
    const request = mounted
      .integration()
      .configureOAuthClient(exaID, IntegrationSchema.MethodID.make("oauth"), "replace", { client_id: "id" })
    await waitFor(() => expect(mounted.integration().clientMutation().state).toBe("loading"))
    const mutation = mounted.integration().clientMutation()
    if (mutation.state === "idle") throw new Error("Expected application mutation")
    mounted.integration().dismissClientConfigurationMutation(mutation.operation.generation)
    pending.resolve()
    await expect(request).resolves.toBe("failed")
    expect(mounted.integration().clientMutation()).toEqual({ state: "idle" })
    mounted.unmount()
  })

  it("reports an OAuth method without an application declaration as unavailable", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const methodID = IntegrationSchema.MethodID.make("oauth")
    const unavailable = {
      id: exaID,
      name: "Exa",
      methods: [{ id: methodID, type: "oauth" as const, label: "OAuth" }],
      connections: [],
    }
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([unavailable]),
        get: vi.fn().mockResolvedValue(unavailable),
        oauth: {
          ...base.integration.oauth,
          client: {
            ...base.integration.oauth.client,
            put: vi.fn().mockRejectedValue({ _tag: "Protocol.InternalError", error: "unknown" }),
          },
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)
    await mounted.integration().get(exaID)
    await mounted.integration().configureOAuthClient(exaID, methodID, "replace", { client_id: "id" })
    await expect(mounted.integration().retryClientConfigurationRefresh()).resolves.toBe(true)
    expect(mounted.integration().clientMutation()).toMatchObject({
      state: "commit-unknown",
      statusRefreshed: true,
      message: expect.stringContaining("Current status is Unavailable"),
    })
    mounted.unmount()
  })

  it("settles a committed refresh failure after an Integration event refreshes both projections", async () => {
    const release = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const methodID = IntegrationSchema.MethodID.make("oauth")
    const configured = {
      id: exaID,
      name: "Exa",
      methods: [
        {
          id: methodID,
          type: "oauth" as const,
          label: "OAuth",
          client: { configured: true, fields: [{ key: "client_id", type: "string" as const }] },
        },
      ],
      connections: [],
    }
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([configured]),
        get: vi.fn().mockResolvedValue(configured),
        oauth: {
          ...base.integration.oauth,
          client: { ...base.integration.oauth.client, put: vi.fn().mockResolvedValue(undefined) },
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
      event: {
        subscribe: vi.fn((_input, options) =>
          (async function* () {
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000000"),
              type: "server.connected" as const,
              data: {},
            }
            await release.promise
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000002"),
              type: "integration.updated" as const,
              created: 1,
              data: {},
            }
            await new Promise<void>((resolve) =>
              options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
            )
          })(),
        ),
      },
    }
    const mounted = mount(client, true)
    await mounted.integration().get(exaID)
    await expect(
      mounted.integration().configureOAuthClient(exaID, methodID, "replace", { client_id: "id" }),
    ).resolves.toBe("committed-refresh-failed")
    release.resolve()
    await waitFor(() => expect(mounted.integration().clientMutation().state).toBe("success"))
    mounted.unmount()
  })

  it.each([
    { type: "integration.connection.updated" as const, data: { integrationID: exaID }, providerOnly: false },
    { type: "websearch.updated" as const, data: {}, providerOnly: false },
    { type: "websearch.updated" as const, data: {}, providerOnly: true },
  ])("refreshes inventory and detail for $type (providerOnly: $providerOnly)", async (event) => {
    const release = Promise.withResolvers<void>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const before = { id: exaID, name: "Exa", methods: [], connections: [] }
    const after = {
      ...before,
      connections: [{ type: "env" as const, name: "EXA_API_KEY" }],
    }
    const list = vi.fn().mockResolvedValueOnce([before]).mockResolvedValue([after])
    const get = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list,
        get,
        oauth: {
          ...base.integration.oauth,
          connect: vi.fn().mockResolvedValue(
            IntegrationSchema.Attempt.make({
              attemptID: IntegrationSchema.AttemptID.make("con_event"),
              url: "https://example.com",
              instructions: "Approve",
              mode: "code",
              time: { created: 1, expires: 2 },
            }),
          ),
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
      event: {
        subscribe: vi.fn((_input, options) =>
          (async function* () {
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000000"),
              type: "server.connected" as const,
              data: {},
            }
            await release.promise
            yield {
              ...event,
              id: Event.ID.make("00000000-0000-4000-8000-000000000001"),
              created: 1,
            }
            await new Promise<void>((resolve) =>
              options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
            )
          })(),
        ),
      },
    }
    const mounted = mount(client, true)
    await mounted.integration().refetch()
    mounted.integration().manage(before, event.providerOnly)
    await mounted.integration().get(exaID)
    await mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"))

    release.resolve()

    await waitFor(() => expect(mounted.integration().detail()).toMatchObject({ state: "ready", data: after }))
    expect(list).toHaveBeenCalledTimes(2)
    expect(client.websearch.providers).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(2)
    expect(mounted.integration().flow()).toMatchObject({ state: "oauth", attempt: { attemptID: "con_event" } })
    mounted.unmount()
  })

  it("treats rejected code OAuth completion as terminal and only connects after authoritative completion", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const item = { id: exaID, name: "Exa", methods: [], connections: [] }
    const connect = vi.fn().mockResolvedValue(
      IntegrationSchema.Attempt.make({
        attemptID: IntegrationSchema.AttemptID.make("con_code"),
        url: "https://example.com/authorize",
        instructions: "Paste the code",
        mode: "code",
        time: { created: 1, expires: 2 },
      }),
    )
    const complete = vi.fn().mockRejectedValueOnce(new Error("Code rejected"))
    const status = vi.fn().mockResolvedValueOnce({
      status: "failed" as const,
      message: "Code rejected",
      time: { created: 1, expires: 2 },
    })
    const list = vi.fn().mockResolvedValue([item])
    const get = vi.fn().mockResolvedValue(item)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list,
        get,
        oauth: { ...base.integration.oauth, connect, complete, status },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)
    await mounted.integration().get(exaID)

    await expect(
      mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"), { region: "eu" }, "Work"),
    ).resolves.toBe(true)
    expect(connect.mock.calls[0]?.[0]).toEqual({
      integrationID: exaID,
      methodID: "device",
      answer: { region: "eu" },
      label: "Work",
      workspace: workspace.id,
    })
    expect(mounted.integration().flow()).toMatchObject({ state: "oauth", attempt: { mode: "code" } })

    await expect(mounted.integration().completeOAuth("bad")).resolves.toBe(false)
    expect(mounted.integration().flow()).toEqual({ state: "failed", kind: "oauth", message: "Code rejected" })
    await expect(mounted.integration().completeOAuth("good")).resolves.toBe(false)
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(
      { integrationID: exaID, attemptID: "con_code", code: "bad", workspace: workspace.id },
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(list).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledOnce()
    mounted.unmount()
  })

  it("keeps OAuth connecting after a rejected completion POST while the attempt is still pending", async () => {
    vi.useFakeTimers()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const complete = vi.fn().mockRejectedValue(new Error("Lost response"))
    const status = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending", time: { created: 1, expires: 2 } })
      .mockResolvedValueOnce({ status: "complete", time: { created: 1, expires: 2 } })
    const mounted = mount({
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        oauth: {
          ...base.integration.oauth,
          connect: vi.fn().mockResolvedValue(
            IntegrationSchema.Attempt.make({
              attemptID: IntegrationSchema.AttemptID.make("con_pending"),
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              mode: "code",
              time: { created: 1, expires: 2 },
            }),
          ),
          complete,
          status,
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    })

    await mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"))
    await expect(mounted.integration().completeOAuth("good")).resolves.toBe(false)
    expect(mounted.integration().flow()).toEqual({ state: "connecting", kind: "oauth" })
    await expect(mounted.integration().completeOAuth("again")).resolves.toBe(false)
    expect(complete).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1000)
    expect(mounted.integration().flow()).toEqual({ state: "complete", kind: "oauth" })
    expect(status).toHaveBeenCalledTimes(2)
    mounted.unmount()
  })

  it("does not report code OAuth connected until status is complete", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const authoritative = Promise.withResolvers<{
      status: "complete"
      time: { created: number; expires: number }
    }>()
    const status = vi.fn().mockReturnValue(authoritative.promise)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        oauth: {
          ...base.integration.oauth,
          connect: vi.fn().mockResolvedValue(
            IntegrationSchema.Attempt.make({
              attemptID: IntegrationSchema.AttemptID.make("con_complete"),
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              mode: "code",
              time: { created: 1, expires: 2 },
            }),
          ),
          complete: vi.fn().mockResolvedValue(undefined),
          status,
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)

    await mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"))
    const completing = mounted.integration().completeOAuth("good")
    await waitFor(() => expect(status).toHaveBeenCalledOnce())
    expect(mounted.integration().flow()).toEqual({ state: "connecting", kind: "oauth" })
    authoritative.resolve({ status: "complete", time: { created: 1, expires: 2 } })
    await expect(completing).resolves.toBe(true)

    expect(mounted.integration().flow()).toEqual({ state: "complete", kind: "oauth" })
    mounted.unmount()
  })

  it("polls automatic OAuth and command attempts every second and preserves exact progress", async () => {
    vi.useFakeTimers()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const oauthStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending", time: { created: 1, expires: 3 } })
      .mockResolvedValueOnce({ status: "complete", time: { created: 1, expires: 3 } })
    const commandStatus = vi
      .fn()
      .mockResolvedValueOnce({
        status: "pending",
        message: "first\n  second\n",
        time: { created: 1, expires: 3 },
      })
      .mockResolvedValueOnce({ status: "expired", time: { created: 1, expires: 3 } })
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        list: vi.fn().mockResolvedValue([]),
        oauth: {
          ...base.integration.oauth,
          connect: vi.fn().mockResolvedValue(
            IntegrationSchema.Attempt.make({
              attemptID: IntegrationSchema.AttemptID.make("con_auto"),
              url: "https://example.com/authorize",
              instructions: "Approve",
              mode: "auto",
              time: { created: 1, expires: 3 },
            }),
          ),
          status: oauthStatus,
        },
        command: {
          ...base.integration.command,
          connect: vi.fn().mockResolvedValue({
            attemptID: IntegrationSchema.AttemptID.make("con_command"),
            time: { created: 1, expires: 3 },
          }),
          status: commandStatus,
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)

    await mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"))
    expect(oauthStatus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(oauthStatus).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mounted.integration().flow()).toEqual({ state: "complete", kind: "oauth" })

    await mounted.integration().connectCommand(exaID, IntegrationSchema.MethodID.make("cli"))
    await vi.advanceTimersByTimeAsync(1000)
    expect(mounted.integration().flow()).toEqual({
      state: "command",
      attemptID: "con_command",
      progress: "first\n  second\n",
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mounted.integration().flow()).toEqual({ state: "expired", kind: "command" })
    expect(commandStatus.mock.calls[1]?.[1]?.signal.aborted).toBe(true)
    mounted.unmount()
    vi.useRealTimers()
  })

  it("aborts reset work, cancels known attempts, and cancels attempts returned after reset", async () => {
    const stale = Promise.withResolvers<IntegrationSchema.Attempt>()
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const oauthConnect = vi.fn().mockReturnValue(stale.promise)
    const oauthCancel = vi.fn().mockResolvedValue(undefined)
    const commandCancel = vi.fn().mockResolvedValue(undefined)
    const client: ByMorningClient = {
      ...base,
      integration: {
        ...base.integration,
        oauth: { ...base.integration.oauth, connect: oauthConnect, cancel: oauthCancel },
        command: {
          ...base.integration.command,
          connect: vi.fn().mockResolvedValue({
            attemptID: IntegrationSchema.AttemptID.make("con_command"),
            time: { created: 1, expires: 2 },
          }),
          cancel: commandCancel,
        },
      },
      websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
    }
    const mounted = mount(client)
    const connecting = mounted.integration().connectOAuth(exaID, IntegrationSchema.MethodID.make("device"))
    await waitFor(() => expect(oauthConnect).toHaveBeenCalledOnce())
    const connectSignal = oauthConnect.mock.calls[0]?.[1]?.signal
    mounted.integration().reset()
    expect(connectSignal?.aborted).toBe(true)
    stale.resolve(
      IntegrationSchema.Attempt.make({
        attemptID: IntegrationSchema.AttemptID.make("con_stale"),
        url: "https://example.com",
        instructions: "Approve",
        mode: "code",
        time: { created: 1, expires: 2 },
      }),
    )
    await expect(connecting).resolves.toBe(false)
    expect(oauthCancel.mock.calls[0]?.[0]).toEqual({
      integrationID: exaID,
      attemptID: "con_stale",
      workspace: workspace.id,
    })
    expect(oauthCancel.mock.calls[0]?.[1]?.signal.aborted).toBe(false)

    await mounted.integration().connectCommand(exaID, IntegrationSchema.MethodID.make("cli"))
    await mounted.integration().cancel()
    expect(commandCancel.mock.calls[0]?.[0]).toEqual({
      integrationID: exaID,
      attemptID: "con_command",
      workspace: workspace.id,
    })
    expect(mounted.integration().flow()).toEqual({ state: "idle" })
    await mounted.integration().connectCommand(exaID, IntegrationSchema.MethodID.make("cli"))
    mounted.unmount()
    await waitFor(() => expect(commandCancel).toHaveBeenCalledTimes(2))
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
