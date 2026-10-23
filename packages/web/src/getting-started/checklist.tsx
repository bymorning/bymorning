import type { IntegrationInfo } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import { For, Match, Show, Switch, createResource, type JSX } from "solid-js"

import { useData } from "../context/data"
import { useOptionalIntegration } from "../context/integration"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { CreateKeyDialog } from "../gateway/service-accounts/account-dialog"
import { openSkillLibrary } from "../home/skills/library-dialog"
import { IntegrationDialog } from "../integration/dialog/dialog"
import { AddProviderButton } from "../integration/providers/view"
import { MCPAddDialog } from "../mcp/add-dialog"
import { useProject } from "../project/model"
import { Button } from "../ui/components/button"
import { Icon, type IconProps } from "../ui/components/icon"
import { ProgressCircle } from "../ui/components/progress-circle"
import { Tag } from "../ui/components/tag"
import { showToast } from "../ui/components/toast"
import { postCommit } from "../utils/post-commit"
import { WorkspaceRoutePath, workspaceRouteHref } from "../workspace-route-paths"
import { BudgetDialog } from "./budget-dialog"
import { stepIDs, type GettingStarted, type StepID } from "./model"
import "./checklist.css"

const copy: Record<StepID, { readonly title: string; readonly description: string; readonly icon: IconProps["name"] }> =
  {
    provider: {
      title: "Connect a model provider",
      description: "Every session and API request runs through the providers you connect.",
      icon: "central-plug",
    },
    session: {
      title: "Start your first session",
      description: "See a conversation with history, workspace rules, and usage recorded.",
      icon: "edit",
    },
    skills: {
      title: "Build your team's skill library",
      description: "Teach the assistant how your team works once. Everyone here gets it.",
      icon: "central-agent-skills",
    },
    budget: {
      title: "Set a spending limit",
      description: "Cap this workspace's monthly inference spend before you invite anyone.",
      icon: "central-wallet",
    },
    tools: {
      title: "Add tools",
      description: "Give sessions web search or connect an MCP server your team already uses.",
      icon: "central-mcp",
    },
    apps: {
      title: "Create an API key",
      description: "For Claude Code, Codex, or any app that calls models through the gateway.",
      icon: "central-key-1",
    },
  }

/** Overview card that tracks first-use outcomes. Rendered only for administrators. */
export function Checklist(props: { readonly model: GettingStarted }): JSX.Element {
  const workspace = useWorkspace()
  const href = (path: (typeof WorkspaceRoutePath)[keyof typeof WorkspaceRoutePath]) =>
    workspaceRouteHref(workspace.current().id, path)
  const percentage = () => Math.round((props.model.complete() / props.model.total) * 100)
  const sdk = useSDK()
  // The resolved Workspace Config reads `websearch: false` when the Installation Policy (or the
  // Workspace) disables web search; an unreadable Config leaves the option available.
  const [config] = createResource(
    () => workspace.current().id,
    async (workspaceID) => {
      try {
        return await sdk.client["api.config"].get({ workspace: workspaceID })
      } catch {
        return undefined
      }
    },
  )
  const websearchDisabled = () => config()?.websearch === false
  const description = (id: StepID) =>
    id === "tools" && websearchDisabled() ? "Connect an MCP server your team already uses." : copy[id].description
  return (
    <section data-component="getting-started" aria-labelledby="getting-started-title">
      <header data-slot="checklist-header">
        <div data-slot="checklist-progress" aria-hidden="true">
          <ProgressCircle percentage={percentage()} size={28} strokeWidth={2.5} />
        </div>
        <div data-slot="checklist-heading">
          <div data-slot="checklist-title">
            <h2 id="getting-started-title">Getting started</h2>
            <Tag title="Only workspace administrators see this">Admins only</Tag>
          </div>
          <p role="status">
            {props.model.complete()} of {props.model.total} complete
          </p>
        </div>
        <Button
          type="button"
          variant="ghost-muted"
          size="small"
          data-action="getting-started-dismiss"
          onClick={props.model.preference.dismiss}
        >
          Dismiss
        </Button>
      </header>
      <ol data-slot="checklist-items" aria-label="Getting started steps">
        <For each={stepIDs}>
          {(id) => {
            const state = () => props.model.step(id)
            return (
              <li data-step={id} data-state={state()}>
                <span data-slot="checklist-mark" aria-hidden="true">
                  <Switch fallback={<Icon name={copy[id].icon} size="small" />}>
                    <Match when={state() === "done"}>
                      <Icon name="check" size="small" />
                    </Match>
                  </Switch>
                </span>
                <div data-slot="checklist-copy">
                  <strong>
                    {copy[id].title}
                    <Show when={state() === "done"}>
                      <span class="sr-only"> (complete)</span>
                    </Show>
                    <Show when={state() === "skipped"}>
                      <span class="sr-only"> (skipped)</span>
                    </Show>
                  </strong>
                  <p>{description(id)}</p>
                  <Show when={id === "tools" && websearchDisabled()}>
                    <p data-slot="getting-started-note">Web search is disabled by the Installation Policy.</p>
                  </Show>
                </div>
                <div data-slot="checklist-actions">
                  <Switch>
                    <Match when={state() === "pending"}>
                      <StepAction id={id} model={props.model} websearchDisabled={websearchDisabled()} />
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="small"
                        data-action="getting-started-skip"
                        onClick={() => props.model.preference.skip(id)}
                      >
                        Skip
                      </Button>
                    </Match>
                    <Match when={state() === "skipped"}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        data-action="getting-started-unskip"
                        onClick={() => props.model.preference.unskip(id)}
                      >
                        Show again
                      </Button>
                    </Match>
                  </Switch>
                </div>
              </li>
            )
          }}
        </For>
      </ol>
      <footer data-slot="checklist-footer">
        <div data-slot="checklist-copy">
          <strong>Rolling out to your team?</strong>
          <p>Invite members and sign in through your identity provider.</p>
        </div>
        <div data-slot="checklist-actions">
          <Button as="a" href={href(WorkspaceRoutePath.members)} variant="outline" size="small">
            Invite members
          </Button>
          <Button as="a" href={href(WorkspaceRoutePath.security)} variant="outline" size="small">
            Configure SSO
          </Button>
        </div>
      </footer>
    </section>
  )
}

