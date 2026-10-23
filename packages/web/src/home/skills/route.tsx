import type { SkillListOutput } from "@bymorning/client"
import type * as Workspace from "@bymorning/schema/workspace"
import { createComponent, onCleanup, type JSX } from "solid-js"

import { useData } from "../../context/data"
import { useDialog } from "../../context/dialog"
import { useSDK } from "../../context/sdk"
import { useWorkspace } from "../../context/workspace"
import { Button } from "../../ui/components/button"
import { showToast } from "../../ui/components/toast"
import { WorkspacePage } from "../workspace-page"
import { SkillDialog, type SkillDraft } from "./dialog"
import { openSkillLibrary } from "./library-dialog"
import { HomeSkillsRegion } from "./region"

type Skill = SkillListOutput[number]

export function SkillsRoute(): JSX.Element {
  const dialog = useDialog()
  const sdk = useSDK()
  const workspace = useWorkspace()
  const data = useData()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  /** Refresh the Skill catalog and toast when the caller's workspace is still current. */
  const settle = (workspaceID: Workspace.ID, title: string) => {
    const catalog = data.workspace.skill
    catalog.invalidate()
    void catalog.sync().catch(() => undefined)
    if (!disposed && workspace.current().id === workspaceID) showToast({ variant: "success", title })
  }

  const create = () => {
    const workspaceID = workspace.current().id
    const client = sdk.client
    dialog.show(() =>
      createComponent(SkillDialog, {
        mode: {
          type: "create",
          submit: (draft: SkillDraft) => client.skill.create({ workspace: workspaceID, ...draft }),
        },
        onSaved: (name) => settle(workspaceID, `Skill ${name} created`),
      }),
    )
  }

  const browse = () => {
    const workspaceID = workspace.current().id
    openSkillLibrary({
      dialog,
      sdk,
      data,
      workspaceID,
      onAdded: (entry) => settle(workspaceID, `Skill ${entry.name} added`),
    })
  }

  const open = (skill: Skill) => {
    const workspaceID = workspace.current().id
    const client = sdk.client
    dialog.show(() =>
      createComponent(SkillDialog, {
        mode: {
          type: "existing",
          id: skill.id,
          skill,
          save: (draft: SkillDraft) => client.skill.update({ workspace: workspaceID, skillID: skill.id, ...draft }),
          remove: () => client.skill.delete({ workspace: workspaceID, skillID: skill.id }),
        },
        onSaved: (name) => settle(workspaceID, `Skill ${name} saved`),
        onDeleted: (name) => settle(workspaceID, `Skill ${name} deleted`),
      }),
    )
  }

  return (
    <WorkspacePage
      title="Skills"
      layout="table"
      actions={
        <>
          <Button variant="outline" icon="central-agent-skills" onClick={browse}>
            Skill library
          </Button>
          <Button variant="primary" icon="central-plus-small" onClick={create}>
            Add skill
          </Button>
        </>
      }
    >
      <HomeSkillsRegion onOpen={open} />
    </WorkspacePage>
  )
}
