import type { McpServersListOutput, McpToolsListOutput } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import type { Workspace } from "@bymorning/schema/workspace"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { copyToClipboard } from "../ui/clipboard"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { Field } from "../ui/components/field"
import { Icon } from "../ui/components/icon"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"
import { Switch as Toggle } from "../ui/components/switch"
import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import { WorkspaceRoutePath, workspaceRouteHref } from "../workspace-route-paths"
import { postCommit } from "../utils/post-commit"
import { MCPAuthorizeDialog } from "./authorize-dialog"
import { MCPValuesDialog } from "./values-dialog"
import { MCPMembers } from "./members"
import { ServerMenu } from "./server-menu"
import "./route.css"

type MCPTool = McpToolsListOutput[number]
type MCPServer = McpServersListOutput[number]
type ActivationInput = {
  readonly workspace: Workspace.ID
  readonly server: MCPServer
  readonly enabled: boolean
}
const permissionOptions = ["allow", "ask", "deny"] as const
type PermissionEffect = (typeof permissionOptions)[number]

/** Show the Tools currently discovered from one outbound MCP server. */
export function MCPDetail(): JSX.Element {
  const params = useParams<{ server: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const dialog = useDialog()
  const workspace = useWorkspace()
  const data = useData().workspace
  const [state, setState] = createStore<{
    search: string
    permissions: Record<string, PermissionEffect>
    permissionsLoaded: boolean
  }>({ search: "", permissions: {}, permissionsLoaded: false })
  const serverName = () => params.server
  const server = () => data.mcpServer.list()?.find((item) => item.name === serverName())
  const tools = () => data.mcpTool.list()?.filter((tool) => tool.server === serverName()) ?? []
  const filtered = () => {
    const query = state.search.trim().toLocaleLowerCase()
    return query === ""
      ? tools()
      : tools().filter((tool) => `${tool.name} ${tool.description ?? ""}`.toLocaleLowerCase().includes(query))
  }
  const toolError = () => {
    const current = data.mcpTool.state()
    return current.state === "error" ? current.message : undefined
  }
  const serverError = () => {
    const current = data.mcpServer.state()
    return current.state === "error" ? current.message : undefined
  }
  const mcpHref = () => workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.mcp)
  const back = () => navigate(mcpHref())
  const canEdit = () => workspace.current().role === "admin"
  let disposed = false

  onCleanup(() => {
    disposed = true
  })

  const refresh = () =>
    postCommit(() => {
      data.mcpServer.invalidate()
      data.mcpTool.invalidate()
      void Promise.all([data.mcpServer.sync(), data.mcpTool.sync()]).catch(() => undefined)
    })

  const remove = async (selected: MCPServer) => {
    const scope = workspace.current().id
    await sdk.client.mcp.servers.remove({ server: selected.name, workspace: scope })
    if (disposed || workspace.current().id !== scope) return
    back()
    refresh()
  }

  const authenticate = async (selected: MCPServer) => {
    if (selected.integrationID === undefined) throw new Error("MCP OAuth integration is unavailable")
    const integrationID = Integration.ID.make(selected.integrationID)
    dialog.show(() =>
      selected.auth === "values" ? (
        <MCPValuesDialog name={selected.name} integrationID={integrationID} onComplete={refresh} />
      ) : (
        <MCPAuthorizeDialog name={selected.name} integrationID={integrationID} onComplete={refresh} />
      ),
    )
  }

  const syncPermissions = async () => {
    const scope = workspace.current().id
    try {
      const permissions = await sdk.client.permission.tools.list({ workspace: scope })
      if (disposed || workspace.current().id !== scope) return
      setState({
        permissions: Object.fromEntries(permissions.map((item) => [item.action, item.effect])),
        permissionsLoaded: true,
      })
    } catch (cause) {
      if (!disposed && workspace.current().id === scope)
        showToast({
          variant: "error",
          title: errorMessage(cause, "Could not load Tool permissions."),
          actions: [{ label: "Try again", onClick: () => void syncPermissions() }],
        })
    }
  }

  const updateActivation = async (input: ActivationInput) => {
    try {
      await sdk.client.mcp.servers.update({
        workspace: input.workspace,
        server: input.server.name,
        enabled: input.enabled,
      })
      if (disposed || workspace.current().id !== input.workspace) return false
      data.mcpServer.invalidate()
      data.mcpTool.invalidate()
      await Promise.all([data.mcpServer.sync(), data.mcpTool.sync()])
      return !disposed && workspace.current().id === input.workspace
    } catch (cause) {
      if (!disposed && workspace.current().id === input.workspace) {
        // Reconcile an uncertain write from server authority without replaying it.
        data.mcpServer.invalidate()
        data.mcpTool.invalidate()
        await Promise.all([data.mcpServer.sync(), data.mcpTool.sync()]).catch(() => undefined)
      }
      throw cause
    }
  }

  const updatePermission = async (tool: MCPTool, effect: PermissionEffect) => {
    if (!canEdit()) return
    const scope = workspace.current().id
    const permissions = await sdk.client.permission.tools.update({
      workspace: scope,
      tools: [{ action: tool.action, effect }],
    })
    if (disposed || workspace.current().id !== scope) return
    setState("permissions", tool.action, permissions.find((item) => item.action === tool.action)?.effect ?? effect)
  }

  onMount(() => {
    void Promise.all([data.mcpServer.sync(), data.mcpTool.sync(), syncPermissions()]).catch(() => undefined)
  })

  return (
    <Switch>
      <Match when={server()}>
        {(selected) => (
          <WorkspacePage
            title={selected().name}
            heading={<MCPBreadcrumb href={mcpHref()} server={selected().name} />}
            description={toolDescription(
              selected().url,
              data.mcpTool.list() === undefined ? undefined : tools().length,
            )}
            layout="table"
            actions={
              <div data-slot="mcp-detail-actions">
                <ActivationSwitch
                  server={selected()}
                  workspace={workspace.current().id}
                  canEdit={canEdit()}
                  onToggle={updateActivation}
                />
                <ServerMenu
                  server={selected()}
                  onRefresh={refresh}
                  onRemove={() => remove(selected())}
                  onAuthenticate={() => authenticate(selected())}
                  canRemove={canEdit()}
                />
              </div>
            }
          >
            <div data-component="mcp-catalog-detail">
              <Show when={canEdit() && selected().auth === "values"}>
                <MCPMembers server={selected().name} version={`${selected().status}:${tools().length}`} />
              </Show>
              <Show when={tools().length > 0}>
                <TextInput
                  type="search"
                  appearance="full-width"
                  aria-label="Search tools"
                  placeholder="Search tools"
                  leadingIcon={<Icon name="central-search" />}
                  value={state.search}
                  onInput={(event) => setState("search", event.currentTarget.value)}
                />
              </Show>
              <ToolContent
                server={selected()}
                tools={filtered()}
                total={tools().length}
                loading={data.mcpTool.state().state === "loading" && data.mcpTool.list() === undefined}
                error={toolError()}
                searching={state.search.trim() !== ""}
                onRetry={() => void data.mcpTool.sync().catch(() => undefined)}
                workspace={workspace.current().id}
                permissions={state.permissions}
                permissionsLoaded={state.permissionsLoaded}
                canEdit={canEdit()}
                onPermission={updatePermission}
              />
            </div>
          </WorkspacePage>
        )}
      </Match>
      <Match when={data.mcpServer.state().state === "loading" || data.mcpServer.state().state === "idle"}>
        <WorkspacePage title="MCP" description="Loading MCP server…">
          <p role="status">Loading integration…</p>
        </WorkspacePage>
      </Match>
      <Match when={data.mcpServer.state().state === "error"}>
        <WorkspacePage title="MCP" description="Could not load this MCP server.">
          <div role="alert" data-slot="mcp-error">
            <span>{serverError() ?? "Could not load this integration."}</span>
            <Button type="button" size="small" onClick={() => void data.mcpServer.sync().catch(() => undefined)}>
              Try again
            </Button>
          </div>
        </WorkspacePage>
      </Match>
      <Match when={true}>
        <WorkspacePage
          title="MCP server not found"
          heading={<MCPBreadcrumb href={mcpHref()} server="MCP server not found" />}
          description="This MCP server is not available."
        >
          <Empty>This MCP server is not available.</Empty>
        </WorkspacePage>
      </Match>
    </Switch>
  )
}