function StepAction(props: {
  readonly id: StepID
  readonly model: GettingStarted
  readonly websearchDisabled: boolean
}): JSX.Element {
  const workspace = useWorkspace()
  const href = (path: (typeof WorkspaceRoutePath)[keyof typeof WorkspaceRoutePath]) =>
    workspaceRouteHref(workspace.current().id, path)
  return (
    <Switch>
      <Match when={props.id === "provider"}>
        <AddProviderButton
          catalog={props.model.catalog}
          owner={{ dialog: props.model.dialog, manage: props.model.manage }}
        />
      </Match>
      <Match when={props.id === "session"}>
        <SessionAction />
      </Match>
      <Match when={props.id === "skills"}>
        <SkillsAction model={props.model} />
      </Match>
      <Match when={props.id === "budget"}>
        <BudgetAction model={props.model} />
        <Button as="a" href={href(WorkspaceRoutePath.gatewayBudgets)} variant="ghost" size="small">
          All budgets
        </Button>
      </Match>
      <Match when={props.id === "tools"}>
        <ToolsAction model={props.model} websearchDisabled={props.websearchDisabled} />
      </Match>
      <Match when={props.id === "apps"}>
        <AppsAction model={props.model} />
      </Match>
    </Switch>
  )
}

function SessionAction(): JSX.Element {
  const project = useProject()
  return (
    <Button
      type="button"
      variant="primary"
      size="small"
      icon="central-plus-small"
      disabled={!project.session.canCreate()}
      title={project.session.createDisabled()}
      data-action="getting-started-session"
      onClick={() => project.session.create()}
    >
      New session
    </Button>
  )
}

function SkillsAction(props: { readonly model: GettingStarted }): JSX.Element {
  const sdk = useSDK()
  const data = useData()
  const dialog = props.model.dialog
  const workspace = useWorkspace()
  const href = (path: (typeof WorkspaceRoutePath)[keyof typeof WorkspaceRoutePath]) =>
    workspaceRouteHref(workspace.current().id, path)
  const open = () => {
    const workspaceID = workspace.current().id
    openSkillLibrary({
      dialog,
      sdk,
      data,
      workspaceID,
      onAdded: (entry) =>
        postCommit(() => {
          data.workspace.skill.invalidate()
          void data.workspace.skill.sync().catch(() => undefined)
          showToast({ variant: "success", title: `Skill ${entry.name} added` })
        }),
    })
  }
  return (
    <>
      <Button type="button" variant="primary" size="small" data-action="getting-started-skills" onClick={open}>
        Browse the library
      </Button>
      <Button as="a" href={href(WorkspaceRoutePath.skills)} variant="ghost" size="small">
        All skills
      </Button>
    </>
  )
}

