import type { AgentListOutput } from "@bymorning/client"
import * as Agent from "@bymorning/schema/agent"
import type * as Workspace from "@bymorning/schema/workspace"
import { createComponent, onCleanup, type JSX } from "solid-js"

import { useData } from "../../context/data"
import { useDialog } from "../../context/dialog"
import { useSDK } from "../../context/sdk"
import { useWorkspace } from "../../context/workspace"
import { AgentDetailContent, type AgentDraft } from "./dialog"
import { Button } from "../../ui/components/button"
import { showToast } from "../../ui/components/toast"
import { WorkspacePage } from "../workspace-page"
import { AgentCreateDialog } from "./create-dialog"
import { HomeAgentsRegion } from "./region"

type AgentItem = AgentListOutput[number]

export function AgentsRoute(): JSX.Element {
  const dialog = useDialog()
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  /** Refresh the Agent catalog and toast when the caller's workspace is still current. */
  const settle = (workspaceID: Workspace.ID, title: string) => {
    const catalog = data.workspace.agent
    catalog.invalidate()
    void catalog.sync().catch(() => undefined)
    if (!disposed && workspace.current().id === workspaceID) showToast({ variant: "success", title })
  }

  const create = () => {
    const workspaceID = workspace.current().id
    const client = sdk.client
    dialog.show(() =>
      createComponent(AgentCreateDialog, {
        create: (payload) =>
          client.agent.create({
            workspace: workspaceID,
            // The contract has the client supply the Workspace-local Agent id.
            id: Agent.ID.make(agentIDFromName(payload.name)),
            name: Agent.Name.make(payload.name),
            instructions: payload.instructions,
            ...(payload.description ? { description: payload.description } : {}),
            // The Workspace has one primary Agent, the built-in Default.
            mode: "subagent",
            hidden: false,
            steps: null,
            permissions: [],
          }),
        onSuccess: (name) => settle(workspaceID, `Subagent ${name} created`),
      }),
    )
  }

  const open = (agent: AgentItem) => {
    const workspaceID = workspace.current().id
    const client = sdk.client
    // Only administrators may replace a built-in Agent or restore its shipped
    // definition; the server enforces the same rule.
    const builtIn = Agent.BuiltIn.has(agent.id)
    const administrator = workspace.current().role === "admin"
    const editable = administrator || !builtIn
    dialog.show(() =>
      createComponent(AgentDetailContent, {
        agent,
        ...(editable
          ? {
              actions: {
                save: (draft: AgentDraft) =>
                  client.agent.update({
                    workspace: workspaceID,
                    id: agent.id,
                    name: Agent.Name.make(draft.name),
                    instructions: draft.instructions,
                    ...(agent.model ? { model: agent.model } : {}),
                    ...(draft.description ? { description: draft.description } : {}),
                    // Mode is fixed for the life of an Agent.
                    mode: agent.mode,
                    hidden: agent.hidden,
                    ...(agent.color ? { color: agent.color } : {}),
                    steps: agent.steps,
                    permissions: agent.permissions,
                  }),
                ...(builtIn ? { reset: () => client.agent.delete({ workspace: workspaceID, id: agent.id }) } : {}),
              },
            }
          : {}),
        onSaved: (name: string) => settle(workspaceID, `${noun(agent.mode)} ${name} saved`),
        onReset: (name: string) => settle(workspaceID, `${noun(agent.mode)} ${name} reset to built-in`),
      }),
    )
  }

  return (
    <WorkspacePage
      title="Agents"
      actions={
        <Button variant="primary" icon="central-plus-small" onClick={create}>
          Add subagent
        </Button>
      }
    >
      <HomeAgentsRegion onOpen={open} />
    </WorkspacePage>
  )
}

/** Canonical term for an Agent of this mode: only the Default is plain "Agent". */
const noun = (mode: AgentItem["mode"]) => (mode === "subagent" ? "Subagent" : "Agent")

function agentIDFromName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "agent"
}
