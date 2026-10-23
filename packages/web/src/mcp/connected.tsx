import type { IntegrationInfo } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import { useNavigate } from "@solidjs/router"
import type { Workspace } from "@bymorning/schema/workspace"
import { createEffect, createMemo, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"

import { CommandDialog } from "../app/command-dialog"
import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useIntegration } from "../context/integration"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { IntegrationDialog } from "../integration/dialog/dialog"
import { createProviderCatalog } from "../integration/providers/model"
import { useScope } from "../runtime/server/runtime"
import { ActionMenu } from "../ui/components/action-menu"
import { Button } from "../ui/components/button"
import { Catalog, CatalogBody, CatalogCopy, CatalogRow, CatalogTrigger } from "../ui/components/catalog"
import { Empty } from "../ui/components/empty"
import { Tag } from "../ui/components/tag"
import { showToast } from "../ui/components/toast"
import { postCommit } from "../utils/post-commit"
import { WorkspaceRoutePath, workspaceRouteHref } from "../workspace-route-paths"
import { MCPAddDialog } from "./add-dialog"
import { MCPAuthorizeDialog } from "./authorize-dialog"
import { MCPValuesDialog } from "./values-dialog"
import type { MCPServer } from "./server-actions"
import { ServerMenu } from "./server-menu"

/** One row of the connected list: a plugin Integration, a web search provider, or an outbound MCP server. */
type Connected =
  | { readonly kind: "service" | "websearch"; readonly key: string; readonly item: IntegrationInfo }
  | { readonly kind: "mcp"; readonly key: string; readonly server: MCPServer }

const kindLabel = { service: "Service", websearch: "Web search", mcp: "MCP server" } as const

const serverStatus = {
  connected: "Connected",
  pending: "Connecting",
  disabled: "Disabled",
  failed: "Failed",
  needs_auth: "Authentication required",
} as const

/**
 * Everything this Workspace connects to that is not a model Provider. Model
 * Providers are managed on the Models page; their Integrations are excluded
 * here so each credential has one home. Only connected entries are listed;
 * "Add integration" offers the rest plus a custom MCP server.
 */