function ToolContent(props: {
  readonly server: MCPServer
  readonly tools: ReadonlyArray<MCPTool>
  readonly total: number
  readonly loading: boolean
  readonly error: string | undefined
  readonly searching: boolean
  readonly onRetry: () => void
  readonly workspace: string
  readonly permissions: Record<string, PermissionEffect>
  readonly permissionsLoaded: boolean
  readonly canEdit: boolean
  readonly onPermission: (tool: MCPTool, effect: PermissionEffect) => Promise<unknown>
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.loading}>
        <p role="status" data-slot="mcp-status">
          Loading tools…
        </p>
      </Match>
      <Match when={props.error}>
        {(message) => (
          <div data-slot="mcp-error" role="alert">
            <span>{message()}</span>
            <Button type="button" size="small" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        )}
      </Match>
      <Match when={props.tools.length > 0}>
        <ul data-slot="mcp-tool-list" aria-label={`${props.server.name} tools`}>
          <For each={props.tools}>
            {(tool) => (
              <ToolRow
                tool={tool}
                workspace={props.workspace}
                effect={props.permissions[tool.action] ?? "allow"}
                permissionsLoaded={props.permissionsLoaded}
                canEdit={props.canEdit}
                onPermission={props.onPermission}
              />
            )}
          </For>
        </ul>
      </Match>
      <Match when={props.searching && props.total > 0}>
        <Empty>No matching tools.</Empty>
      </Match>
      <Match when={true}>
        <Empty>{emptyMessage(props.server)}</Empty>
      </Match>
    </Switch>
  )
}

