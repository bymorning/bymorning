import { ByMorning, type ByMorningClient, type IntegrationInfo } from "@bymorning/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { WebSearch } from "@bymorning/schema/websearch"
import { AwsRegion } from "@bymorning/schema/aws-region"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { IntegrationProvider } from "../../context/integration"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { Toast, toaster } from "../../ui/components/toast"
import { IntegrationDialog } from "./dialog"
import type { ChangeReason } from "./controller"

const catalog: IntegrationInfo[] = [
  {
    id: Integration.ID.make("exa"),
    name: "Exa",
    methods: [{ type: "key" as const, label: "API key" }],
    connections: [],
  },
  {
    id: Integration.ID.make("parallel"),
    name: "Parallel",
    methods: [{ type: "key" as const, label: "API key" }],
    connections: [],
  },
  {
    id: Integration.ID.make("firecrawl"),
    name: "Firecrawl",
    methods: [{ type: "key" as const }],
    connections: [{ type: "credential" as const, id: Credential.ID.make("cred_1"), label: "Work" }],
  },
  {
    id: Integration.ID.make("github"),
    name: "GitHub",
    methods: [{ type: "env" as const, names: ["GITHUB_TOKEN"] }],
    connections: [{ type: "env" as const, name: "GITHUB_TOKEN" }],
  },
  {
    id: Integration.ID.make("configured"),
    name: "Configured",
    methods: [
      {
        type: "key" as const,
        form: [
          { key: "mode", type: "string" as const, title: "Mode", default: "basic" },
          {
            key: "detail",
            type: "string" as const,
            title: "Detail",
            when: [{ key: "mode", op: "eq" as const, value: "advanced" }],
          },
          { key: "retries", type: "integer" as const, title: "Retries", default: 2 },
          { key: "enabled", type: "boolean" as const, title: "Enabled", default: false },
          {
            key: "scopes",
            type: "multiselect" as const,
            title: "Scopes",
            options: [
              { value: "read", label: "Read" },
              { value: "write", label: "Write" },
            ],
            default: ["read"],
          },
          { key: "terms", type: "external" as const, title: "Terms", url: "https://example.com/terms" },
        ],
      },
    ],
    connections: [],
  },
]
const trusted: IntegrationInfo = {
  id: Integration.ID.make("trusted"),
  name: "Trusted Service",
  methods: [
    { type: "key", label: "API key" },
    {
      id: Integration.MethodID.make("browser"),
      type: "oauth",
      label: "Browser OAuth",
      form: [{ key: "region", type: "string", title: "Region", default: "eu" }],
    },
    {
      id: Integration.MethodID.make("cli"),
      type: "command",
      label: "Trusted CLI",
      command: ["trusted-auth"],
    },
    { type: "env", names: ["TRUSTED_TOKEN"] },
  ],
  connections: [],
}
const automatic: IntegrationInfo = {
  id: Integration.ID.make("automatic"),
  name: "Automatic OAuth",
  methods: [{ id: Integration.MethodID.make("auto"), type: "oauth", label: "Automatic OAuth" }],
  connections: [],
}
const bedrock: IntegrationInfo = {
  id: Integration.ID.make("amazon-bedrock"),
  name: "Amazon Bedrock",
  methods: [
    {
      type: "key",
      label: "Bedrock API key",
      form: [
        {
          key: "region",
          type: "string",
          title: "AWS region",
          required: true,
          default: "us-east-1",
          options: [
            { value: "us-east-1", label: "US East (N. Virginia)" },
            { value: "us-west-2", label: "US West (Oregon)" },
          ],
        },
      ],
    },
    {
      id: Integration.MethodID.make("bedrock-sigv4"),
      type: "aws-sigv4",
      label: "AWS credentials",
      region: {
        key: "region",
        type: "string",
        title: "AWS region",
        required: true,
        default: "us-east-1",
        options: [
          { value: "us-east-1", label: "US East (N. Virginia)" },
          { value: "us-west-2", label: "US West (Oregon)" },
        ],
      },
    },
    {
      id: Integration.MethodID.make("bedrock-sigv4-env"),
      type: "env-group",
      authKind: "aws-sigv4",
      available: true,
    },
  ],
  connections: [],
}
const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Default",
  status: "active",
  role: "admin",
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

function client(overrides: Partial<ByMorningClient> = {}): ByMorningClient {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    integration: {
      ...base.integration,
      list: vi.fn().mockResolvedValue(catalog),
      get: vi.fn(({ integrationID }) => Promise.resolve(catalog.find((item) => item.id === integrationID))),
      connect: { ...base.integration.connect, key: vi.fn().mockResolvedValue(undefined) },
      oauth: {
        ...base.integration.oauth,
        connect: vi.fn().mockResolvedValue(
          Integration.Attempt.make({
            attemptID: Integration.AttemptID.make("con_oauth"),
            url: "https://example.com/authorize",
            instructions: "Continue in the browser",
            mode: "code",
            time: { created: 1, expires: 2 },
          }),
        ),
        status: vi.fn().mockResolvedValue({ status: "pending", time: { created: 1, expires: 2 } }),
        complete: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
      command: {
        ...base.integration.command,
        connect: vi.fn().mockResolvedValue({
          attemptID: Integration.AttemptID.make("con_command"),
          time: { created: 1, expires: 2 },
        }),
        status: vi.fn().mockResolvedValue({ status: "pending", time: { created: 1, expires: 2 } }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    },
    credential: {
      activate: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    websearch: {
      ...base.websearch,
      providers: vi.fn().mockResolvedValue([
        { id: WebSearch.ID.make("exa"), name: "Exa" },
        { id: WebSearch.ID.make("parallel"), name: "Parallel" },
      ]),
    },
    ...overrides,
  }
}

function mount(
  value: ByMorningClient,
  initialIntegration?: IntegrationInfo,
  onChange?: (reason: ChangeReason) => void | Promise<unknown>,
  providerOnly = false,
  initialManagement?: boolean,
  role: "admin" | "member" = "admin",
): HTMLElement {
  vi.spyOn(ByMorning, "make").mockReturnValue(value)
  const current = WorkspaceAccess.Info.make({ ...workspace, role })
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <IntegrationDialog
              {...(initialIntegration ? { initialIntegration } : {})}
              {...(onChange ? { onChange } : {})}
              {...(providerOnly ? { providerOnly } : {})}
              {...(initialManagement === undefined ? {} : { initialManagement })}
            />
          ))
        }
      >
        Open integrations
      </button>
    )
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <SDKProvider>
        <DialogProvider>
          <WorkspaceScope list={[current]} current={current}>
            <IntegrationProvider>
              <Harness />
            </IntegrationProvider>
          </WorkspaceScope>
        </DialogProvider>
        <Toast.Region />
      </SDKProvider>
    </QueryClientProvider>
  ))
  return screen.getByRole("button", { name: "Open integrations" })
}