function BudgetAction(props: { readonly model: GettingStarted }): JSX.Element {
  const sdk = useSDK()
  const data = useData()
  const dialog = props.model.dialog
  const workspace = useWorkspace()
  const open = () =>
    dialog.show(() => (
      <BudgetDialog
        save={(amount) =>
          sdk.client.budget
            .limit({ workspace: workspace.current().id, target: { type: "workspace" }, amount })
            .then(() =>
              postCommit(() => {
                data.workspace.budget.invalidate()
                void data.workspace.budget.sync().catch(() => undefined)
                showToast({ variant: "success", title: "Workspace limit updated" })
              }),
            )
        }
      />
    ))
  return (
    <Button type="button" variant="primary" size="small" data-action="getting-started-budget" onClick={open}>
      Set a limit
    </Button>
  )
}

function ToolsAction(props: { readonly model: GettingStarted; readonly websearchDisabled: boolean }): JSX.Element {
  const sdk = useSDK()
  const data = useData()
  const dialog = props.model.dialog
  const workspace = useWorkspace()
  const integration = useOptionalIntegration()
  const connectable = (item: IntegrationInfo) =>
    item.methods.some((method) => method.type !== "env" && method.type !== "env-group")
  const websearch = () => {
    if (!integration) return undefined
    const providers = integration.websearch()
    const list = integration.list()
    if (providers.state !== "ready" || list.state !== "ready") return undefined
    return providers.data
      .map((provider) => list.data.find((item) => item.id === Integration.ID.make(provider.id)))
      .find((item) => item !== undefined && connectable(item))
  }
  const openWebsearch = () => {
    const item = websearch()
    if (!item) return
    dialog.show(() => (
      <IntegrationDialog
        initialIntegration={item}
        initialManagement={false}
        providerOnly={item.connectionPolicy !== "member-only"}
        onChange={() => integration?.refetch()}
      />
    ))
  }
  const openMCP = () =>
    dialog.show(() => (
      <MCPAddDialog
        onSubmit={({ name, ...server }) =>
          sdk.client.mcp.servers.put({ server: name, ...server, workspace: workspace.current().id }).then(() =>
            postCommit(() => {
              data.workspace.mcpServer.invalidate()
              void data.workspace.mcpServer.sync().catch(() => undefined)
              showToast({ variant: "success", title: "MCP server added" })
            }),
          )
        }
      />
    ))
  return (
    <>
      <Show when={websearch() && !props.websearchDisabled}>
        <Button
          type="button"
          variant="primary"
          size="small"
          icon="web"
          data-action="getting-started-websearch"
          onClick={openWebsearch}
        >
          Add web search
        </Button>
      </Show>
      <Button
        type="button"
        variant={websearch() && !props.websearchDisabled ? "outline" : "primary"}
        size="small"
        icon="central-mcp"
        data-action="getting-started-mcp"
        onClick={openMCP}
      >
        Add MCP server
      </Button>
    </>
  )
}

function AppsAction(props: { readonly model: GettingStarted }): JSX.Element {
  const sdk = useSDK()
  const data = useData()
  const dialog = props.model.dialog
  const workspace = useWorkspace()
  const refresh = () =>
    postCommit(() => {
      // The Budgets page lists service accounts from budget standings, so both catalogs go stale together.
      data.workspace.serviceAccount.invalidate()
      void data.workspace.serviceAccount.sync().catch(() => undefined)
      data.workspace.budget.invalidate()
      void data.workspace.budget.sync().catch(() => undefined)
    })
  const open = () =>
    dialog.show(() => (
      <CreateKeyDialog
        accounts={data.workspace.serviceAccount.list()?.filter((account) => account.status === "active")}
        createAccount={(name) =>
          sdk.client.serviceAccount.create({ workspace: workspace.current().id, name, policy: {} })
        }
        createKey={(owner, name, timeExpires) =>
          sdk.client.serviceAccount.key.create({
            workspace: workspace.current().id,
            id: owner.id,
            name,
            ...(timeExpires ? { timeExpires } : {}),
          })
        }
        created={() => {
          refresh()
          showToast({ variant: "success", title: "API key created" })
        }}
      />
    ))
  return (
    <Button type="button" variant="primary" size="small" data-action="getting-started-key" onClick={open}>
      Create API key
    </Button>
  )
}