function ToolRow(props: {
  readonly tool: MCPTool
  readonly workspace: string
  readonly effect: PermissionEffect
  readonly permissionsLoaded: boolean
  readonly canEdit: boolean
  readonly onPermission: (tool: MCPTool, effect: PermissionEffect) => Promise<unknown>
}): JSX.Element {
  let admitted = false
  const mutation = useMutation(() => ({
    scope: { id: JSON.stringify(["mcp-tool-permission", props.workspace, props.tool.action]) },
    retry: false,
    networkMode: "always",
    mutationFn: (input: { tool: MCPTool; effect: PermissionEffect; update: typeof props.onPermission }) =>
      input.update(input.tool, input.effect),
  }))
  const effect = () => (mutation.isPending ? mutation.variables!.effect : props.effect)
  const update = (next: PermissionEffect) => {
    if (admitted || mutation.isPending) return
    admitted = true
    void mutation
      .mutateAsync({ tool: props.tool, effect: next, update: props.onPermission })
      .catch(() => undefined)
      .finally(() => {
        admitted = false
      })
  }
  const copyPermission = () =>
    copyToClipboard(props.tool.action).then((result) =>
      showToast({
        variant: result === "copied" ? "success" : "error",
        title: result === "copied" ? "Permission ID copied" : "Could not copy Permission ID",
      }),
    )
  return (
    <li>
      <div data-slot="mcp-tool-copy">
        <strong title={props.tool.name}>{props.tool.name}</strong>
        <Show
          when={props.tool.description}
          fallback={<span data-slot="mcp-tool-description-empty">No description provided</span>}
        >
          {(description) => <p>{description()}</p>}
        </Show>
      </div>
      <Field data-slot="mcp-permission-id">
        <Field.Label>Permission ID</Field.Label>
        <TextInput
          readOnly
          value={props.tool.action}
          aria-label={`Permission ID for ${props.tool.name}`}
          class="mcp-permission-id-input"
          showCopyButton
          copyLabel={`Copy Permission ID for ${props.tool.name}`}
          onCopyClick={() => void copyPermission()}
        />
      </Field>
      <Show
        when={props.permissionsLoaded && props.canEdit}
        fallback={
          <span aria-label={`Permission for ${props.tool.name}: ${props.effect}`}>
            {props.permissionsLoaded
              ? props.effect === "allow"
                ? "Allowed"
                : props.effect === "ask"
                  ? "Ask"
                  : "Denied"
              : "Loading permission…"}
          </span>
        }
      >
        <Select<PermissionEffect>
          aria-label={`Permission for ${props.tool.name}`}
          appearance="inline"
          options={[...permissionOptions]}
          current={effect()}
          label={permissionLabel}
          disabled={mutation.isPending}
          onSelect={(next) => {
            if (next !== null) update(next)
          }}
        />
      </Show>
      <Show when={mutation.error}>
        {(cause) => <p role="alert">{errorMessage(cause(), "Could not update permission.")}</p>}
      </Show>
    </li>
  )
}