function menuItem(name: string) {
  return screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === name)!
}

describe("IntegrationDialog", () => {
  it("connects a Bedrock API key with its generated region configuration and clears the secret", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([bedrock])
    vi.mocked(value.integration.get).mockResolvedValue(bedrock)
    const connect = vi.mocked(value.integration.connect.key)
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Amazon Bedrock" }))
    await user.click(screen.getByRole("button", { name: "Bedrock API key" }))
    await user.type(await screen.findByLabelText("API key"), "bedrock-bearer-secret")
    expect(screen.getByRole("button", { name: "US East (N. Virginia)" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Connect" }))

    expect(connect).toHaveBeenCalledWith({
      scope: "workspace",
      integrationID: "amazon-bedrock",
      key: "bedrock-bearer-secret",
      answer: { region: "us-east-1" },
      configuration: { type: "aws-region", region: "us-east-1" },
      workspace: workspace.id,
    })
    expect(await screen.findByRole("heading", { name: "Saved Amazon Bedrock connection" })).toBeInTheDocument()
    expect(screen.queryByDisplayValue("bedrock-bearer-secret")).not.toBeInTheDocument()
  })

  it("validates and submits AWS access keys without retaining or revealing secrets", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([bedrock])
    vi.mocked(value.integration.get).mockResolvedValue(bedrock)
    const connect = vi.fn().mockResolvedValue(undefined)
    value.integration.connect.awsSigV4 = connect
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Amazon Bedrock" }))
    await user.click(screen.getByRole("button", { name: "AWS credentials" }))
    const submit = screen.getByRole("button", { name: "Connect" })
    expect(submit).toBeDisabled()
    expect(screen.getByLabelText("AWS access key ID")).toHaveAttribute("type", "password")
    await user.type(screen.getByLabelText("AWS access key ID"), "AKIA-DO-NOT-SHOW")
    await user.type(screen.getByLabelText("AWS secret access key"), "aws-secret")
    await user.type(screen.getByLabelText(/AWS session token/), "aws-session")
    await user.type(screen.getByLabelText(/^Label/), "Production")
    await user.click(submit)

    expect(connect).toHaveBeenCalledWith({
      scope: "workspace",
      integrationID: "amazon-bedrock",
      methodID: "bedrock-sigv4",
      accessKeyId: "AKIA-DO-NOT-SHOW",
      secretAccessKey: "aws-secret",
      sessionToken: "aws-session",
      region: "us-east-1",
      label: "Production",
      workspace: workspace.id,
    })
    expect(await screen.findByRole("heading", { name: "Saved Amazon Bedrock connection" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(document.body).not.toHaveTextContent("AKIA-DO-NOT-SHOW")
    expect(document.body).not.toHaveTextContent("aws-secret")
    expect(document.body).not.toHaveTextContent("aws-session")
  })

  it("projects saved and grouped environment Bedrock connections as redacted auth kind and region", async () => {
    const connected: IntegrationInfo = {
      ...bedrock,
      connections: [
        {
          type: "regional-credential",
          id: Credential.ID.make("cred_bedrock"),
          label: "Production",
          authKind: "sigv4",
          region: AwsRegion.make("us-west-2"),
        },
        { type: "regional-env", authKind: "bearer", region: AwsRegion.make("us-east-1") },
        { type: "regional-deployment", authKind: "sigv4", region: AwsRegion.make("eu-west-1") },
      ],
    }
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([connected])
    vi.mocked(value.integration.get).mockResolvedValue(connected)
    mount(value, connected)
    await userEvent.click(screen.getByRole("button", { name: "Open integrations" }))

    const saved = (await screen.findByText("Production")).closest("li")!
    expect(screen.getByRole("heading", { name: "Connected Keys" })).toBeInTheDocument()
    expect(saved).toHaveTextContent("AWS access keys · us-west-2")
    expect(saved).toHaveTextContent("Primary")
    expect(within(saved).getByText("Primary")).toHaveAttribute("data-component", "tag")
    expect(within(saved).getByText("Primary")).toHaveAttribute("data-variant", "neutral")
    const environment = screen.getByText("Bedrock API key · us-east-1").closest("li")!
    expect(environment).toHaveTextContent("Environment")
    expect(within(environment).queryByRole("button")).not.toBeInTheDocument()
    const deployment = screen.getByText("AWS deployment").closest("li")!
    expect(deployment).toHaveTextContent("AWS credential chain · eu-west-1")
    expect(within(deployment).queryByRole("button")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("AWS_ACCESS_KEY_ID")
    expect(document.body).not.toHaveTextContent("AWS_SESSION_TOKEN")
  })

  it("opens directly on an initial integration and renders its generic OAuth client fields", async () => {
    const initialIntegration: IntegrationInfo = {
      id: Integration.ID.make("google"),
      name: "Google",
      methods: [
        {
          id: Integration.MethodID.make("oauth"),
          type: "oauth",
          label: "Google OAuth",
          client: {
            fields: [
              { key: "client_id", type: "string", title: "Client ID", required: true },
              { key: "client_secret", type: "string", title: "Client secret", required: true, secret: true },
            ],
            configured: false,
          },
        },
      ],
      connections: [],
    }
    const value = client()
    value.integration.list = vi.fn().mockResolvedValue([initialIntegration])
    value.integration.get = vi.fn().mockResolvedValue(initialIntegration)
    const trigger = mount(value, initialIntegration)

    await userEvent.click(trigger)
    expect(await screen.findByRole("heading", { name: "Google" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Connected Keys" })).toBeInTheDocument()
    expect(screen.getByText("Not connected")).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Google" })).not.toBeInTheDocument()
    expect(screen.queryByText("Google OAuth", { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText(/OAuth client: Not configured/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add connection" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Configure Google OAuth OAuth client" })).toHaveTextContent(
      "Set up connection",
    )
    await userEvent.click(screen.getByRole("button", { name: "Configure Google OAuth OAuth client" }))
    expect(await screen.findByRole("textbox", { name: "Client ID" })).toBeInTheDocument()
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password")
    expect(value.integration.get).toHaveBeenCalledWith({
      integrationID: initialIntegration.id,
      workspace: workspace.id,
    })
  })

  it("configures an OAuth client with isolated password fields before offering connection", async () => {
    const user = userEvent.setup()
    const methodID = Integration.MethodID.make("oauth")
    const oauthClientIntegration = {
      id: Integration.ID.make("mail"),
      name: "Mail",
      methods: [
        {
          id: methodID,
          type: "oauth" as const,
          label: "Google OAuth",
          client: {
            fields: [
              { key: "client_id", type: "string" as const, title: "Client ID", required: true },
              {
                key: "client_secret",
                type: "string" as const,
                title: "Client secret",
                required: true,
                secret: true,
              },
            ] as const,
            configured: false,
          },
        },
      ],
      connections: [],
    }
    const configured = {
      ...oauthClientIntegration,
      methods: [
        {
          ...oauthClientIntegration.methods[0]!,
          client: { ...oauthClientIntegration.methods[0]!.client, configured: true },
        },
      ],
    }
    const value = client()
    const put = vi.fn().mockResolvedValue(undefined)
    value.integration.list = vi.fn().mockResolvedValueOnce([oauthClientIntegration]).mockResolvedValue([configured])
    value.integration.get = vi.fn().mockResolvedValueOnce(oauthClientIntegration).mockResolvedValue(configured)
    value.integration.oauth.client.put = put
    const trigger = mount(value)

    await user.click(trigger)
    await user.click(await screen.findByRole("option", { name: "Mail" }))
    const clientID = await screen.findByRole("textbox", { name: "Client ID" })
    const secret = screen.getByLabelText("Client secret")
    expect(secret).toHaveAttribute("type", "password")
    expect(secret).toHaveAttribute("autocomplete", "new-password")
    await user.type(clientID, "google-client")
    await user.type(secret, "google-secret")
    await user.click(screen.getByRole("button", { name: "Save OAuth client" }))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({
        integrationID: "mail",
        methodID: "oauth",
        answer: { client_id: "google-client", client_secret: "google-secret" },
        workspace: workspace.id,
      }),
    )
    expect(await screen.findByText("OAuth client saved.")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("google-secret")).not.toBeInTheDocument()
  })

  it("supports custom OAuth client selections and clears secrets after a rejected save", async () => {
    const user = userEvent.setup()
    const methodID = Integration.MethodID.make("tenant-oauth")
    const oauthClientIntegration: IntegrationInfo = {
      id: Integration.ID.make("tenant-mail"),
      name: "Tenant Mail",
      methods: [
        {
          id: methodID,
          type: "oauth",
          label: "Tenant OAuth",
          client: {
            configured: false,
            fields: [
              {
                key: "audiences",
                type: "multiselect",
                title: "Audiences",
                options: [{ value: "mail", label: "Mail" }],
                custom: true,
              },
              { key: "client_secret", type: "string", title: "Client secret", secret: true, required: true },
            ],
          },
        },
      ],
      connections: [],
    }
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([oauthClientIntegration])
    vi.mocked(value.integration.get).mockResolvedValue(oauthClientIntegration)
    value.integration.oauth.client.put = vi.fn().mockRejectedValueOnce({
      _tag: "InvalidRequestError",
      message: "Invalid OAuth client",
    })
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Tenant Mail" }))
    await user.click(screen.getByRole("checkbox", { name: "Mail" }))
    await user.type(screen.getByRole("textbox", { name: "Audiences custom values" }), "archive, reports")
    await user.type(screen.getByLabelText("Client secret"), "never-retain")
    await user.click(screen.getByRole("button", { name: "Save OAuth client" }))

    await waitFor(() =>
      expect(value.integration.oauth.client.put).toHaveBeenCalledWith({
        integrationID: "tenant-mail",
        methodID: "tenant-oauth",
        answer: { audiences: ["mail", "archive", "reports"], client_secret: "never-retain" },
        workspace: workspace.id,
      }),
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid OAuth client")
    expect(screen.getByRole("checkbox", { name: "Mail" })).toBeChecked()
    expect(screen.getByRole("textbox", { name: "Audiences custom values" })).toHaveValue("archive, reports")
    expect(screen.getByLabelText("Client secret")).toHaveValue("")
    expect(screen.queryByDisplayValue("never-retain")).not.toBeInTheDocument()
  })

  it("names selected-method OAuth client actions", async () => {
    const user = userEvent.setup()
    const methodID = Integration.MethodID.make("workspace-oauth")
    const configured: IntegrationInfo = {
      id: Integration.ID.make("workspace-mail"),
      name: "Workspace Mail",
      methods: [
        {
          id: methodID,
          type: "oauth",
          label: "Workspace OAuth",
          client: { configured: true, fields: [{ key: "client_id", type: "string", required: true }] },
        },
      ],
      connections: [],
    }
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([configured])
    vi.mocked(value.integration.get).mockResolvedValue(configured)
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Workspace Mail" }))
    expect(screen.getByRole("button", { name: "Replace Workspace OAuth client configuration" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Remove Workspace OAuth client configuration" })).toBeVisible()
  })

  it("keeps successful OAuth client removal visible with no connections and focuses Go back", async () => {
    const user = userEvent.setup()
    const methodID = Integration.MethodID.make("oauth")
    const configured: IntegrationInfo = {
      id: Integration.ID.make("empty-mail"),
      name: "Empty Mail",
      methods: [
        {
          id: methodID,
          type: "oauth",
          label: "Empty OAuth",
          client: { configured: true, fields: [{ key: "client_id", type: "string", required: true }] },
        },
      ],
      connections: [],
    }
    const removed: IntegrationInfo = {
      ...configured,
      methods: [
        {
          id: methodID,
          type: "oauth",
          label: "Empty OAuth",
          client: { configured: false, fields: [{ key: "client_id", type: "string", required: true }] },
        },
      ],
    }
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValueOnce([configured]).mockResolvedValue([removed])
    vi.mocked(value.integration.get).mockResolvedValueOnce(configured).mockResolvedValue(removed)
    value.integration.oauth.client.remove = vi.fn().mockResolvedValue(undefined)
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Empty Mail" }))
    await user.click(await screen.findByRole("button", { name: "Remove Empty OAuth client configuration" }))

    expect(
      await screen.findByText("OAuth client removed. Existing connections may require reconnection."),
    ).toBeVisible()
    expect(screen.getByText("Not connected")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Save OAuth client" })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus())
  })

  it("disables unavailable delete retries and focuses Back after OAuth client removal", async () => {
    const user = userEvent.setup()
    const methodID = Integration.MethodID.make("oauth")
    const configured: IntegrationInfo = {
      id: Integration.ID.make("mutable-mail"),
      name: "Mutable Mail",
      methods: [
        {
          id: methodID,
          type: "oauth",
          label: "Mutable OAuth",
          client: { configured: true, fields: [{ key: "client_id", type: "string", required: true }] },
        },
      ],
      connections: [],
    }
    const unavailable: IntegrationInfo = {
      ...configured,
      methods: [{ id: methodID, type: "oauth", label: "Mutable OAuth" }],
    }
    const removal = client()
    vi.mocked(removal.integration.list).mockResolvedValueOnce([configured]).mockResolvedValue([unavailable])
    vi.mocked(removal.integration.get).mockResolvedValueOnce(configured).mockResolvedValue(unavailable)
    removal.integration.oauth.client.remove = vi
      .fn()
      .mockRejectedValue({ _tag: "Protocol.InternalError", error: "unknown" })
    mount(removal)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Mutable Mail" }))
    await user.click(screen.getByRole("button", { name: "Remove Mutable OAuth client configuration" }))
    await user.click(await screen.findByRole("button", { name: "Refresh status" }))
    expect(await screen.findByText(/Current status is Unavailable/)).toBeVisible()
    const retry = screen.getByRole("button", { name: "Retry removal" })
    expect(retry).toBeDisabled()
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toHaveFocus())
  })

  it("opens with focus, groups live services, searches, wraps arrows, enters, escapes back, and restores focus", async () => {
    const user = userEvent.setup()
    const trigger = mount(client())
    await user.click(trigger)
    const search = await screen.findByRole("combobox", { name: "Search integrations" })
    await waitFor(() => expect(search).toHaveFocus())
    expect(screen.getByRole("dialog", { name: "Connect an integration" })).toBeInTheDocument()
    const shell = screen.getByRole("dialog").closest('[data-component="dialog"]')
    expect(shell?.querySelector(':scope > [data-slot="dialog-container"]')).toHaveAttribute(
      "data-component",
      "command-dialog",
    )
    expect(screen.getByRole("listbox", { name: "Connect an integration" })).toBeInTheDocument()
    expect(search.closest('[data-component="text-input"]')).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Services" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Web search" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Firecrawl" })).toHaveTextContent("Connected · Work")

    await user.type(search, "parallel")
    expect(screen.getByRole("option", { name: "Parallel" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Exa" })).not.toBeInTheDocument()
    fireEvent.keyDown(search, { key: "ArrowUp" })
    fireEvent.keyDown(document.activeElement!, { key: "Enter" })
    await screen.findByText("Add a key connection for Parallel.")
    expect(screen.getByRole("dialog").querySelector('[data-component="integration-dialog"]')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveFocus())

    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Search integrations" })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("opens the key form when a tenant Integration has no persisted connection", async () => {
    const user = userEvent.setup()
    mount(client())
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Exa" }))
    expect(await screen.findByText("Add a key connection for Exa.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveFocus())
  })

  it("shows environment connections as available and does not offer to remove them", async () => {
    const user = userEvent.setup()
    mount(client())
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    expect(await screen.findByRole("option", { name: "GitHub" })).toHaveTextContent("Connected · GITHUB_TOKEN")

    await user.click(screen.getByRole("option", { name: "GitHub" }))

    const connection = (await screen.findByText("GITHUB_TOKEN")).closest("li")!
    expect(connection).toHaveTextContent("Environment")
    expect(within(connection).queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument()
    expect(screen.getByText("This integration has no supported connection method.")).toBeInTheDocument()
  })

  it("shows catalog failures and retries in the command picker", async () => {
    const user = userEvent.setup()
    const value = client()
    const list = vi.mocked(value.integration.list)
    list.mockRejectedValueOnce(new Error("Catalog unavailable"))
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    expect(await screen.findByText("Catalog unavailable")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Try again"))

    expect(await screen.findByRole("option", { name: "Parallel" })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("connects a labeled key, reports success, refreshes, and displays failures", async () => {
    const user = userEvent.setup()
    const value = client()
    const key = vi.mocked(value.integration.connect.key)
    const list = vi.mocked(value.integration.list)
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Parallel" }))
    await user.type(await screen.findByLabelText("API key"), "secret")
    const keyInput = screen.getByLabelText("API key") as HTMLInputElement
    await user.type(screen.getByLabelText(/Label/), "Personal")
    expect(screen.getByLabelText("API key").closest('[data-component="field"]')).toBeInTheDocument()
    expect(screen.getByLabelText("API key").closest('[data-component="text-input"]')).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute("data-component", "button")
    expect(screen.getByLabelText("API key").parentElement?.parentElement).toHaveAttribute(
      "data-appearance",
      "full-width",
    )
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(await screen.findByRole("heading", { name: "Saved Parallel connection" })).toBeInTheDocument()
    expect(keyInput).toHaveValue("")
    expect(key).toHaveBeenCalledWith({
      scope: "workspace",
      integrationID: "parallel",
      key: "secret",
      label: "Personal",
      workspace: workspace.id,
    })
    expect(list).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(document.body).not.toHaveStyle({ "pointer-events": "none" }))
    key.mockRejectedValueOnce(new Error("Invalid key"))
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Parallel" }))
    await user.type(await screen.findByLabelText("API key"), "bad")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid key")
  })

  it("never offers Workspace scope to a member and connects a personal key", async () => {
    const user = userEvent.setup()
    const value = client()
    const key = vi.mocked(value.integration.connect.key)
    mount(value, undefined, undefined, false, undefined, "member")
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Parallel" }))
    expect(screen.queryByLabelText("Connection access")).not.toBeInTheDocument()
    expect(screen.getByText(/This connection belongs to you/)).toBeInTheDocument()
    await user.type(await screen.findByLabelText("API key"), "member-secret")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(await screen.findByRole("heading", { name: "Saved Parallel connection" })).toBeInTheDocument()
    expect(key).toHaveBeenCalledWith({
      scope: "member",
      integrationID: "parallel",
      key: "member-secret",
      workspace: workspace.id,
    })
  })

  it("submits active key-form answers with native values and external acknowledgment", async () => {
    const user = userEvent.setup()
    const value = client()
    const key = vi.mocked(value.integration.connect.key)
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Configured" }))
    await user.type(await screen.findByLabelText("API key"), "secret")

    const mode = screen.getByLabelText("Mode")
    await user.clear(mode)
    await user.type(mode, "advanced")
    await user.type(await screen.findByLabelText("Detail"), "temporary")
    await user.clear(mode)
    await user.type(mode, "basic")
    expect(screen.queryByLabelText("Detail")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Retries")).toHaveValue(2)
    expect(screen.getByRole("checkbox", { name: "Read" })).toBeChecked()
    await user.click(screen.getByRole("checkbox", { name: /Open and acknowledge/ }))
    await user.click(screen.getByRole("button", { name: "Connect" }))

    await screen.findByRole("heading", { name: "Saved Configured connection" })
    expect(screen.getByText(/has not been checked/)).toBeInTheDocument()
    expect(screen.queryByText("The connection is ready to use.")).not.toBeInTheDocument()
    expect(key).toHaveBeenCalledWith({
      scope: "workspace",
      integrationID: "configured",
      key: "secret",
      answer: { mode: "basic", retries: 2, enabled: false, scopes: ["read"], terms: true },
      workspace: workspace.id,
    })
  })

  it("explains a whitespace-only API key instead of silently ignoring it", async () => {
    const user = userEvent.setup()
    const value = client()
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Configured" }))
    await user.type(await screen.findByLabelText("API key"), "   ")
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an API key. Spaces alone are not a valid key.")
    expect(vi.mocked(value.integration.connect.key)).not.toHaveBeenCalled()
  })

  it("makes rejected code OAuth terminal, clears its code, and never shows a false connected state", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([trusted])
    vi.mocked(value.integration.get).mockResolvedValue(trusted)
    const connect = vi.mocked(value.integration.oauth.connect)
    const complete = vi.mocked(value.integration.oauth.complete)
    complete.mockRejectedValueOnce(new Error("Code rejected"))
    vi.mocked(value.integration.oauth.status).mockResolvedValueOnce({
      status: "failed",
      message: "Code rejected",
      time: { created: 1, expires: 2 },
    })
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Trusted Service" }))

    expect(await screen.findByText("Choose how to connect Trusted Service.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "API key" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Browser OAuth" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Trusted CLI" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "TRUSTED_TOKEN" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Browser OAuth" }))
    expect(await screen.findByText("Add an OAuth connection for Trusted Service.")).toBeInTheDocument()
    const region = screen.getByLabelText("Region")
    expect(region).toHaveValue("eu")
    await user.clear(region)
    await user.type(region, "us")
    await user.type(screen.getByLabelText(/Label/), "Work")
    await user.click(screen.getByRole("button", { name: "Connect" }))

    const authorize = await screen.findByRole("link", { name: "Authorize" })
    expect(authorize).toHaveAttribute("href", "https://example.com/authorize")
    expect(authorize).toHaveAttribute("data-variant", "primary")
    expect(screen.getByText("Continue in the browser")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Authorization code")).toHaveFocus())
    expect(connect.mock.calls[0]?.[0]).toEqual({
      scope: "workspace",
      integrationID: "trusted",
      methodID: "browser",
      answer: { region: "us" },
      label: "Work",
      workspace: workspace.id,
    })

    const code = screen.getByLabelText("Authorization code")
    await user.type(code, "bad")
    await user.click(screen.getByRole("button", { name: "Complete connection" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Code rejected")
    expect(code).toHaveValue("")
    expect(screen.queryByLabelText("Authorization code")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Connected Trusted Service" })).not.toBeInTheDocument()
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(
      { integrationID: "trusted", attemptID: "con_oauth", code: "bad", workspace: workspace.id },
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it("shows an accessible automatic OAuth wait and polls to completion", async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([automatic])
    vi.mocked(value.integration.get).mockResolvedValue(automatic)
    vi.mocked(value.integration.oauth.connect).mockResolvedValueOnce(
      Integration.Attempt.make({
        attemptID: Integration.AttemptID.make("con_auto"),
        url: "https://example.com/device",
        instructions: "Approve the device",
        mode: "auto",
        time: { created: 1, expires: 2 },
      }),
    )
    vi.mocked(value.integration.oauth.status).mockResolvedValueOnce({
      status: "complete",
      time: { created: 1, expires: 2 },
    })
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Automatic OAuth" }))
    await user.click(await screen.findByRole("button", { name: "Connect" }))

    expect(await screen.findByRole("link", { name: "Authorize" })).toHaveAttribute("data-variant", "primary")
    expect(await screen.findByRole("status")).toHaveTextContent("Waiting for authorization")
    await vi.advanceTimersByTimeAsync(1000)
    expect(await screen.findByRole("heading", { name: "Connected Automatic OAuth" })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it("shows command stderr exactly and handles terminal failure", async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([trusted])
    vi.mocked(value.integration.get).mockResolvedValue(trusted)
    vi.mocked(value.integration.command.status)
      .mockResolvedValueOnce({
        status: "pending",
        message: "line one\n  line two\n",
        time: { created: 1, expires: 2 },
      })
      .mockResolvedValueOnce({
        status: "failed",
        message: "command failed\n",
        time: { created: 1, expires: 2 },
      })
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Trusted Service" }))
    await user.click(await screen.findByRole("button", { name: "Trusted CLI" }))
    await user.type(screen.getByLabelText(/Label/), "CLI")
    const label = screen.getByLabelText(/Label/)
    await user.click(screen.getByRole("button", { name: "Run command" }))
    expect(label).toHaveValue("")

    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector('[data-slot="integration-dialog-progress"]')?.textContent).toBe(
      "line one\n  line two\n",
    )
    expect(vi.mocked(value.integration.command.connect).mock.calls[0]?.[0]).toEqual({
      scope: "workspace",
      integrationID: "trusted",
      methodID: "cli",
      label: "CLI",
      workspace: workspace.id,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await screen.findByRole("alert")).toHaveTextContent("command failed")
    vi.useRealTimers()
  })

  it("cancels a pending OAuth attempt on Escape and clears transient input", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([trusted])
    vi.mocked(value.integration.get).mockResolvedValue(trusted)
    const cancel = vi.mocked(value.integration.oauth.cancel)
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Trusted Service" }))
    await user.click(screen.getByRole("button", { name: "Browser OAuth" }))
    await user.click(screen.getByRole("button", { name: "Connect" }))
    const code = await screen.findByLabelText("Authorization code")
    await user.type(code, "temporary")

    fireEvent.keyDown(code, { key: "Escape" })
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Search integrations" })).toHaveFocus())
    expect(cancel.mock.calls[0]?.[0]).toEqual({
      integrationID: "trusted",
      attemptID: "con_oauth",
      workspace: workspace.id,
    })
    expect(code).toHaveValue("")
  })

  it("renames only persisted credential rows", async () => {
    const user = userEvent.setup()
    const value = client()
    const update = vi.mocked(value.credential.update)
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Rename")).toBeInTheDocument())
    await user.click(menuItem("Rename"))
    const input = screen.getByRole("textbox", { name: "Rename Work" })
    await waitFor(() => expect(input).toHaveFocus())
    await user.clear(input)
    await user.type(input, "Team")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ credentialID: "cred_1", label: "Team", workspace: workspace.id }),
    )
    expect(await screen.findByRole("status")).toHaveTextContent("Connection renamed")
    expect(screen.getByRole("status")).not.toHaveTextContent("Connection removed")
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Work" })).toHaveFocus())
  })

  it("reports a rename as a directory-only change", async () => {
    const user = userEvent.setup()
    const value = client()
    const onChange = vi.fn()
    mount(value, undefined, onChange)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Rename")).toBeInTheDocument())
    await user.click(menuItem("Rename"))
    const input = screen.getByRole("textbox", { name: "Rename Work" })
    await user.clear(input)
    await user.type(input, "Team")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith("rename")
  })

  it("reports a key connect as a model-affecting change", async () => {
    const user = userEvent.setup()
    const value = client()
    const onChange = vi.fn()
    mount(value, undefined, onChange)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Exa" }))
    await user.type(await screen.findByLabelText("API key"), "exa-secret")
    await user.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith("connect")
  })

  it("reports a disconnect as a model-affecting change", async () => {
    const user = userEvent.setup()
    const value = client()
    const onChange = vi.fn()
    mount(value, undefined, onChange)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Remove connection")).toBeInTheDocument())
    await user.click(menuItem("Remove connection"))
    await user.click(
      within(await screen.findByRole("dialog", { name: "Remove connection?" })).getByRole("button", { name: "Remove" }),
    )

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith("disconnect")
  })

  it("asks before removing a connection and keeps it when cancelled", async () => {
    const user = userEvent.setup()
    const value = client()
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Remove connection")).toBeInTheDocument())
    await user.click(menuItem("Remove connection"))
    const confirm = await screen.findByRole("dialog", { name: "Remove connection?" })
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove connection?" })).not.toBeInTheDocument())
    expect(value.credential.remove).not.toHaveBeenCalled()
  })

  it("reports an activation as a directory-only change", async () => {
    const user = userEvent.setup()
    const value = client()
    const personal = { type: "credential" as const, id: Credential.ID.make("cred_personal"), label: "Personal" }
    const work = { type: "credential" as const, id: Credential.ID.make("cred_work"), label: "Work" }
    const before = { ...catalog[2]!, connections: [personal, work] }
    const after = { ...before, connections: [work, personal] }
    vi.mocked(value.integration.list).mockResolvedValue([before])
    vi.mocked(value.integration.get).mockResolvedValueOnce(before).mockResolvedValue(after)
    const onChange = vi.fn()
    mount(value, undefined, onChange)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Work" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Make primary")).toBeInTheDocument())
    await user.click(menuItem("Make primary"))

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith("activate")
  })

  it("cancels credential rename and restores the selected action trigger", async () => {
    const user = userEvent.setup()
    const value = client()
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Rename")).toBeInTheDocument())
    await user.click(menuItem("Rename"))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Rename Work" })).toHaveFocus())
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Work" })).toHaveFocus())
    expect(screen.queryByRole("textbox", { name: "Rename Work" })).not.toBeInTheDocument()
    expect(value.credential.update).not.toHaveBeenCalled()
  })

  it("keeps a failed credential rename in its editor", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.credential.update).mockRejectedValueOnce(new Error("Rename unavailable"))
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await user.click(await screen.findByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Rename")).toBeInTheDocument())
    await user.click(menuItem("Rename"))
    const input = screen.getByRole("textbox", { name: "Rename Work" })
    await user.clear(input)
    await user.type(input, "Team")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Rename unavailable")
    expect(input).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Actions for Work" })).not.toBeInTheDocument()
  })

  it("marks the first credential active and switches to another saved account", async () => {
    const user = userEvent.setup()
    const value = client()
    const personal = { type: "credential" as const, id: Credential.ID.make("cred_personal"), label: "Personal" }
    const work = { type: "credential" as const, id: Credential.ID.make("cred_work"), label: "Work" }
    const before = { ...catalog[2]!, connections: [personal, work] }
    const after = { ...before, connections: [work, personal] }
    vi.mocked(value.integration.list).mockResolvedValue([before])
    vi.mocked(value.integration.get).mockResolvedValueOnce(before).mockResolvedValue(after)
    const activate = vi.mocked(value.credential.activate)
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    const personalRow = (await screen.findByText("Personal")).closest("li")!
    const workRow = screen.getByText("Work").closest("li")!
    expect(personalRow).toHaveTextContent("Primary")
    expect(within(personalRow).getByRole("button", { name: "Personal Primary" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getAllByRole("button", { name: /^Actions for/ })).toHaveLength(1)
    const personalActions = screen.getByRole("button", { name: "Actions for Personal" })
    expect(screen.queryByText("Actions for Personal")).not.toBeInTheDocument()
    await user.click(personalActions)
    expect(menuItem("Make primary")).toHaveAttribute("data-disabled")
    const menu = screen.getByRole("menu", { hidden: true })
    fireEvent.animationStart(menu)
    await user.keyboard("{Escape}")
    fireEvent.animationEnd(menu)
    await waitFor(() => expect(personalActions).toHaveFocus())

    within(workRow).getByRole("button", { name: "Work" }).focus()
    await user.keyboard("{Enter}")
    expect(within(workRow).getByRole("button", { name: "Work" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Make primary")).toBeInTheDocument())
    await user.click(menuItem("Make primary"))
    await waitFor(() => expect(screen.getByText("Work").closest("li")).toHaveTextContent("Primary"))
    expect(activate).toHaveBeenCalledWith({ credentialID: "cred_work", workspace: workspace.id })
    expect(screen.getByRole("status")).toHaveTextContent("Active connection changed")
    expect(screen.getByRole("button", { name: "Add connection" })).toBeInTheDocument()
  })

  it("keeps one selected action control in its connection row", async () => {
    const connections = Array.from({ length: 31 }, (_, index) => ({
      type: "credential" as const,
      id: Credential.ID.make(`cred_${index}`),
      label: `Connection ${index + 1}`,
    }))
    const connected = {
      ...catalog[2]!,
      connections: [...connections, { type: "env" as const, name: "FIRECRAWL_API_KEY" }],
    }
    const value = client()
    vi.mocked(value.integration.list).mockResolvedValue([connected])
    vi.mocked(value.integration.get).mockResolvedValue(connected)
    mount(value, connected)

    await userEvent.click(screen.getByRole("button", { name: "Open integrations" }))
    const rows = await screen.findAllByRole("listitem")
    expect(rows).toHaveLength(32)
    expect(screen.getByRole("button", { name: "Connection 1 Primary" })).toHaveAttribute("aria-pressed", "true")
    expect(within(screen.getByText("FIRECRAWL_API_KEY").closest("li")!).queryByRole("button")).not.toBeInTheDocument()
    const trigger = screen.getByRole("button", { name: "Actions for Connection 1" })
    expect(trigger.closest("li")).toBe(screen.getByText("Connection 1").closest("li"))
    expect(trigger.closest('[data-slot="dialog-footer"]')).not.toBeInTheDocument()
  })

  it("marks the newest remaining account active after disconnecting the active account", async () => {
    const user = userEvent.setup()
    const value = client()
    const personal = { type: "credential" as const, id: Credential.ID.make("cred_personal"), label: "Personal" }
    const work = { type: "credential" as const, id: Credential.ID.make("cred_work"), label: "Work" }
    const before = { ...catalog[2]!, connections: [personal, work] }
    const after = { ...before, connections: [work] }
    vi.mocked(value.integration.list).mockResolvedValue([before])
    vi.mocked(value.integration.get).mockResolvedValueOnce(before).mockResolvedValue(after)
    mount(value)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    const personalRow = (await screen.findByText("Personal")).closest("li")!
    await user.click(screen.getByRole("button", { name: "Actions for Personal" }))
    await waitFor(() => expect(menuItem("Remove connection")).toBeInTheDocument())
    await user.click(menuItem("Remove connection"))
    await user.click(
      within(await screen.findByRole("dialog", { name: "Remove connection?" })).getByRole("button", { name: "Remove" }),
    )

    await waitFor(() => expect(screen.getByText("Work").closest("li")).toHaveTextContent("Primary"))
    expect(screen.queryByText("Personal")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actions for Work" })).toBeInTheDocument()
    expect(value.credential.remove).toHaveBeenCalledWith({
      credentialID: "cred_personal",
      workspace: workspace.id,
    })
  })

  it("keeps disconnect success visible in management after the last persisted credential disappears", async () => {
    const user = userEvent.setup()
    const value = client()
    const remove = vi.mocked(value.credential.remove)
    const list = vi.mocked(value.integration.list)
    vi.mocked(value.integration.get)
      .mockResolvedValueOnce(catalog[2]!)
      .mockResolvedValueOnce({ ...catalog[2]!, connections: [] })
    mount(value)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("option", { name: "Firecrawl" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus())
    await screen.findByText("Work")
    await user.click(screen.getByRole("button", { name: "Actions for Work" }))
    await waitFor(() => expect(menuItem("Remove connection")).toBeInTheDocument())
    await user.click(menuItem("Remove connection"))
    await user.click(
      within(await screen.findByRole("dialog", { name: "Remove connection?" })).getByRole("button", { name: "Remove" }),
    )
    expect(await screen.findByRole("status")).toHaveTextContent("Connection removed")
    expect(screen.getByText("Not connected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add connection" })).toBeInTheDocument()
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument()
    expect(remove).toHaveBeenCalledWith({ credentialID: "cred_1", workspace: workspace.id })
    expect(list).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove connection?" })).not.toBeInTheDocument())

    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Search integrations" })).toHaveFocus())
  })
})

describe("Integration connection ownership", () => {
  it("keeps Provider connection scope internal and uses the standard dialog footer", async () => {
    const user = userEvent.setup()
    const value = client()
    vi.mocked(value.integration.get).mockResolvedValue(catalog[0])
    mount(value, catalog[0], undefined, true, false)

    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    const dialog = await screen.findByRole("dialog", { name: "Connect Exa" })
    expect(dialog).toHaveAttribute("data-size", "normal")
    expect(within(dialog).queryByLabelText("Connection access")).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/^Label/)).not.toBeInTheDocument()
    expect(within(dialog).queryByText("Workspace connection")).not.toBeInTheDocument()
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    const connect = within(dialog).getByRole("button", { name: "Connect" })
    expect(cancel).toHaveAttribute("data-variant", "ghost")
    expect(cancel.closest('[data-slot="dialog-footer"]')).toBeInTheDocument()
    expect(connect).toBeDisabled()

    await user.type(within(dialog).getByLabelText("API key"), "provider-key")
    await user.click(connect)
    expect(value.integration.connect.key).toHaveBeenCalledWith({
      integrationID: "exa",
      key: "provider-key",
      scope: "workspace",
      workspace: workspace.id,
    })
  })

  it("does not expose saved connection ownership in Provider management", async () => {
    const connected: IntegrationInfo = {
      ...catalog[0]!,
      connections: [
        {
          type: "credential",
          id: Credential.ID.make("cred_shared"),
          label: "Shared key",
          scope: "workspace",
          active: true,
        },
      ],
    }
    const value = client()
    vi.mocked(value.integration.get).mockResolvedValue(connected)
    mount(value, connected, undefined, true)

    await userEvent.click(screen.getByRole("button", { name: "Open integrations" }))
    const row = (await screen.findByText("Shared key")).closest("li")!
    expect(row).not.toHaveTextContent("Workspace connection")
    expect(row).not.toHaveTextContent("Your connection")
  })

  it("does not describe OAuth client setup as workspace-scoped in the Provider flow", async () => {
    const provider: IntegrationInfo = {
      id: Integration.ID.make("provider-oauth"),
      name: "Provider OAuth",
      methods: [
        {
          id: Integration.MethodID.make("oauth"),
          type: "oauth",
          label: "Provider OAuth",
          client: {
            configured: false,
            fields: [{ key: "client_id", type: "string", title: "Client ID", required: true }],
          },
        },
      ],
      connections: [],
    }
    const value = client()
    vi.mocked(value.integration.get).mockResolvedValue(provider)
    mount(value, provider, undefined, true, false)

    await userEvent.click(screen.getByRole("button", { name: "Open integrations" }))
    expect(await screen.findByRole("textbox", { name: "Client ID" })).toBeVisible()
    expect(screen.queryByText("Shared with your workspace. Saved credentials stay hidden.")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Connection access")).not.toBeInTheDocument()
  })

  it("keeps workspace as the default and submits a personal key when selected", async () => {
    const user = userEvent.setup()
    const value = client()
    mount(value, catalog[0])
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("button", { name: "Add connection" }))
    expect(screen.getByRole("combobox", { name: "Connection access" })).toHaveValue("workspace")
    await user.selectOptions(screen.getByRole("combobox", { name: "Connection access" }), "member")
    await user.type(screen.getByLabelText("API key"), "personal-key")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(value.integration.connect.key).toHaveBeenCalledWith({
      integrationID: "exa",
      key: "personal-key",
      scope: "member",
      workspace: workspace.id,
    })
  })

  it("connects member-only OAuth personally without offering a scope selector", async () => {
    const user = userEvent.setup()
    const value = client()
    const personal: IntegrationInfo = { ...automatic, connectionPolicy: "member-only" }
    vi.mocked(value.integration.get).mockResolvedValue(personal)
    mount(value, personal)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    await user.click(await screen.findByRole("button", { name: "Add connection" }))
    expect(screen.queryByRole("combobox", { name: "Connection access" })).not.toBeInTheDocument()
    expect(screen.getByText("This connection belongs to you. Each teammate connects their own account.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(vi.mocked(value.integration.oauth.connect).mock.calls[0]?.[0]).toEqual({
      integrationID: "automatic",
      methodID: "auto",
      scope: "member",
      workspace: workspace.id,
    })
  })

  it("shows the active selection independently for personal and workspace connections", async () => {
    const user = userEvent.setup()
    const value = client()
    const connected: IntegrationInfo = {
      ...catalog[0]!,
      connections: [
        {
          type: "credential",
          id: Credential.ID.make("cred_personal"),
          label: "Personal key",
          scope: "member",
          active: true,
        },
        {
          type: "credential",
          id: Credential.ID.make("cred_shared"),
          label: "Shared key",
          scope: "workspace",
          active: true,
        },
        {
          type: "credential",
          id: Credential.ID.make("cred_other"),
          label: "Other key",
          scope: "workspace",
          active: false,
        },
      ],
    }
    vi.mocked(value.integration.get).mockResolvedValue(connected)
    mount(value, connected)
    await user.click(screen.getByRole("button", { name: "Open integrations" }))
    const personal = (await screen.findByText("Personal key")).closest("li")!
    const shared = screen.getByText("Shared key").closest("li")!
    const other = screen.getByText("Other key").closest("li")!
    expect(personal).toHaveTextContent("Your connection")
    expect(shared).toHaveTextContent("Workspace connection")
    expect(within(personal).getByText("Primary")).toBeVisible()
    expect(within(shared).getByText("Primary")).toBeVisible()
    expect(within(other).queryByText("Primary")).not.toBeInTheDocument()
  })
})