export function ConnectedSection(): JSX.Element {
  const sdk = useSDK()
  const scope = useScope()
  const dialog = useDialog()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const integration = useIntegration()
  const servers = useData().workspace.mcpServer
  const resource = new AbortController()
  let disposed = false
  onCleanup(() => {
    disposed = true
    resource.abort()
  })
  const providers = createProviderCatalog({ api: scope.api, workspace: scope.workspace, signal: resource.signal })

  onMount(() => {
    void integration.refetch()
    void providers.sync().catch(() => undefined)
    void servers.sync().catch(() => undefined)
  })

  const refreshServers = () =>
    postCommit(() => {
      servers.invalidate()
      void servers.sync().catch(() => undefined)
    })

  /** Integration IDs that belong to model Providers, which the Models page owns. */
  const providerIntegrations = createMemo(() => {
    const ids = new Set<string>()
    for (const entry of providers.directory()) if (entry.integration) ids.add(entry.integration.id)
    return ids
  })
  const websearchIDs = createMemo(() => {
    const catalog = integration.websearch()
    return new Set(catalog.state === "ready" ? catalog.data.map((provider) => Integration.ID.make(provider.id)) : [])
  })
  const integrations = createMemo(() => {
    const state = integration.list()
    if (state.state !== "ready") return []
    return state.data.filter((item) => !providerIntegrations().has(item.id) && !item.id.startsWith("mcp-"))
  })
  const kindOf = (item: IntegrationInfo): "service" | "websearch" =>
    websearchIDs().has(item.id) ? "websearch" : "service"
  const isConnected = (item: IntegrationInfo) =>
    item.connections.length > 0 || item.methods.some((method) => method.type === "oauth" && method.client?.configured)
  const canManage = (item: IntegrationInfo) =>
    workspace.current().role === "admin" || item.connectionPolicy === "member-only"
  const canConnect = (item: IntegrationInfo) =>
    canManage(item) && item.methods.some((method) => method.type !== "env" && method.type !== "env-group")

  const title = (row: Connected) => (row.kind === "mcp" ? row.server.name : row.item.name)

  const connected = createMemo<ReadonlyArray<Connected>>(() => {
    const services: Connected[] = integrations()
      .filter(isConnected)
      .map((item) => ({ kind: kindOf(item), key: `integration:${item.id}`, item }))
    const mcp: Connected[] = (servers.list() ?? []).map((server) => ({
      kind: "mcp",
      key: `mcp:${server.name}`,
      server,
    }))
    return [...services, ...mcp].sort((a, b) => title(a).localeCompare(title(b)))
  })

  const ready = () =>
    integration.list().state === "ready" &&
    integration.websearch().state === "ready" &&
    providers.state().state !== "loading"
  const error = () => {
    const list = integration.list()
    const websearch = integration.websearch()
    const server = servers.state()
    if (list.state === "error") return list.message
    if (websearch.state === "error") return websearch.message
    if (server.state === "error") return server.message ?? "Could not load MCP servers."
    return undefined
  }
  createEffect(
    on(error, (message) => {
      if (!message) return
      showToast({
        variant: "error",
        title: message,
        actions: [
          {
            label: "Try again",
            onClick: () => {
              void integration.refetch()
              refreshServers()
            },
          },
        ],
      })
    }),
  )

  // Dialogs belong to this stable owner: refreshing lists replaces row owners.
  const manage = (item: IntegrationInfo, management = isConnected(item)) =>
    dialog.show(() => (
      <IntegrationDialog
        initialIntegration={item}
        initialManagement={management}
        providerOnly={item.connectionPolicy !== "member-only"}
        onChange={() => integration.refetch()}
      />
    ))
  const authenticate = async (server: MCPServer) => {
    if (server.integrationID === undefined) throw new Error("MCP OAuth integration is unavailable")
    const integrationID = Integration.ID.make(server.integrationID)
    dialog.show(() =>
      server.auth === "values" ? (
        <MCPValuesDialog name={server.name} integrationID={integrationID} onComplete={refreshServers} />
      ) : (
        <MCPAuthorizeDialog name={server.name} integrationID={integrationID} onComplete={refreshServers} />
      ),
    )
  }
  const remove = async (server: MCPServer, target: Workspace.ID) => {
    await sdk.client.mcp.servers.remove({ server: server.name, workspace: target })
    if (!disposed && workspace.current().id === target) refreshServers()
  }
  const addServer = () => {
    const target = workspace.current().id
    const client = sdk.client
    dialog.show(() => (
      <MCPAddDialog
        onSubmit={({ name, ...server }) =>
          client.mcp.servers.put({ server: name, ...server, workspace: target }).then(() => {
            if (disposed || workspace.current().id !== target) return
            refreshServers()
          })
        }
      />
    ))
  }

  /** Presets not yet connected, grouped by kind, then the custom MCP server entry. */
  const available = createMemo(() => {
    const presets = integrations()
      .filter((item) => !isConnected(item) && canConnect(item))
      .map((item) => ({
        id: `integration:${item.id}`,
        title: item.name,
        description: item.id,
        category: kindLabel[kindOf(item)],
        onSelect: () => manage(item, false),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    const custom =
      workspace.current().role === "admin"
        ? [
            {
              id: "mcp:custom",
              title: "MCP server",
              description: "Connect any Streamable HTTP MCP server by name and URL",
              category: "Custom",
              onSelect: addServer,
            },
          ]
        : []
    return [...presets, ...custom]
  })
  const canAdd = () => available().length > 0
  const add = () =>
    dialog.show(() => (
      <CommandDialog
        label="Add integration"
        placeholder="Search integrations"
        options={available}
        initialLimit={null}
        empty={
          <Switch>
            <Match when={!ready()}>
              <span role="status">Loading integrations…</span>
            </Match>
            <Match when={true}>No integrations match your search.</Match>
          </Switch>
        }
      />
    ))

  return (
    <section data-slot="mcp-servers" aria-labelledby="connected-title">
      <div data-slot="mcp-section-heading">
        <div>
          <h2 id="connected-title">Connected</h2>
          <p>
            Services, web search providers, and outbound MCP servers this Workspace uses. Model Providers are managed on
            the Models page.
          </p>
        </div>
        <Show when={ready() && canAdd()}>
          <Button type="button" variant="primary" size="small" icon="central-plus-small" onClick={add}>
            Add integration
          </Button>
        </Show>
      </div>
      <Switch>
        <Match when={!ready() && connected().length === 0}>
          <p role="status">Loading…</p>
        </Match>
        <Match when={connected().length === 0}>
          <Empty>Nothing connected yet</Empty>
        </Match>
        <Match when={true}>
          <Catalog aria-label="Connected integrations">
            <For each={connected()}>
              {(row) => (
                <CatalogRow>
                  <Switch>
                    <Match when={row.kind === "mcp"}>
                      <MCPRow
                        server={(row as Extract<Connected, { kind: "mcp" }>).server}
                        onRefresh={refreshServers}
                        onRemove={remove}
                        onAuthenticate={authenticate}
                      />
                    </Match>
                    <Match when={row.kind !== "mcp"}>
                      <ServiceRow
                        item={(row as Extract<Connected, { kind: "service" | "websearch" }>).item}
                        kind={row.kind as "service" | "websearch"}
                        canManage={canManage}
                        onManage={manage}
                      />
                    </Match>
                  </Switch>
                </CatalogRow>
              )}
            </For>
          </Catalog>
        </Match>
      </Switch>
    </section>
  )
}

function MCPRow(props: {
  readonly server: MCPServer
  readonly onRefresh: () => void
  readonly onRemove: (server: MCPServer, workspace: Workspace.ID) => Promise<unknown>
  readonly onAuthenticate: (server: MCPServer) => Promise<unknown>
}): JSX.Element {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const target = workspace.current().id
  return (
    <>
      <CatalogTrigger
        aria-label={`View tools for ${props.server.name}`}
        onClick={() =>
          navigate(
            workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.mcpDetail).replace(
              ":server",
              encodeURIComponent(props.server.name),
            ),
          )
        }
      >
        <CatalogCopy
          title={props.server.name}
          description={props.server.url}
          {...(props.server.status === "failed" ? { error: props.server.error } : {})}
        />
        <span data-slot="connected-tags">
          <Tag data-slot="connected-status" data-status={props.server.status}>
            {serverStatus[props.server.status]}
          </Tag>
          <Tag>{kindLabel.mcp}</Tag>
        </span>
      </CatalogTrigger>
      <ServerMenu
        server={props.server}
        onRefresh={() => {
          if (workspace.current().id === target) props.onRefresh()
        }}
        onRemove={() => props.onRemove(props.server, target)}
        onAuthenticate={() => props.onAuthenticate(props.server)}
        canRemove={workspace.current().role === "admin"}
      />
    </>
  )
}

function ServiceRow(props: {
  readonly item: IntegrationInfo
  readonly kind: "service" | "websearch"
  readonly canManage: (item: IntegrationInfo) => boolean
  readonly onManage: (item: IntegrationInfo) => void
}): JSX.Element {
  const connections = () => props.item.connections.length
  const client = () => props.item.methods.some((method) => method.type === "oauth" && method.client?.configured)
  return (
    <>
      <CatalogBody>
        <CatalogCopy
          title={props.item.name}
          description={`${connections()} ${connections() === 1 ? "connection" : "connections"}${
            client() ? " · OAuth client configured" : ""
          }`}
        />
        <span data-slot="connected-tags">
          <Tag>{kindLabel[props.kind]}</Tag>
        </span>
      </CatalogBody>
      <Show when={props.canManage(props.item)}>
        <ActionMenu label={props.item.name}>
          <ActionMenu.Item onSelect={() => props.onManage(props.item)}>Manage connections</ActionMenu.Item>
        </ActionMenu>
      </Show>
    </>
  )
}