function ActivationSwitch(props: {
  readonly server: MCPServer
  readonly workspace: Workspace.ID
  readonly canEdit: boolean
  readonly onToggle: (input: ActivationInput) => Promise<boolean>
}): JSX.Element {
  let latestIntent = 0
  const mutation = useMutation(() => ({
    scope: { id: JSON.stringify(["mcp-server", props.workspace, props.server.name]) },
    retry: false,
    networkMode: "always",
    mutationFn: (input: {
      workspace: Workspace.ID
      server: MCPServer
      enabled: boolean
      intent: number
      toggle: typeof props.onToggle
    }) => input.toggle({ workspace: input.workspace, server: input.server, enabled: input.enabled }),
    onSuccess: (active, input) => {
      if (
        !active ||
        input.intent !== latestIntent ||
        input.workspace !== props.workspace ||
        input.server.name !== props.server.name
      )
        return
      showToast({ variant: "success", title: `${input.server.name} ${input.enabled ? "enabled" : "disabled"}.` })
    },
  }))
  const currentMutation = () =>
    mutation.variables?.workspace === props.workspace && mutation.variables.server.name === props.server.name
  const enabled = () => (mutation.isPending && currentMutation() ? mutation.variables!.enabled : props.server.enabled)
  const error = () =>
    mutation.isError && currentMutation()
      ? `Could not ${mutation.variables?.enabled ? "enable" : "disable"} ${props.server.name}: ${errorMessage(mutation.error, "Request failed")}`
      : undefined
  return (
    <div data-slot="mcp-activation">
      <Toggle
        hideLabel
        checked={enabled()}
        disabled={!props.canEdit}
        onChange={(next) => {
          if (!props.canEdit) return
          latestIntent += 1
          mutation.mutate({
            workspace: props.workspace,
            server: props.server,
            enabled: next,
            toggle: props.onToggle,
            intent: latestIntent,
          })
        }}
      >
        Enabled {props.server.name}
      </Toggle>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
    </div>
  )
}

function permissionLabel(effect: PermissionEffect) {
  if (effect === "allow") return "Allowed"
  if (effect === "ask") return "Ask"
  return "Denied"
}

function MCPBreadcrumb(props: { readonly href: string; readonly server: string }): JSX.Element {
  return (
    <span data-component="mcp-breadcrumb">
      <A href={props.href}>Integrations</A>
      <span aria-hidden="true">/</span>
      <span>{props.server}</span>
    </span>
  )
}

function toolDescription(url: string | undefined, count: number | undefined) {
  const amount = count === undefined ? undefined : `${count} ${count === 1 ? "tool" : "tools"}`
  return [url, amount].filter(Boolean).join(" · ")
}

function emptyMessage(server: MCPServer) {
  if (!server.enabled) return "Enable this integration to discover its tools."
  if (server.status === "needs_auth")
    return server.auth === "values"
      ? "Authenticate with your own values to discover its tools."
      : "Authenticate this integration to discover its tools."
  if (server.status === "disabled") return "Connect this integration to discover its tools."
  if (server.status === "pending") return "Connecting to discover tools…"
  if (server.status === "failed") return server.error
  return "No tools yet."
}
